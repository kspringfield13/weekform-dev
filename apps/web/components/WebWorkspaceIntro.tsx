"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { WeekformMark } from "@/components/WeekformMark";
import {
  webOnboardingSteps,
  webOnboardingStorageKey,
} from "@/lib/webOnboarding";

type IntroStage = "loading" | "welcome" | "tour" | "closed";

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function targetRect(selector: string | undefined): TargetRect | null {
  if (!selector) return null;
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

export function WebWorkspaceIntro({
  userId,
  hasManagerAccess,
}: {
  userId: string;
  hasManagerAccess: boolean;
}) {
  const steps = useMemo(() => webOnboardingSteps(hasManagerAccess), [hasManagerAccess]);
  const storageKey = useMemo(() => webOnboardingStorageKey(userId), [userId]);
  const [stage, setStage] = useState<IntroStage>("loading");
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;
  const step = steps[stepIndex] ?? steps[0]!;

  useEffect(() => {
    try {
      setStage(localStorage.getItem(storageKey) === "complete" ? "closed" : "welcome");
    } catch {
      setStage("welcome");
    }
  }, [storageKey]);

  useEffect(() => {
    if (stage !== "tour") {
      setRect(null);
      return;
    }
    const update = () => setRect(targetRect(step.target));
    const target = step.target ? document.querySelector(step.target) : null;
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const frame = window.requestAnimationFrame(update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [stage, step.target]);

  useEffect(() => {
    if (stage === "welcome" || stage === "tour") primaryButtonRef.current?.focus();
  }, [stage, stepIndex]);

  const complete = useCallback(() => {
    try {
      localStorage.setItem(storageKey, "complete");
    } catch {
      // The intro remains usable when browser storage is unavailable.
    }
    setStage("closed");
  }, [storageKey]);

  const replay = useCallback(() => {
    setStepIndex(0);
    setStage("welcome");
  }, []);

  const next = useCallback(() => {
    if (stepIndex >= steps.length - 1) complete();
    else setStepIndex((index) => index + 1);
  }, [complete, stepIndex, steps.length]);

  const back = useCallback(() => {
    setStepIndex((index) => Math.max(0, index - 1));
  }, []);

  useEffect(() => {
    if (stage !== "welcome" && stage !== "tour") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        complete();
      } else if (stage === "tour" && event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (stage === "tour" && event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [back, complete, next, stage]);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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

  const spotlightStyle: CSSProperties | undefined = rect
    ? {
        top: rect.top - 8,
        left: rect.left - 8,
        width: rect.width + 16,
        height: rect.height + 16,
      }
    : undefined;

  let cardStyle: CSSProperties | undefined;
  if (rect && typeof window !== "undefined") {
    const cardWidth = 360;
    let left = rect.left + rect.width + 18;
    if (left + cardWidth > window.innerWidth - 18) {
      left = Math.max(18, rect.left - cardWidth - 18);
    }
    cardStyle = {
      left,
      top: Math.min(Math.max(18, rect.top), Math.max(18, window.innerHeight - 330)),
      width: cardWidth,
    };
  }

  return (
    <>
      <div className="workspace-intro-control">
        <button className="workspace-nav-action" type="button" onClick={replay}>
          Replay intro
        </button>
      </div>
      {stage === "welcome" ? (
        <div className="web-intro" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
          <div className="web-intro-backdrop" aria-hidden="true" />
          <div ref={cardRef} className="web-intro-card is-welcome" onKeyDown={trapFocus}>
            <WeekformMark className="web-intro-mark" />
            <span className="web-intro-kicker">Your private browser companion</span>
            <h1 id={titleId}>Welcome to Weekform Web</h1>
            <p id={bodyId}>
              See what shaped your week, coordinate only what you approved, and know what fits next.
            </p>
            <button
              className="button button-primary web-intro-primary"
              type="button"
              onClick={() => setStage("tour")}
              ref={primaryButtonRef}
            >
              Get started <span aria-hidden="true">→</span>
            </button>
            <small>A two-minute tour comes next.</small>
          </div>
        </div>
      ) : null}
      {stage === "tour" ? (
        <div className="web-intro" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
          {rect ? (
            <div className="web-intro-spotlight" style={spotlightStyle} aria-hidden="true" />
          ) : (
            <div className="web-intro-backdrop" aria-hidden="true" />
          )}
          <div
            ref={cardRef}
            className={rect ? "web-intro-card is-anchored" : "web-intro-card"}
            style={cardStyle}
            onKeyDown={trapFocus}
          >
            <button className="web-intro-close" type="button" onClick={complete} aria-label="Skip intro">
              ×
            </button>
            <span className="web-intro-kicker">Step {stepIndex + 1} of {steps.length}</span>
            <h2 id={titleId}>{step.title}</h2>
            <p id={bodyId}>{step.body}</p>
            <div className="web-intro-progress" aria-hidden="true">
              {steps.map((candidate, index) => (
                <span
                  className={index === stepIndex ? "is-active" : index < stepIndex ? "is-done" : ""}
                  key={candidate.id}
                />
              ))}
            </div>
            <div className="web-intro-actions">
              <button className="web-intro-skip" type="button" onClick={complete}>Skip</button>
              <div>
                {stepIndex > 0 ? (
                  <button className="button button-secondary" type="button" onClick={back}>← Back</button>
                ) : null}
                <button className="button button-primary" type="button" onClick={next} ref={primaryButtonRef}>
                  {stepIndex === steps.length - 1 ? "Open workspace" : "Next →"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
