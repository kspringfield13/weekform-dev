import type { PersonalReplicaView } from "@/lib/personalReplica";

export type PersonalWeeklyReviewStatus = "connected" | "waiting";
export type PersonalWeeklyReviewItemStatus = "ready" | "needs_attention" | "mac_only";
export type PersonalWeeklyReviewTarget = "today" | "forecast" | "summary" | "mac";

export interface PersonalWeeklyReviewItem {
  id: "work_blocks" | "sensitive_captures" | "forecast_accuracy" | "narrative";
  title: string;
  description: string;
  status: PersonalWeeklyReviewItemStatus;
  count: number | null;
  actionLabel: string;
  target: PersonalWeeklyReviewTarget;
}

export interface PersonalWeeklyReviewPresentation {
  status: PersonalWeeklyReviewStatus;
  weekId: string | null;
  doneCount: number;
  pendingCount: number;
  items: PersonalWeeklyReviewItem[];
}

/**
 * Build the Web close-out view from the positive-allowlist replica only.
 * Forecast comparisons, generated narratives, completion events, and their
 * evidence do not exist in this payload, so those checks can never be inferred
 * as ready in the browser.
 */
export function buildPersonalWeeklyReviewPresentation(
  replicas: readonly PersonalReplicaView[],
): PersonalWeeklyReviewPresentation {
  const current = replicas[0] ?? null;
  const pendingBlocks = current
    ? current.payload.blocks.filter((block) => !block.userVerified).length
    : null;

  const items: PersonalWeeklyReviewItem[] = [
    {
      id: "work_blocks",
      title: "Review work blocks",
      description: current === null
        ? "Connect Private Web workspace from your Mac before Web can show review-safe block status."
        : pendingBlocks === 0 && current.payload.blocks.length > 0
          ? "Every review-safe work block in this replica is reviewed."
          : current.payload.blocks.length === 0
            ? "No review-safe work blocks are present, so Web cannot mark this check ready."
          : `${pendingBlocks} work block${pendingBlocks === 1 ? " needs" : "s need"} review. Each change requires approval on your Mac.`,
      status: current === null
        ? "mac_only"
        : pendingBlocks === 0 && current.payload.blocks.length > 0
          ? "ready"
          : "needs_attention",
      count: pendingBlocks,
      actionLabel: current === null ? "Get Weekform for Mac" : "Open Today",
      target: current === null ? "mac" : "today",
    },
    {
      id: "sensitive_captures",
      title: "Review flagged captures",
      description: "Flagged screenshots, summaries, and local review outcomes stay on your Mac and are never reconstructed from the Web replica.",
      status: "mac_only",
      count: null,
      actionLabel: "Get Weekform for Mac",
      target: "mac",
    },
    {
      id: "forecast_accuracy",
      title: "Check forecast against actual capacity",
      description: "Forecast comparisons and calibration history stay with the complete local workload model.",
      status: "mac_only",
      count: null,
      actionLabel: "Open Forecast",
      target: "forecast",
    },
    {
      id: "narrative",
      title: "Prepare the weekly narrative",
      description: "Narrative evidence, prompts, and generated drafts are not included in the review-safe Web replica.",
      status: "mac_only",
      count: null,
      actionLabel: "Open Summary",
      target: "summary",
    },
  ];
  const doneCount = items.filter((item) => item.status === "ready").length;

  return {
    status: current === null ? "waiting" : "connected",
    weekId: current?.weekId ?? null,
    doneCount,
    pendingCount: items.length - doneCount,
    items,
  };
}
