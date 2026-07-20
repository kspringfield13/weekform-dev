// Durable consent receipts for approved cloud shares (expansion roadmap A3).
//
// THE RULE: a receipt is a local, exportable record of exactly what the user's
// approved payload contained when it left the device — timestamp, snapshot id,
// the EXACT field allowlist, share level, and destination. The allowlist is
// derived FROM the approved `SharedWorkloadSnapshotV1` object itself (the same
// reference the consent preview showed and the sync uploaded), never from the
// policy or a second calculation, so the receipt can neither claim more nor
// less than what was actually sent. `verifyConsentReceipt` proves byte-exact
// agreement between a receipt and a payload; any divergence is a typed failure.
//
// Pure and deterministic: same inputs → same receipt. Timestamps and ids are
// injected by the caller (mirrors `sharedSnapshot.ts` / `cloudScheduler.ts`).
// Receipts carry NO auth tokens, session material, metric values, or raw
// activity — field NAMES and share metadata only.

import type { CloudShareLevel, SharedWorkloadSnapshotV1 } from "../../../../packages/domain/src/cloud";

/** What triggered the approved share the receipt records. */
export type ConsentReceiptTrigger = "manual" | "auto";

/**
 * The only v1 destination: a Weekform Web team. Modeled as a tagged record so
 * a future connector destination (roadmap B3) is a new `kind`, not a re-reading
 * of an ambiguous string.
 */
export interface ConsentReceiptDestination {
  kind: "weekform_cloud_team";
  team_id: string;
}

/**
 * One durable receipt per approved share. Persisted in local storage alongside
 * the audit trail (`localStore.ts`) and included in the full backup + the
 * dedicated receipt export (`dataExport.ts`). snake_case like the local models —
 * this record never goes on the wire.
 */
export interface ConsentReceiptV1 {
  version: 1;
  receipt_id: string;
  /** ISO timestamp of the successful share the receipt records. */
  recorded_at: string;
  trigger: ConsentReceiptTrigger;
  destination: ConsentReceiptDestination;
  /** The uploaded payload's idempotent snapshot id. */
  client_snapshot_id: string;
  /** Deterministic content fingerprint of the approved payload (sharedSnapshot.ts). */
  content_fingerprint: string;
  week_id: string;
  share_level: CloudShareLevel;
  /**
   * The exact field allowlist of the approved payload, one canonical path per
   * shared field (see `payloadFieldAllowlist`). Byte-exact against the payload:
   * `verifyConsentReceipt` compares the canonical serializations as strings.
   */
  shared_fields: string[];
}

/**
 * Canonical, deterministic field allowlist of an approved payload — derived by
 * walking the payload's OWN keys (sorted), so a field can only appear here if
 * it is actually present on the uploaded object, and a future payload field
 * automatically shows up in new receipts instead of escaping them.
 *
 * - `metrics` expands to one `metrics.<key>` entry per PRESENT metric — a
 *   disabled or non-finite metric is absent from the payload, so it is absent
 *   here too (null is never zero; absence is recorded by omission).
 * - Allocation sections expand to the section name plus one
 *   `<section>.<label>` entry per shared slice — project NAMES are consented
 *   data, so the receipt records exactly which labels left the device. An
 *   absent section contributes nothing.
 * - `reviewCoverage` expands to its (sorted) numeric field names.
 * - Remaining top-level scalars (teamId, weekId, shareLevel, ids, timestamps)
 *   appear by name.
 */
export function payloadFieldAllowlist(payload: SharedWorkloadSnapshotV1): string[] {
  const fields: string[] = [];
  const record = payload as unknown as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    if (key === "metrics" && typeof value === "object" && value !== null) {
      for (const metricKey of Object.keys(value).sort()) {
        fields.push(`metrics.${metricKey}`);
      }
      continue;
    }
    if (
      (key === "categoryAllocation" || key === "workModeAllocation" || key === "projectAllocation") &&
      Array.isArray(value)
    ) {
      fields.push(key);
      const labels = value
        .map((entry) => (typeof (entry as { label?: unknown })?.label === "string" ? (entry as { label: string }).label : null))
        .filter((label): label is string => label !== null)
        .sort((a, b) => a.localeCompare(b));
      for (const label of labels) fields.push(`${key}.${label}`);
      continue;
    }
    if (key === "reviewCoverage" && typeof value === "object" && value !== null) {
      for (const coverageKey of Object.keys(value).sort()) {
        fields.push(`reviewCoverage.${coverageKey}`);
      }
      continue;
    }
    fields.push(key);
  }
  return fields;
}

export interface BuildConsentReceiptInput {
  /** The EXACT approved payload the sync uploaded (same reference as the preview). */
  payload: SharedWorkloadSnapshotV1;
  /** Content fingerprint from the build result that produced `payload`. */
  fingerprint: string;
  trigger: ConsentReceiptTrigger;
  /** Caller-injected id (crypto.randomUUID at the call site) so the builder stays pure. */
  receiptId: string;
  /** Caller-injected ISO timestamp of the successful share. */
  recordedAt: string;
}

/**
 * Build the receipt FROM the approved payload's own keys. Deterministic: same
 * inputs → deep-equal receipt. Every payload-derived field is copied by name —
 * no spread — so nothing outside this contract can ride along.
 */
export function buildConsentReceipt(input: BuildConsentReceiptInput): ConsentReceiptV1 {
  const { payload, fingerprint, trigger, receiptId, recordedAt } = input;
  return {
    version: 1,
    receipt_id: receiptId,
    recorded_at: recordedAt,
    trigger,
    destination: { kind: "weekform_cloud_team", team_id: payload.teamId },
    client_snapshot_id: payload.clientSnapshotId,
    content_fingerprint: fingerprint,
    week_id: payload.weekId,
    share_level: payload.shareLevel,
    shared_fields: payloadFieldAllowlist(payload)
  };
}

/** Byte-exact verification outcome. `ok: false` names every divergence. */
export type ConsentReceiptVerification =
  | { ok: true }
  | {
      ok: false;
      /** Fields present on the payload but missing from the receipt's allowlist. */
      missingFromReceipt: string[];
      /** Fields claimed by the receipt but absent from the payload. */
      extraInReceipt: string[];
      /** Envelope fields (ids, week, level, destination) that disagree. */
      envelopeMismatches: string[];
    };

/**
 * Prove a receipt matches a payload byte-exactly: the receipt's allowlist must
 * equal the payload's canonical allowlist as SERIALIZED STRINGS (order, spelling,
 * and count included), and the envelope fields must agree verbatim. Any
 * divergence — an added metric, a removed one, a renamed project label, a
 * different snapshot id or share level — fails with the exact differences named.
 */
export function verifyConsentReceipt(
  receipt: ConsentReceiptV1,
  payload: SharedWorkloadSnapshotV1
): ConsentReceiptVerification {
  const expectedFields = payloadFieldAllowlist(payload);
  const expectedSerialized = JSON.stringify(expectedFields);
  const actualSerialized = JSON.stringify(receipt.shared_fields);

  const expectedSet = new Set(expectedFields);
  const actualSet = new Set(receipt.shared_fields);
  const missingFromReceipt = expectedFields.filter((field) => !actualSet.has(field));
  const extraInReceipt = receipt.shared_fields.filter((field) => !expectedSet.has(field));

  const envelopeMismatches: string[] = [];
  if (receipt.client_snapshot_id !== payload.clientSnapshotId) envelopeMismatches.push("client_snapshot_id");
  if (receipt.week_id !== payload.weekId) envelopeMismatches.push("week_id");
  if (receipt.share_level !== payload.shareLevel) envelopeMismatches.push("share_level");
  if (receipt.destination.kind !== "weekform_cloud_team" || receipt.destination.team_id !== payload.teamId) {
    envelopeMismatches.push("destination");
  }

  if (expectedSerialized === actualSerialized && envelopeMismatches.length === 0) {
    return { ok: true };
  }
  return { ok: false, missingFromReceipt, extraInReceipt, envelopeMismatches };
}

const SHARE_LEVELS: ReadonlySet<CloudShareLevel> = new Set<CloudShareLevel>([
  "summary",
  "categories",
  "projects"
]);

const TRIGGERS: ReadonlySet<ConsentReceiptTrigger> = new Set<ConsentReceiptTrigger>([
  "manual",
  "auto"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate persisted receipts (localStore parse boundary). A receipt is a
 * consent RECORD, so a malformed one is DROPPED whole rather than normalized —
 * silently repairing `shared_fields` would fabricate a different consent claim
 * than the one that was written. Valid receipts pass through value-identical.
 */
export function parseConsentReceipts(value: unknown): ConsentReceiptV1[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ConsentReceiptV1 => {
    if (
      !isRecord(entry) ||
      entry.version !== 1 ||
      typeof entry.receipt_id !== "string" ||
      typeof entry.recorded_at !== "string" ||
      !TRIGGERS.has(entry.trigger as ConsentReceiptTrigger) ||
      typeof entry.client_snapshot_id !== "string" ||
      typeof entry.content_fingerprint !== "string" ||
      typeof entry.week_id !== "string" ||
      !SHARE_LEVELS.has(entry.share_level as CloudShareLevel) ||
      !Array.isArray(entry.shared_fields) ||
      !entry.shared_fields.every((field) => typeof field === "string")
    ) {
      return false;
    }
    const destination = entry.destination;
    return (
      isRecord(destination) &&
      destination.kind === "weekform_cloud_team" &&
      typeof destination.team_id === "string"
    );
  });
}
