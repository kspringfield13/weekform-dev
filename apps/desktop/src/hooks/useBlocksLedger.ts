import { useState, useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  AuditEvent,
  WorkBlock,
  OutlookCalendarEvent,
  UserCorrection,
  ReviewCopilotSuggestion,
} from "../../../../packages/domain/src/models";
import { fieldLabel, humanizeCorrectionValue } from "../lib/format";
import { capacityPctFromMinutes } from "../lib/blocks";

// Reason stamped on corrections that originate from a single-field manual relabel in the
// review UI (BlockCard selects). Exported so the "Undo last correction" affordance can
// scope itself to these — each is exactly one field on one block, so its inverse replays
// cleanly, unlike the multi-correction Review Copilot bulk apply.
export const MANUAL_REVIEW_ADJUSTMENT_REASON = "Manual review adjustment";

interface UseBlocksLedgerParams {
  initialBlocks: WorkBlock[];
  initialCalendarEvents: OutlookCalendarEvent[];
  initialCorrections: UserCorrection[];
  initialReviewSuggestions: ReviewCopilotSuggestion[];
  currentWeekId: string;
  isDemoMode: boolean;
  addAuditEvent: (event: Omit<AuditEvent, "event_id" | "timestamp"> & { timestamp?: string }) => void;
}

export function useBlocksLedger(params: UseBlocksLedgerParams) {
  const {
    initialBlocks,
    initialCalendarEvents,
    initialCorrections,
    initialReviewSuggestions,
    currentWeekId,
    isDemoMode,
    addAuditEvent,
  } = params;

  const [blocks, setBlocksRaw] = useState<WorkBlock[]>(() => initialBlocks);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  // Evaluate every functional update against the latest in-memory ledger and
  // advance the ref in the same JavaScript turn. This preserves React's public
  // setter shape while giving command application a true compare-and-swap edge
  // that cannot observe a render-stale array after a network await.
  const setBlocks = useCallback<Dispatch<SetStateAction<WorkBlock[]>>>((update) => {
    const current = blocksRef.current;
    const next = typeof update === "function"
      ? (update as (value: WorkBlock[]) => WorkBlock[])(current)
      : update;
    blocksRef.current = next;
    setBlocksRaw(next);
  }, []);
  const mutateBlocksAtomically = useCallback(<Result,>(
    mutation: (current: WorkBlock[]) => { blocks: WorkBlock[]; result: Result },
  ): Result => {
    const outcome = mutation(blocksRef.current);
    if (outcome.blocks !== blocksRef.current) {
      blocksRef.current = outcome.blocks;
      setBlocksRaw(outcome.blocks);
    }
    return outcome.result;
  }, []);
  const [calendarEvents, setCalendarEvents] = useState<OutlookCalendarEvent[]>(() => initialCalendarEvents);
  const [corrections, setCorrections] = useState<UserCorrection[]>(() => initialCorrections);
  const [reviewSuggestions, setReviewSuggestions] = useState<ReviewCopilotSuggestion[]>(() => initialReviewSuggestions);

  // Internal add correction (simplified)
  const addCorrection = useCallback((correction: Omit<UserCorrection, "correction_id" | "timestamp">) => {
    const timestamp = new Date().toISOString();
    const fullCorrection = {
      ...correction,
      correction_id: crypto.randomUUID(),
      timestamp,
    };

    setCorrections((current) => [...current, fullCorrection]);
    addAuditEvent({
      type: "user_correction",
      source: "review_layer",
      // Humanize the field name and the old→new values through the shared format
      // helpers so manual relabels persist the SAME audit shape as import/copilot
      // corrections (App.tsx routes through the same helpers) — one event type, one
      // rendered format in the Audit Log.
      title: fieldLabel(fullCorrection.field),
      summary: `${humanizeCorrectionValue(fullCorrection.field, fullCorrection.old_value)} → ${humanizeCorrectionValue(fullCorrection.field, fullCorrection.new_value)}`,
      privacy_level: "local_only",
      timestamp,
      details: {
        ...fullCorrection,
        stored_locally: true,
        sent_to_cloud: false,
      },
    });
  }, [addAuditEvent]);

  const updateBlock = useCallback(<K extends keyof WorkBlock>(blockId: string, field: K, value: WorkBlock[K]) => {
    const oldBlock = blocks.find((block) => block.work_block_id === blockId);
    if (!oldBlock || String(oldBlock[field]) === String(value)) {
      return;
    }

    setBlocks((current) =>
      current.map((block) => {
        if (block.work_block_id !== blockId) return block;
        const updated: WorkBlock = { ...block, [field]: value, user_verified: false };
        // estimated_capacity_pct is DERIVED from the block's span — computed only at
        // ingestion (capacityPctFromSpan/…FromMinutes). A manual start/end edit (the only
        // updateBlock caller that touches the time fields is BlockCard's handleSaveTime)
        // changes the span, so reprice it here on the identical scale. Otherwise the card
        // renders the recomputed duration (formatRange) next to a STALE "% of week", and
        // that stale value silently feeds every capacity aggregate, the narrative, and the
        // forecast track record — a "correction" that leaves the model wrong in the
        // opposite direction. Byte-identical for every non-time field (guarded below).
        if (field === "start_time" || field === "end_time") {
          const spanMinutes =
            (new Date(updated.end_time).getTime() - new Date(updated.start_time).getTime()) / 60_000;
          updated.estimated_capacity_pct = capacityPctFromMinutes(spanMinutes);
        }
        // blocker_flag is likewise DERIVED — at ingestion it mirrors "this block is blocked"
        // (rawEvents.ts: category === "Blocked / waiting / dependency delay" || planned_status ===
        // "blocked"). A manual category/planned_status relabel (BlockCard's selects) changes those
        // source fields, so recompute the flag here on the SAME rule; otherwise it goes stale: an
        // imported block relabeled INTO a blocked state keeps blocker_flag false, so the Blockers
        // count/badge under-report it AND capacity's `included` filter (planned_status !== "blocked"
        // || blocker_flag) drops a planned_status="blocked" block from committed load — treating two
        // blocks in an identical logical state oppositely by provenance, and skewing
        // reliable_new_work / allocation / the narrative. Recompute silently (state only); the single
        // user-made relabel is the one audited correction (mirrors the estimated_capacity_pct reprice).
        if (field === "category" || field === "planned_status") {
          updated.blocker_flag =
            updated.category === "Blocked / waiting / dependency delay" ||
            updated.planned_status === "blocked";
        }
        return updated;
      })
    );
    addCorrection({
      work_block_id: blockId,
      field: field as UserCorrection["field"],
      old_value: String(oldBlock[field]),
      new_value: String(value),
      reason: MANUAL_REVIEW_ADJUSTMENT_REASON,
    });
  }, [blocks, addCorrection]);

  const confirmBlock = useCallback((blockId: string) => {
    const oldBlock = blocks.find((block) => block.work_block_id === blockId);
    if (!oldBlock || oldBlock.user_verified) {
      return;
    }

    setBlocks((current) =>
      current.map((block) => (block.work_block_id === blockId ? { ...block, user_verified: true, confidence: Math.max(block.confidence, 0.9) } : block))
    );
    addCorrection({
      work_block_id: blockId,
      field: "verification",
      old_value: "unverified",
      new_value: "verified",
      reason: "User confirmed inferred block",
    });
  }, [blocks, addCorrection]);

  const excludeBlock = useCallback((blockId: string) => {
    const oldBlock = blocks.find((block) => block.work_block_id === blockId);
    if (!oldBlock) {
      return;
    }

    setBlocks((current) => current.filter((block) => block.work_block_id !== blockId));
    addCorrection({
      work_block_id: blockId,
      field: "exclude",
      old_value: oldBlock.project_name,
      new_value: "excluded",
      reason: "User excluded sensitive or irrelevant block",
    });
  }, [blocks, addCorrection]);

  // Expose setters for more complex cases like AI results
  return {
    blocks,
    setBlocks,
    mutateBlocksAtomically,
    calendarEvents,
    setCalendarEvents,
    corrections,
    setCorrections,
    reviewSuggestions,
    setReviewSuggestions,
    updateBlock,
    confirmBlock,
    excludeBlock,
    addCorrection,
  };
}
