import type { AccelerationSignal, AuditEvent } from "../../../../packages/domain/src/models";
import type { CalendarProviderId, CalendarTransferMode } from "../../../../packages/integrations/src/calendar/calendarSync";
import { providerDescriptor as chatProviderDescriptor, type ChatProviderId } from "../../../../packages/integrations/src/chat/chatSync";
import { formatDurationMinutes } from "./format";

export function createAuditEvent(
  input: Omit<AuditEvent, "event_id" | "timestamp"> & { timestamp?: string }
): AuditEvent {
  return {
    ...input,
    event_id: crypto.randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString()
  };
}

/**
 * Record the explicit close of a weekly review ritual. The event deliberately
 * contains only the week/item identifiers and aggregate counts: the underlying
 * work labels, narrative, sensitive insight text, and share payload stay out of
 * the audit trail.
 */
export function createWeeklyReviewAuditEvent(input: {
  weekId: string;
  itemIds: string[];
  doneCount: number;
  pendingCount: number;
}): AuditEvent {
  return createAuditEvent({
    type: "weekly_review",
    source: "weekly_review",
    title: "Weekly review completed",
    summary: `Closed ${input.doneCount} of ${input.itemIds.length} review checks.`,
    privacy_level: "local_only",
    details: {
      week_id: input.weekId,
      item_ids: input.itemIds,
      done_count: input.doneCount,
      pending_count: input.pendingCount
    }
  });
}

/**
 * Build the audit event for a workplace-chat import (mirrors the inline
 * `calendar_import` event). Legacy chat imports are content-free — the parser
 * keeps timestamps and coarse attention counts while discarding conversation
 * names, provider identities, and content — so the recorded details affirm that
 * boundary (`message_content_stored: false`)
 * and never carry message content. A local file import is not a network call, so
 * `privacy_level` is `local_only`.
 */
export function createChatImportAuditEvent(input: {
  fileName: string;
  importedBlockCount: number;
  skippedRecordCount: number;
}): AuditEvent {
  const { fileName, importedBlockCount, skippedRecordCount } = input;
  return createAuditEvent({
    type: "chat_import",
    source: "chat_export",
    title: "Workplace chat imported",
    summary: `${importedBlockCount} reactive block${importedBlockCount === 1 ? "" : "s"} from ${fileName}`,
    privacy_level: "local_only",
    details: {
      file_name: fileName,
      imported_block_count: importedBlockCount,
      skipped_record_count: skippedRecordCount,
      stored_locally: true,
      sent_to_cloud: false,
      message_content_stored: false,
      conversation_names_stored: false,
      raw_provider_ids_stored: false
    }
  });
}

/** Local audit record for a chat OAuth boundary or bounded provider sync. */
export function createChatSyncAuditEvent(input: {
  provider: ChatProviderId;
  action: "configure" | "connect" | "sync" | "disconnect";
  success: boolean;
  range?: { start_date: string; end_date: string };
  coverage?: "complete" | "scope_limited" | "partial" | "rate_limited" | "permission_limited";
  fetchedCount?: number;
  normalizedCount?: number;
  droppedCount?: number;
  observedEpisodeCount?: number;
  directedReviewCount?: number;
  workloadApplied?: boolean;
  authoritative?: boolean;
  hasMore?: boolean;
}): AuditEvent {
  const descriptor = chatProviderDescriptor(input.provider);
  const pastTense = input.action === "configure"
    ? "connection setup"
    : input.action === "connect"
    ? "connection"
    : input.action === "disconnect"
      ? "disconnection"
      : "sync";
  const title = input.action === "sync" && input.success && input.hasMore
    ? `${descriptor.label} sync page retained`
    : input.action === "sync" && !input.success
      ? `${descriptor.label} sync incomplete`
      : `${descriptor.label} ${pastTense} ${input.success ? "completed" : "failed"}`;
  return createAuditEvent({
    type: "chat_import",
    source: `${input.provider}_chat_source`,
    title,
    summary: input.action === "sync" && input.success
      ? input.workloadApplied
        ? `${input.observedEpisodeCount ?? 0} observed Chat episode${input.observedEpisodeCount === 1 ? "" : "s"}; ${input.directedReviewCount ?? 0} directed signal${input.directedReviewCount === 1 ? "" : "s"} held outside capacity`
          + (input.authoritative ? " with whole-range replacement authority" : "; applied additively without whole-range replacement authority")
        : input.hasMore
          ? "A bounded content-free page was retained locally; workload transformation is waiting for the remaining provider pages."
          : "Content-free evidence was retained locally, but this run lacked complete replacement authority and did not change workload."
      : input.action === "configure" && input.success
        ? "The public connection details were saved locally without storing a Client Secret."
      : input.success
        ? `${descriptor.label} ${pastTense} completed without exposing message content to the workload model.`
        : `${descriptor.label} ${pastTense} did not complete; workload evidence was unchanged.`,
    privacy_level: "local_only",
    details: {
      provider: input.provider,
      action: input.action,
      success: input.success,
      range_start: input.range?.start_date ?? null,
      range_end: input.range?.end_date ?? null,
      coverage: input.coverage ?? null,
      fetched_count: input.fetchedCount ?? null,
      normalized_count: input.normalizedCount ?? null,
      dropped_count: input.droppedCount ?? null,
      observed_episode_count: input.observedEpisodeCount ?? null,
      directed_review_count: input.directedReviewCount ?? null,
      workload_model_applied: input.workloadApplied ?? false,
      destructive_replacement_authority: input.authoritative ?? false,
      more_provider_pages: input.hasMore ?? false,
      credentials_saved_to_keychain:
        input.action === "connect" ? (input.success ? true : null) : null,
      public_connection_config_saved_to_keychain:
        input.action === "configure" ? (input.success ? true : null) : null,
      client_secret_requested: false,
      credentials_removed:
        input.action === "disconnect" ? (input.success ? true : null) : null,
      content_discarded_at_native_boundary: true,
      message_content_stored: false,
      conversation_names_stored: false,
      raw_provider_ids_in_workload_state: false,
      provider_keychain_state_may_have_changed:
        input.success ? input.action !== "disconnect" : true,
      canonical_chat_evidence_sent_to_ai: false,
      derived_chat_blocks_follow_existing_ai_controls: true,
      chat_source_detail_sent_to_manager: false,
      derived_aggregate_share_policy_unchanged: true,
      canonical_chat_evidence_sent_to_weekform_cloud: false,
      derived_chat_blocks_follow_existing_replica_controls: true,
      oauth_credentials_may_transit_token_broker:
        input.provider === "webex" && (input.action === "connect" || input.action === "sync"),
      oauth_broker_handles_chat_data: false
    }
  });
}

/**
 * Build the audit event for an Outlook `.ics` calendar import. A local file import is
 * not a network call, so `privacy_level` is `local_only`, and the details affirm the
 * privacy invariant (`email_bodies: false`, `meeting_notes: false`). The import is an
 * UPSERT merge — re-importing never drops previously-stored events — so the recorded
 * delta is added / updated / unchanged against the prior calendar (there is no truthful
 * "removed" count), making a re-import auditable rather than a silent no-op.
 */
export function createCalendarImportAuditEvent(input: {
  fileName?: string;
  provider?: CalendarProviderId;
  mode?: CalendarTransferMode;
  range?: { start_date: string; end_date: string };
  importedEventIds: string[];
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  previousEventCount: number;
  removedCount?: number;
}): AuditEvent {
  const {
    fileName = "calendar export",
    provider = "outlook",
    mode = "file_import",
    range,
    importedEventIds,
    addedCount,
    updatedCount,
    unchangedCount,
    previousEventCount,
    removedCount = 0,
  } = input;
  const importedCount = importedEventIds.length;
  const providerLabel = provider === "outlook" ? "Outlook Calendar" : provider === "google" ? "Google Calendar" : "Apple Calendar";
  const action = mode === "live_sync" ? "synced" : "imported";
  return createAuditEvent({
    type: "calendar_import",
    source: `${provider}_${mode}`,
    title: `${providerLabel} ${action}`,
    summary: mode === "live_sync"
      ? `${importedCount} event${importedCount === 1 ? "" : "s"} read for ${range?.start_date ?? "selected dates"}–${range?.end_date ?? "selected dates"}`
      : `${importedCount} event${importedCount === 1 ? "" : "s"} parsed from ${fileName}`,
    privacy_level: "local_only",
    details: {
      provider,
      transfer_mode: mode,
      file_name: fileName,
      range_start: range?.start_date ?? null,
      range_end: range?.end_date ?? null,
      imported_event_count: importedCount,
      added_event_count: addedCount,
      updated_event_count: updatedCount,
      unchanged_event_count: unchangedCount,
      removed_event_count: removedCount,
      previous_event_count: previousEventCount,
      event_ids: importedEventIds,
      stored_locally: true,
      sent_to_cloud: false,
      email_bodies: false,
      meeting_notes: false
    }
  });
}

/**
 * Build the audit event for a usage-CSV import (mirrors `createChatImportAuditEvent`).
 * Usage imports carry token counts, model ids, dates, and optional costs — no prompt
 * text exists in the format — so the details affirm that (`prompt_text: false`). A
 * local file import is not a network call, so `privacy_level` is `local_only`.
 */
export function createUsageImportAuditEvent(input: {
  fileName: string;
  importedRowCount: number;
  skippedRowCount: number;
  duplicateRowCount: number;
}): AuditEvent {
  const { fileName, importedRowCount, skippedRowCount, duplicateRowCount } = input;
  return createAuditEvent({
    type: "usage_import",
    source: "usage_csv",
    title: "Token usage CSV imported",
    summary: `${importedRowCount} usage row${importedRowCount === 1 ? "" : "s"} from ${fileName}`,
    privacy_level: "local_only",
    details: {
      file_name: fileName,
      imported_row_count: importedRowCount,
      skipped_row_count: skippedRowCount,
      duplicate_row_count: duplicateRowCount,
      stored_locally: true,
      sent_to_cloud: false,
      prompt_text: false
    }
  });
}

/**
 * Build the audit event for a change to the AI-usage settings (observed estimates,
 * manager-summary toggle, and price-map edits). Consent changes are exactly what the
 * audit trail exists to explain, so each change records the new flag states and
 * the price-map size — never the map contents (model pricing is user config, not
 * needed for explainability).
 */
export function createUsageSettingsAuditEvent(input: {
  changedFields: string[];
  observedProxyEnabled: boolean;
  includeInManagerSummary: boolean;
  priceMapEntryCount: number;
}): AuditEvent {
  const {
    changedFields,
    observedProxyEnabled,
    includeInManagerSummary,
    priceMapEntryCount
  } = input;
  return createAuditEvent({
    type: "usage_settings",
    source: "settings",
    title: "AI usage settings changed",
    summary: `Updated ${changedFields.join(", ")}`,
    privacy_level: "local_only",
    details: {
      changed_fields: changedFields,
      observed_proxy_enabled: observedProxyEnabled,
      include_in_manager_summary: includeInManagerSummary,
      price_map_entry_count: priceMapEntryCount,
      stored_locally: true,
      sent_to_cloud: false
    }
  });
}

/** The discrete Account & Sharing actions the local audit trail records. */
export type CloudSharingAuditAction =
  | "connect"
  | "policy_change"
  | "sync_success"
  | "sync_failure"
  | "delete"
  | "pause"
  | "disconnect"
  | "personal_sync_success"
  | "personal_sync_failure";

const CLOUD_SHARING_TITLES: Record<CloudSharingAuditAction, string> = {
  connect: "Weekform Web account connected",
  policy_change: "Cloud sharing policy changed",
  sync_success: "Workload snapshot synced to team",
  sync_failure: "Workload snapshot sync failed",
  delete: "Synced snapshots deleted from team",
  pause: "Cloud sharing paused",
  disconnect: "Weekform Web account disconnected",
  personal_sync_success: "Private Web workspace synced",
  personal_sync_failure: "Private Web workspace sync failed"
};

/**
 * Build the audit event for a discrete Account & Sharing action (connect, policy
 * change, sync success/failure, delete-my-snapshots, pause, disconnect). Only sync
 * success/failure and delete are network mutations that involve derived workload
 * data, so they carry `privacy_level: "derived_only"` and `sent_to_cloud: true`;
 * account/policy actions are local decisions (`local_only`). Details may name the
 * recipient team id, week, share level, and metric COUNTS — never metric values,
 * raw payloads, auth tokens, or anything outside the shared-snapshot allowlist.
 */
export function createCloudSharingAuditEvent(input: {
  action: CloudSharingAuditAction;
  summary: string;
  details?: Record<string, unknown>;
}): AuditEvent {
  const { action, summary, details = {} } = input;
  const networkAction = action === "sync_success" || action === "sync_failure" || action === "delete"
    || action === "personal_sync_success" || action === "personal_sync_failure";
  return createAuditEvent({
    type: "cloud_sharing",
    source: "cloud_sync",
    title: CLOUD_SHARING_TITLES[action],
    summary,
    privacy_level: networkAction ? "derived_only" : "local_only",
    details: {
      action,
      ...details,
      stored_locally: true,
      sent_to_cloud: action === "sync_success" || action === "delete" || action === "personal_sync_success",
      auth_tokens: false,
      raw_activity: false
    }
  });
}

/**
 * Build the audit event for a discrete user action on an Acceleration Play: hide
 * (`dismissed`), snapshot its generated recipe into the Saved Skills library
 * (`saved_to_library`), or mark it acted on. Plays are mined from the user's observed work, so the event
 * is `derived_only`: its details carry only the signal id, play type, derived source ids,
 * and the estimated minutes — never raw window titles (the miner never emits them;
 * `window_titles: false` affirms the invariant). The deterministic miner re-derives plays
 * continuously, so only the DISCRETE user actions are logged here; the AI-synthesis
 * "generated" event lands in the opt-in AI layer (D2), where a network call makes it the
 * discrete action to record.
 */
export function createAccelerationPlayAuditEvent(input: {
  action: "dismissed" | "saved_to_library" | "acted_on";
  signal: AccelerationSignal;
}): AuditEvent {
  const { action, signal } = input;
  const titles: Record<typeof action, string> = {
    dismissed: "Acceleration play dismissed",
    saved_to_library: "Acceleration skill saved to library",
    acted_on: "Acceleration play marked acted on"
  };
  const summaries: Record<typeof action, string> = {
    dismissed: `Dismissed the "${signal.title}" play`,
    saved_to_library: `Saved the "${signal.title}" skill recipe to your library`,
    acted_on: `Marked the "${signal.title}" play as acted on`
  };
  return createAuditEvent({
    type: "acceleration_engine",
    source: "acceleration_engine",
    title: titles[action],
    summary: `${summaries[action]} (~${formatDurationMinutes(signal.estimated_minutes_saved_per_week)}/week)`,
    privacy_level: "derived_only",
    details: {
      action,
      signal_id: signal.signal_id,
      play_type: signal.type,
      estimated_minutes_saved_per_week: signal.estimated_minutes_saved_per_week,
      derived_from: signal.derived_from,
      window_titles: false,
      stored_locally: true,
      sent_to_cloud: false
    }
  });
}
