import { Check, X } from "lucide-react";

export interface OnboardingStep {
  label: string;
  done: boolean;
  hint: string;
}

/**
 * Whether each getting-started milestone is complete. Kept as plain booleans so the
 * card (shown on the empty daily/weekly screens) only sees prepared steps, never raw state.
 */
export interface OnboardingStatus {
  trackingActive: boolean;
  calendarImported: boolean;
  aiConfigured: boolean;
  classified: boolean;
}

// Single source of truth for the onboarding checklist, rendered only on the
// empty daily/weekly screens (Settings shows the real controls instead of a copy).
export function buildOnboardingSteps(status: OnboardingStatus): OnboardingStep[] {
  return [
    {
      label: "Tracking active",
      done: status.trackingActive,
      hint: "Resume tracking in Settings and wait for the first activity sample",
    },
    {
      label: "Calendar imported",
      done: status.calendarImported,
      hint: "Import an .ics export from Settings → Data sources",
    },
    {
      label: "AI provider configured",
      done: status.aiConfigured,
      hint: "Add a provider key in Settings → AI assistance",
    },
    {
      label: "First classification run",
      done: status.classified,
      hint: "Classify captured sessions from History → Activity",
    },
  ];
}

export function OnboardingCard({
  steps,
  onDismiss,
}: {
  steps: OnboardingStep[];
  /** When provided, renders a dismiss control (used for the first-run card). */
  onDismiss?: () => void;
}) {
  const completedCount = steps.filter((step) => step.done).length;
  const progressPct = Math.round((completedCount / steps.length) * 100);

  return (
    <section className="onboarding-checklist onboarding-card" aria-label="Getting started">
      <div className="onboarding-checklist-header">
        <strong>Getting started</strong>
        <div className="onboarding-card-meta">
          <span>{completedCount}/{steps.length} complete</span>
          {onDismiss && (
            <button
              className="onboarding-dismiss"
              type="button"
              onClick={onDismiss}
              title="Dismiss getting started"
              aria-label="Dismiss getting started"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div
        className="review-progress-track onboarding-progress-track"
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Getting started progress"
      >
        <div className="review-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>
      <ol className="onboarding-steps">
        {steps.map((step) => (
          <li key={step.label} className={step.done ? "onboarding-step is-done" : "onboarding-step"}>
            <span className="onboarding-step-icon" aria-hidden="true">
              {step.done ? <Check size={13} /> : null}
            </span>
            <span>
              {step.label}
              <span className="sr-only">, {step.done ? "completed" : "not completed"}</span>
              {!step.done && <span className="onboarding-step-hint">{step.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
