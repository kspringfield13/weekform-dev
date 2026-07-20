import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";

export type PersonalAccelerationState = "error" | "connected" | "waiting";

export interface PersonalAccelerationPresentation {
  state: PersonalAccelerationState;
  statusLabel: string;
  headline: string;
  context: string;
}

/**
 * Describes availability without deriving acceleration plays from the Web
 * replica. The replica is intentionally unable to represent workflow evidence,
 * play history, recipes, or AI credentials, so a connected week is context for
 * the boundary only—not input for a browser-side substitute miner.
 */
export function buildPersonalAccelerationPresentation(
  replica: PersonalWorkloadReplicaV1 | null,
  error: string | null = null,
): PersonalAccelerationPresentation {
  if (error) {
    return {
      state: "error",
      statusLabel: "Replica unavailable",
      headline: "Acceleration availability could not be checked.",
      context: "Reload the page to retry the review-safe workspace connection.",
    };
  }

  if (!replica) {
    return {
      state: "waiting",
      statusLabel: "Waiting for Mac",
      headline: "No acceleration context is connected.",
      context: "Enable Private Web workspace in Weekform for Mac to connect a review-safe week.",
    };
  }

  const blockCount = replica.blocks.length;
  return {
    state: "connected",
    statusLabel: `${replica.weekId} · review-safe boundary`,
    headline: "Acceleration plays stay with your private work pattern.",
    context: `${blockCount} review-safe ${blockCount === 1 ? "block is" : "blocks are"} connected for ${replica.weekId}, but the evidence needed to mine and verify plays remains local.`,
  };
}
