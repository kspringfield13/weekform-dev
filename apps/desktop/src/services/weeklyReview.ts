// Pure, local-only state derivation for Prompt 15's optional weekly review ritual.
// This module reads caller-provided local evidence and never persists, uploads,
// generates, timestamps, or otherwise changes it.

import type {
  AuditEvent,
  VisualContextInsight,
  WeeklyNarrative,
  WorkBlock
} from "../../../../packages/domain/src/models";
import type { ForecastTrackRecordEntry } from "../../../../packages/inference/src/capacity";
import { normalizeWeekId } from "../../../../packages/inference/src/capacity";
import { getCurrentIsoWeekId } from "../lib/date";
import type { Screen } from "../lib/types";

export type WeeklyReviewItemId =
  | "work_blocks"
  | "sensitive_captures"
  | "forecast_accuracy"
  | "narrative"
  | "cloud_share";

export type WeeklyReviewItemStatus = "done" | "pending";

export interface WeeklyReviewItem {
  id: WeeklyReviewItemId;
  status: WeeklyReviewItemStatus;
  title: string;
  description: string;
  target: Screen;
  /** Pending-item count, or the signed forecast error in points; null when unavailable. */
  count: number | null;
}

export interface WeeklyReviewState {
  /** Canonical padded ISO week id. */
  weekId: string;
  items: WeeklyReviewItem[];
  doneCount: number;
  pendingCount: number;
  isComplete: boolean;
}

export interface WeeklyReviewConsentReceipt {
  week_id: string;
  client_snapshot_id: string;
  destination: { team_id: string };
}

export interface WeeklyReviewInput {
  /** The completed/closing week being reviewed, never inferred from wall-clock time. */
  weekId: string;
  blocks: ReadonlyArray<Pick<WorkBlock, "week_id" | "user_verified">>;
  visualContextInsights: ReadonlyArray<
    Pick<VisualContextInsight, "captured_at" | "sensitive_content_detected">
  >;
  /** Existing forecast comparison record; this module does not rescore forecasts. */
  forecastTrackRecord: readonly ForecastTrackRecordEntry[];
  generatedNarrative: { narrative: Pick<WeeklyNarrative, "week_id"> } | null;
  cloudSharing: { enabled: boolean; teamId: string | null };
  auditEvents: ReadonlyArray<Pick<AuditEvent, "type" | "details">>;
  consentReceipts: readonly WeeklyReviewConsentReceipt[];
}

/** Use Weekform's canonical local-week semantics for captured-at timestamps. */
function weekIdForTimestamp(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return null;
  return getCurrentIsoWeekId(parsed);
}

function item(
  id: WeeklyReviewItemId,
  done: boolean,
  title: string,
  description: string,
  target: Screen,
  count: number | null
): WeeklyReviewItem {
  return { id, status: done ? "done" : "pending", title, description, target, count };
}

function hasProvenCloudShare(input: WeeklyReviewInput, weekId: string): boolean {
  const successes = input.auditEvents.filter((event) => {
    if (event.type !== "cloud_sharing" || event.details.action !== "sync_success") return false;
    return (
      typeof event.details.week_id === "string" &&
      normalizeWeekId(event.details.week_id) === weekId &&
      typeof event.details.client_snapshot_id === "string"
    );
  });

  return successes.some((event) => {
    const snapshotId = event.details.client_snapshot_id as string;
    const auditTeamId = typeof event.details.team_id === "string" ? event.details.team_id : null;
    return input.consentReceipts.some((receipt) => {
      if (
        normalizeWeekId(receipt.week_id) !== weekId ||
        receipt.client_snapshot_id !== snapshotId
      ) {
        return false;
      }
      const receiptTeamId = receipt.destination.team_id;
      if (auditTeamId !== null && auditTeamId !== receiptTeamId) return false;
      if (
        input.cloudSharing.teamId !== null &&
        (auditTeamId !== input.cloudSharing.teamId || receiptTeamId !== input.cloudSharing.teamId)
      ) {
        return false;
      }
      return true;
    });
  });
}

/**
 * Derive the ordered close-out checklist solely from already-local evidence.
 * Disabled cloud sharing removes the share step entirely; it is never represented
 * as a failure or pressure to opt in.
 */
export function deriveWeeklyReviewState(input: WeeklyReviewInput): WeeklyReviewState {
  const weekId = normalizeWeekId(input.weekId);
  const pendingBlocks = input.blocks.filter(
    (block) => normalizeWeekId(block.week_id) === weekId && block.user_verified !== true
  ).length;
  const pendingSensitive = input.visualContextInsights.filter(
    (insight) =>
      insight.sensitive_content_detected === true && weekIdForTimestamp(insight.captured_at) === weekId
  ).length;
  const forecast = input.forecastTrackRecord.find(
    (entry) => normalizeWeekId(entry.week_id) === weekId
  );
  const narrativeAvailable =
    input.generatedNarrative !== null &&
    normalizeWeekId(input.generatedNarrative.narrative.week_id) === weekId;

  const items: WeeklyReviewItem[] = [
    item(
      "work_blocks",
      pendingBlocks === 0,
      "Review work blocks",
      pendingBlocks === 0
        ? "Every work block for this week is reviewed."
        : `${pendingBlocks} work block${pendingBlocks === 1 ? " needs" : "s need"} review.`,
      "ledger",
      pendingBlocks
    ),
    item(
      "sensitive_captures",
      pendingSensitive === 0,
      "Review flagged captures",
      pendingSensitive === 0
        ? "No sensitive captures from this week are awaiting review."
        : `${pendingSensitive} sensitive capture${pendingSensitive === 1 ? " is" : "s are"} awaiting review.`,
      "sensitive",
      pendingSensitive
    ),
    item(
      "forecast_accuracy",
      forecast !== undefined,
      "Check forecast against actual capacity",
      forecast
        ? `Forecast error: ${forecast.signed_error_pts > 0 ? "+" : ""}${forecast.signed_error_pts} points.`
        : "No settled forecast comparison is available for this week yet.",
      "forecast",
      forecast?.signed_error_pts ?? null
    ),
    item(
      "narrative",
      narrativeAvailable,
      "Prepare the weekly narrative",
      narrativeAvailable
        ? "A narrative draft is available for this week."
        : "Prepare a narrative draft from the reviewed weekly evidence.",
      "narrative",
      null
    )
  ];

  if (input.cloudSharing.enabled) {
    const shared = hasProvenCloudShare(input, weekId);
    items.push(
      item(
        "cloud_share",
        shared,
        "Confirm the approved team share",
        shared
          ? "A successful share and its matching consent receipt are recorded locally."
          : "Review the share preview and consent record for this week's snapshot.",
        "setup",
        null
      )
    );
  }

  const doneCount = items.filter((reviewItem) => reviewItem.status === "done").length;
  const pendingCount = items.length - doneCount;
  return { weekId, items, doneCount, pendingCount, isComplete: pendingCount === 0 };
}
