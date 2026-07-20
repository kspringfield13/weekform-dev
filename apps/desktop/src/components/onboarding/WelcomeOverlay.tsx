import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowRight } from "lucide-react";
import { WeekformMark } from "../common/WeekformMark";

/**
 * The very first thing a new user sees: a branded, full-screen welcome shown
 * before the walkthrough (which is followed by the getting-started setup
 * wizard). Deliberately minimal — the mark, one promise, one button — so the
 * launch moment feels finished rather than like another form.
 *
 * Session-scoped by design: it renders whenever the walkthrough hasn't been
 * completed and the current session hasn't acknowledged it, so an interrupted
 * first run greets the user again on the next launch.
 */
export function WelcomeOverlay({ onBegin }: { onBegin: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const taglineId = `${baseId}-tagline`;

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  // Enter/Escape both begin — there is nothing else to do on this screen, and
  // the walkthrough that follows has its own skip affordances.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onBegin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBegin]);

  // Single-button dialog, but trap Tab anyway so background chrome stays
  // unreachable (mirrors WalkthroughOverlay / GettingStartedModal).
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    buttonRef.current?.focus();
  };

  return (
    <div
      className="welcome-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={taglineId}
    >
      <div className="welcome-backdrop" aria-hidden="true" />
      <div ref={cardRef} className="welcome-card" onKeyDown={handleKeyDown}>
        <span className="welcome-mark" aria-hidden="true">
          <WeekformMark className="welcome-mark-svg" />
        </span>
        <h1 className="welcome-title" id={titleId}>
          Welcome to Weekform
        </h1>
        <p className="welcome-tagline" id={taglineId}>
          Local-first workload intelligence. See where your week actually goes —
          your activity stays on this Mac.
        </p>
        <button className="welcome-begin" type="button" onClick={onBegin} ref={buttonRef}>
          Get started <ArrowRight size={15} aria-hidden="true" />
        </button>
        <p className="welcome-footnote">A one-minute setup comes next — the tour is optional.</p>
      </div>
    </div>
  );
}
