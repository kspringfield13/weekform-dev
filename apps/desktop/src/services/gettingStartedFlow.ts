import type { Screen } from "../lib/types";
import type { GettingStartedStatus } from "./localStore";

export const GETTING_STARTED_STEP_IDS = [
  "intro",
  "privacy",
  "tracking",
  "retention",
  "ai",
  "start",
] as const;

export type GettingStartedStepId = (typeof GETTING_STARTED_STEP_IDS)[number];

export interface GettingStartedExit {
  auditOutcome: "enabled" | "skipped";
  status: Exclude<GettingStartedStatus, "unseen">;
  screen: Extract<Screen, "setup">;
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
