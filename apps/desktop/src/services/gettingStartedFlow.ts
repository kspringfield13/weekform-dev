import type { Screen } from "../lib/types";
import type { GettingStartedStatus } from "./localStore";

export const GETTING_STARTED_STEPS = [
  { id: "intro", label: "Welcome", title: "Know what fits before you commit." },
  { id: "privacy", label: "Your data", title: "Your activity stays under your control." },
  { id: "tracking", label: "Activity", title: "Build your week from real activity." },
  { id: "retention", label: "Retention", title: "Choose how long raw samples stay." },
  {
    id: "ai",
    label: "AI assistance",
    title: "Connect ChatGPT / Codex for the best experience.",
  },
  { id: "start", label: "Finish", title: "Your setup is ready to review." },
] as const;

export const GETTING_STARTED_STEP_IDS = GETTING_STARTED_STEPS.map((step) => step.id);

export type GettingStartedStepId = (typeof GETTING_STARTED_STEPS)[number]["id"];

export interface GettingStartedExit {
  auditOutcome: "enabled" | "skipped";
  status: Exclude<GettingStartedStatus, "unseen">;
  screen: Extract<Screen, "setup">;
}

export interface GettingStartedDemoExit {
  auditOutcome: "enabled" | "skipped";
  status: Exclude<GettingStartedStatus, "unseen">;
  destination: "simulated_demo";
  href: "?demo=1&screen=weekly";
}

/**
 * The setup wizard always hands the user to Settings. Tracking state only
 * determines whether onboarding is complete or leaves the resume reminder.
 */
export function resolveGettingStartedExit(trackingPaused: boolean): GettingStartedExit {
  return trackingPaused
    ? { auditOutcome: "skipped", status: "skipped", screen: "setup" }
    : { auditOutcome: "enabled", status: "complete", screen: "setup" };
}

/**
 * The optional preview uses Weekform's in-memory synthetic profile. Keep the
 * setup outcome aligned with the user's tracking choice while making the demo
 * destination explicit for truthful audit copy and navigation.
 */
export function resolveGettingStartedDemoExit(
  trackingPaused: boolean,
): GettingStartedDemoExit {
  return {
    auditOutcome: trackingPaused ? "skipped" : "enabled",
    status: trackingPaused ? "skipped" : "complete",
    destination: "simulated_demo",
    href: "?demo=1&screen=weekly",
  };
}
