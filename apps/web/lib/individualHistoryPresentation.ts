import type { PersonalReplicaView } from "./personalReplica";

export interface ReviewSafeActivityRow {
  blockId: string;
  weekId: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  estimatedCapacityPct: number;
  category: string;
  mode: string;
  plannedStatus: string;
  confidencePct: number;
  reviewStatus: "Reviewed" | "Needs review";
  blockerFlag: boolean;
}

export interface SyncAuditEntry {
  replicaId: string;
  weekId: string;
  revision: string;
  timestamp: string;
  title: "Review-safe week synced";
  summary: string;
}

export function buildReviewSafeActivity(
  replicas: Pick<PersonalReplicaView, "weekId" | "payload">[],
): ReviewSafeActivityRow[] {
  return replicas
    .flatMap((replica) => replica.payload.blocks.map((block) => {
      const start = new Date(block.startTime).getTime();
      const end = new Date(block.endTime).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        throw new Error(`Invalid review-safe block time range for ${block.blockId}`);
      }

      return {
        blockId: block.blockId,
        weekId: replica.weekId,
        startTime: block.startTime,
        endTime: block.endTime,
        durationMinutes: Math.round((end - start) / 60_000),
        estimatedCapacityPct: block.estimatedCapacityPct,
        category: block.category,
        mode: block.mode,
        plannedStatus: block.plannedStatus,
        confidencePct: Math.round(block.confidence * 100),
        reviewStatus: block.userVerified ? "Reviewed" as const : "Needs review" as const,
        blockerFlag: block.blockerFlag,
      };
    }))
    .sort((left, right) => (
      new Date(right.startTime).getTime() - new Date(left.startTime).getTime()
    ));
}

export function filterReviewSafeActivity(
  activity: ReviewSafeActivityRow[],
  query: string,
): ReviewSafeActivityRow[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return activity;
  return activity.filter((row) => [
    row.weekId,
    row.category,
    row.mode,
    row.plannedStatus,
    row.reviewStatus,
  ].some((value) => value.toLowerCase().includes(normalized)));
}

export function buildSyncAuditEntries(
  replicas: Pick<PersonalReplicaView, "replicaId" | "weekId" | "revision" | "syncedAt">[],
): SyncAuditEntry[] {
  return replicas
    .map((replica) => ({
      replicaId: replica.replicaId,
      weekId: replica.weekId,
      revision: replica.revision,
      timestamp: replica.syncedAt,
      title: "Review-safe week synced" as const,
      summary: `Week ${replica.weekId} received with derived workload fields only. Revision ${replica.revision}.`,
    }))
    .sort((left, right) => (
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
    ));
}

export function filterSyncAuditEntries(
  entries: SyncAuditEntry[],
  query: string,
): SyncAuditEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return entries;
  return entries.filter((entry) => [
    entry.replicaId,
    entry.weekId,
    entry.revision,
    entry.title,
    entry.summary,
  ].some((value) => value.toLowerCase().includes(normalized)));
}
