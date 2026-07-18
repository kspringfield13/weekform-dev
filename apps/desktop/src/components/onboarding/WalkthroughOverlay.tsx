import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

/**
 * A single stop on the first-run tour. When `target` is set, the overlay
 * spotlights that element (matched by CSS selector against the live DOM) and
 * anchors the explanation card beside it; when it's omitted the step renders as
 * a centered welcome/finish card over a plain dimmed backdrop.
 */
export interface WalkthroughStep {
  target?: string;
  title: string;
  body: string;
}

// The tour walks the primary navigation in reading order. Selectors point at the
// `data-tour` hooks on the sidebar buttons in AppShell, so the highlight tracks
// whatever the nav actually renders (and silently falls back to a centered card
// if a target is ever missing, e.g. on a narrow viewport).
export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    title: "Welcome to Weekform",
    body: "A quick tour of where things live. Weekform turns your calendar and app activity into reviewable work blocks, then an explainable estimate of your weekly capacity — all on this Mac.",
  },
  {
    target: '[data-tour="today"]',
    title: "Today",
    body: "Your daily review queue. Confirm, relabel, or exclude the work blocks Weekform inferred. Nothing counts toward your capacity until you've reviewed it here.",
  },
  {
    target: '[data-tour="week"]',
    title: "Week",
    body: "The weekly picture: your capacity model, a forecast of next week's reliable headroom, multi-week trends, and an editable summary you can share with a manager.",
  },
  {
    target: '[data-tour="agent"]',
    title: "Agent",
    body: "Ask questions about your workload in plain language — \"how booked am I next week?\" — and understand how the capacity model reached its numbers.",
  },
  {
    target: '[data-tour="history"]',
    title: "History",
    body: "Your activity ledger, the log of every correction you've made, and a full audit trail. Every inference cites its evidence, so nothing is a black box.",
  },
  {
    target: '[data-tour="setup"]',
    title: "Settings",
    body: "Connect a calendar, configure optional AI features, set how long data is kept, and pause tracking anytime. You can replay this tour from here too.",
  },
  {
    title: "You're all set",
    body: "Resume tracking and import a calendar export from Settings to start building your first capacity picture. Everything stays local and reviewable.",
  },
];

const CARD_WIDTH = 320;
const SPOTLIGHT_PADDING = 8;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function readRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function WalkthroughOverlay({
  onComplete,
  onSkip,
}: {
  /** Called when the user finishes the last step. */
  onComplete: () => void;
  /** Called when the user dismisses the tour early. */
  onSkip: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;

  const step = WALKTHROUGH_STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === WALKTHROUGH_STEPS.length - 1;

  // Track the highlighted element's position. Recomputed on step change and on
  // resize so the spotlight stays glued to the nav button as the window moves.
  useLayoutEffect(() => {
    if (!step.target) {
      setRect(null);
      return;
    }
    const update = () => setRect(readRect(step.target as string));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [step.target]);

  const goNext = useCallback(() => {
    if (isLast) onComplete();
    else setStepIndex((i) => i + 1);
  }, [isLast, onComplete]);

  const goBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  // Move focus into the tour on mount (the primary button, so Enter/Space act on
  // the expected control) and restore it to whatever launched the tour on close —
  // the ConfirmDialog a11y baseline. Runs once; focus then stays trapped in the
  // card (see the Tab handler below), so it correctly follows Back/Next.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    primaryButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Keyboard control: arrows advance/go back, Enter advances, Escape skips.
  // Mirrors the buttons so the tour is fully keyboard-navigable. Respects the
  // app's input/textarea focus guard (the tour is replayable from Settings, where
  // real inputs exist) so it never hijacks typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onSkip();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      } else if (e.key === "Enter") {
        // The card is focus-trapped with Back/Skip/close all Tab-reachable, so
        // let a focused button handle its OWN Enter activation instead of every
        // Enter meaning "Next". Only when focus is on the backdrop/card body (no
        // button) does Enter advance the tour. Deferring to the native click also
        // keeps the primary button advancing exactly once (no double-fire): the
        // handler returns without preventDefault, so the button's synthesized
        // Enter click fires goNext() a single time.
        if (target?.closest("button")) return;
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goBack, onSkip]);

  // Trap Tab/Shift+Tab within the card so background controls stay unreachable
  // while the modal tour is open (mirrors ConfirmDialog).
  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const spotlightStyle = rect
    ? {
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
      }
    : undefined;

  // Anchor the card to the right of the spotlight (the nav is a left sidebar);
  // flip to the left if it would run off-screen, and clamp vertically so the
  // whole card stays visible.
  let cardStyle: CSSProperties | undefined;
  if (rect) {
    let left = rect.left + rect.width + 16;
    if (left + CARD_WIDTH > window.innerWidth - 16) {
      left = Math.max(16, rect.left - CARD_WIDTH - 16);
    }
    const top = Math.min(Math.max(16, rect.top), window.innerHeight - 240);
    cardStyle = { top, left, width: CARD_WIDTH };
  }

  // Glide the card only between two anchored steps: the centered card positions
  // via transform (see .is-centered), so transitioning top/left across the
  // centered↔anchored switch would visibly lurch.
  const wasAnchoredRef = useRef(false);
  const isGliding = rect !== null && wasAnchoredRef.current;
  useEffect(() => {
    wasAnchoredRef.current = rect !== null;
  }, [rect]);

  return (
    <div className="walkthrough" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
      {rect ? (
        <div className="walkthrough-spotlight" style={spotlightStyle} aria-hidden="true" />
      ) : (
        <div className="walkthrough-backdrop" aria-hidden="true" />
      )}
      <div
        ref={cardRef}
        className={
          rect
            ? isGliding
              ? "walkthrough-card is-gliding"
              : "walkthrough-card"
            : "walkthrough-card is-centered"
        }
        style={cardStyle}
        onKeyDown={handleCardKeyDown}
      >
        <button
          className="walkthrough-close"
          type="button"
          onClick={onSkip}
          title="Skip tour"
          aria-label="Skip tour"
        >
          <X size={15} aria-hidden="true" />
        </button>
        <strong className="walkthrough-title" id={titleId}>{step.title}</strong>
        <p className="walkthrough-body" id={bodyId}>{step.body}</p>
        <div className="walkthrough-progress" aria-hidden="true">
          {WALKTHROUGH_STEPS.map((_, i) => (
            <span key={i} className={i === stepIndex ? "walkthrough-dot is-active" : "walkthrough-dot"} />
          ))}
        </div>
        <span className="sr-only">
          Step {stepIndex + 1} of {WALKTHROUGH_STEPS.length}
        </span>
        <div className="walkthrough-actions">
          <button className="walkthrough-skip" type="button" onClick={onSkip}>
            Skip
          </button>
          <div className="walkthrough-nav">
            {!isFirst && (
              <button className="walkthrough-btn" type="button" onClick={goBack}>
                <ArrowLeft size={14} aria-hidden="true" /> Back
              </button>
            )}
            <button className="walkthrough-btn is-primary" type="button" onClick={goNext} ref={primaryButtonRef}>
              {isLast ? "Done" : "Next"}
              {!isLast && <ArrowRight size={14} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
