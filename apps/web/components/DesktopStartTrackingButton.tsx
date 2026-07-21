"use client";

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { MacAppLink } from "@/components/MacAppLink";
import { WeekformMark } from "@/components/WeekformMark";
import { queueDesktopStartTracking } from "@/app/dashboard/personalActions";
import { INITIAL_DESKTOP_START_TRACKING_STATE } from "@/lib/desktopActions";

/**
 * Web cannot capture anything from the browser, so Start Tracking first opens
 * an explainer: the Mac app is the source of tracked evidence and Web is the
 * review-safe visual layer. From the dialog the user either gets the Mac app
 * or asks an already-registered Mac to resume through the prompt-free
 * authenticated command queue.
 */
export function DesktopStartTrackingButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    queueDesktopStartTracking,
    INITIAL_DESKTOP_START_TRACKING_STATE,
  );
  const cardRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    cardRef.current
      ?.querySelector<HTMLElement>(".web-start-tracking-download")
      ?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div className="web-start-tracking-form">
      <button
        className="button button-primary web-start-tracking-action"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        title="Tracking runs in the Weekform Mac app"
        type="button"
      >
        {children}
      </button>
      {open ? (
        <div
          className="web-intro web-start-tracking-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          onKeyDown={trapFocus}
        >
          <div className="web-intro-backdrop" aria-hidden="true" />
          <div ref={cardRef} className="web-intro-card web-start-tracking-card">
            <button className="web-intro-close" type="button" onClick={close} aria-label="Close">
              ×
            </button>
            <WeekformMark className="web-intro-mark" />
            <span className="web-intro-kicker">How Weekform works</span>
            <h2 id={titleId}>Tracking starts on your Mac</h2>
            <p id={bodyId}>
              Weekform Web is the visual layer: a private, review-safe view of your week for
              you, and approved summaries for your team. Nothing is ever captured from the
              browser. The Weekform Mac app is the source — it turns consented signals on
              your Mac into reviewable work blocks and syncs only the review-safe results here.
            </p>
            <div className="web-start-tracking-roles" aria-hidden="true">
              <div>
                <strong>Mac app · the source</strong>
                <span>Captures consented signals, builds work blocks, keeps evidence local.</span>
              </div>
              <div>
                <strong>Web · the visual layer</strong>
                <span>Reviews, plans, and coordinates from review-safe summaries only.</span>
              </div>
            </div>
            <ol className="web-start-tracking-steps">
              <li>Download Weekform for Mac and sign in with this account.</li>
              <li>Start tracking there — capture and every approval stay on your Mac.</li>
              <li>Return here: Today and Week fill in as your Mac syncs review-safe blocks.</li>
            </ol>
            <div className="web-start-tracking-dialog-actions">
              <MacAppLink
                className="button button-primary web-start-tracking-download"
                fallbackHref="/download"
              >
                Download Weekform for Mac
              </MacAppLink>
              <form action={formAction}>
                <button className="button button-secondary" disabled={pending} type="submit">
                  {pending ? "Contacting your Mac…" : "Already installed? Start on your Mac"}
                </button>
              </form>
            </div>
            {state.message ? (
              <span className={`web-start-tracking-status is-${state.status}`} role="status">
                {state.message}
              </span>
            ) : null}
            <small>
              Web can request tracking from a signed-in Mac, but only the Mac app confirms a
              successful capture.
            </small>
          </div>
        </div>
      ) : null}
    </div>
  );
}
