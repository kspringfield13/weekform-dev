import type { AuditEvent, SavedSkill, WorkBlock } from "../../../../packages/domain/src/models";
import type { PersistedAppState } from "../services/localStore";
import type { CloudBackupMetadata } from "../services/cloudPolicy";
import type { ConsentReceiptV1 } from "../services/consentReceipt";
import type { AgentSessionBackup } from "../services/agentSessionStorage";
import { formatDurationMinutes } from "./format";

// Local-first data portability: serialize the work ledger and audit trail to
// JSON or CSV so the user can take their data with them. Everything here runs in
// the browser/webview — the produced text is handed to `downloadTextFile`, which
// saves a file locally and never touches the network.

export type ExportFormat = "json" | "csv";

interface ExportEnvelope<T> {
  app: "Weekform";
  kind: string;
  exported_at: string;
  count: number;
  records: T[];
}

/**
 * RFC 4180 cell: quote when the value contains a comma, quote, or newline. Cells
 * that start with a formula trigger (= + - @ and tab/CR) are prefixed with a
 * single quote so spreadsheet apps treat them as text, not formulas (CSV
 * injection guard) — our exported numeric columns are never negative, so this
 * only neutralizes user/AI-authored text fields.
 */
function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function envelope<T>(kind: string, records: T[]): string {
  const payload: ExportEnvelope<T> = {
    app: "Weekform",
    kind,
    exported_at: new Date().toISOString(),
    count: records.length,
    records,
  };
  return JSON.stringify(payload, null, 2);
}

// CSV column projections. The work-ledger CSV omits the array fields
// (`evidence`, `derived_from`); the audit CSV keeps `details` as a JSON-stringified
// cell. Either way the JSON export retains every field at full fidelity.
const WORK_BLOCK_COLUMNS: Array<[string, (block: WorkBlock) => unknown]> = [
  ["work_block_id", (b) => b.work_block_id],
  ["week_id", (b) => b.week_id],
  ["start_time", (b) => b.start_time],
  ["end_time", (b) => b.end_time],
  ["estimated_capacity_pct", (b) => b.estimated_capacity_pct],
  ["category", (b) => b.category],
  ["mode", (b) => b.mode],
  ["planned_status", (b) => b.planned_status],
  ["project_name", (b) => b.project_name],
  ["stakeholder_group", (b) => b.stakeholder_group],
  ["confidence", (b) => b.confidence],
  ["user_verified", (b) => b.user_verified],
  ["blocker_flag", (b) => b.blocker_flag],
  ["notes", (b) => b.notes],
];

// Saved-skills CSV keeps every scalar; `recommended_tools` is joined into one cell
// (the JSON export retains it as an array at full fidelity). All fields are derived —
// no window titles — so exporting them to a local file is privacy-safe.
const SAVED_SKILL_COLUMNS: Array<[string, (skill: SavedSkill) => unknown]> = [
  ["signal_id", (s) => s.signal_id],
  ["play_type", (s) => s.play_type],
  ["title", (s) => s.title],
  ["detail", (s) => s.detail],
  ["recipe", (s) => s.recipe],
  ["recommended_tools", (s) => s.recommended_tools.join("; ")],
  ["estimated_minutes_saved_per_week", (s) => s.estimated_minutes_saved_per_week],
  ["saved_at", (s) => s.saved_at],
];

const AUDIT_COLUMNS: Array<[string, (event: AuditEvent) => unknown]> = [
  ["event_id", (e) => e.event_id],
  ["timestamp", (e) => e.timestamp],
  ["type", (e) => e.type],
  ["source", (e) => e.source],
  ["title", (e) => e.title],
  ["summary", (e) => e.summary],
  ["privacy_level", (e) => e.privacy_level],
  ["details", (e) => e.details],
];

export function serializeWorkLedger(blocks: WorkBlock[], format: ExportFormat): string {
  if (format === "json") return envelope("work_ledger", blocks);
  return toCsv(
    WORK_BLOCK_COLUMNS.map(([header]) => header),
    blocks.map((block) => WORK_BLOCK_COLUMNS.map(([, get]) => get(block)))
  );
}

export function serializeSavedSkills(skills: SavedSkill[], format: ExportFormat): string {
  if (format === "json") return envelope("saved_skills", skills);
  return toCsv(
    SAVED_SKILL_COLUMNS.map(([header]) => header),
    skills.map((skill) => SAVED_SKILL_COLUMNS.map(([, get]) => get(skill)))
  );
}

// ---------------------------------------------------------------------------
// Agent Skills (SKILL.md) export — turn a saved recipe into a portable runnable skill.
// Everything here is pure string building over already-derived fields
// (title/detail/recipe/tools) — no window titles, no network — so exporting to
// a local file is privacy-safe.
// ---------------------------------------------------------------------------

/** Coerce any text into a valid Agent Skill name: lowercase, only a-z/0-9/hyphen, trimmed, capped. */
export function slugifySkillName(raw: string): string {
  // NFKD splits accented letters into base + combining mark; the a-z/0-9 filter below then
  // drops the marks, so an accented title still yields a clean ASCII slug.
  const slug = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "acceleration-skill";
}

/** The skill's SKILL.md `name`: the authored slug when valid, else derived from the title. */
function skillName(skill: SavedSkill): string {
  const explicit = skill.skill_name?.trim();
  return slugifySkillName(explicit && explicit.length > 0 ? explicit : skill.title);
}

/**
 * The SKILL.md `description` (what it does + when to use it). Prefers the AI-authored value;
 * falls back to the detail/title. Single-lined and capped so the YAML stays valid and the
 * skill listing stays within the standard's budget.
 */
function skillDescription(skill: SavedSkill): string {
  const explicit = skill.skill_description?.trim();
  const base = explicit && explicit.length > 0 ? explicit : (skill.detail?.trim() || skill.title);
  const oneLine = base.replace(/\s+/g, " ").trim();
  return oneLine.length > 500 ? `${oneLine.slice(0, 499).trimEnd()}…` : oneLine;
}

/** A YAML double-quoted scalar — safe for a description that may carry colons/quotes/newlines. */
function yamlDoubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Serialize one saved skill as a complete, valid SKILL.md document. */
export function serializeSavedSkillAsSkillMd(skill: SavedSkill): string {
  const lines: string[] = [
    "---",
    `name: ${skillName(skill)}`,
    `description: ${yamlDoubleQuoted(skillDescription(skill))}`,
    "---",
    "",
    `# ${skill.title}`,
    "",
  ];
  if (skill.detail?.trim()) {
    lines.push(skill.detail.trim(), "");
  }
  lines.push("## Steps", "", skill.recipe.trim(), "");
  if (skill.recommended_tools.length > 0) {
    lines.push("## Recommended tools", "");
    for (const tool of skill.recommended_tools) lines.push(`- ${tool}`);
    lines.push("");
  }
  lines.push(
    "---",
    `_Generated by Weekform from observed work — estimated ~${formatDurationMinutes(skill.estimated_minutes_saved_per_week)} saved per week. Review before running._`,
    ""
  );
  return lines.join("\n");
}

/**
 * Bundle every saved skill into one downloadable document. Without a zip dependency we can't
 * emit real `skill-name/SKILL.md` folders, so each skill is a clearly-delimited section that
 * names its target path — split each into `.agents/skills/<name>/SKILL.md` to install.
 */
export function serializeSavedSkillsAsSkillBundle(skills: SavedSkill[], now = new Date()): string {
  const header = [
    "# Weekform — Agent Skills export",
    "",
    `${skills.length} skill${skills.length === 1 ? "" : "s"} exported ${now.toISOString()}.`,
    "Each section below is a complete Agent Skill in SKILL.md format. To install one,",
    "create a folder `.agents/skills/<name>/` and save its content as `SKILL.md` there, or drop it",
    "into any Agent Skills-compatible tool.",
  ].join("\n");
  const sections = skills.map((skill) =>
    [
      "",
      "==================================================================",
      `FILE: .agents/skills/${skillName(skill)}/SKILL.md`,
      "==================================================================",
      "",
      serializeSavedSkillAsSkillMd(skill),
    ].join("\n")
  );
  return [header, ...sections].join("\n");
}

// ---------------------------------------------------------------------------
// Full local backup — the pre-reset "keep a copy of everything" export. The
// per-class ledger/skills/audit exports above cover a slice each; this covers
// EVERY data class the "Reset all local data" action destroys, so the user can
// export before an irreversible wipe. JSON only (a mixed-shape state object has
// no meaningful CSV projection).
// ---------------------------------------------------------------------------

/**
 * A complete backup base for destroyable local state: the work ledger, recent
 * activity cache (browser/demo only), calendar/chat imports, corrections, the audit trail, every AI output
 * (forecasts, narratives, acceleration plays, saved skills, visual-context
 * insights) and the derived history/settings. Derived from `PersistedAppState`
 * so a newly-persisted field can't silently fall out of the backup — tsc forces
 * the App-side assembler to cover it. Excludes `aiConfig`: credentials never
 * belong in a plaintext export. Reset removes the Keychain credential and the
 * in-memory/provider preferences; users intentionally reconfigure AI afterward.
 *
 * `agentSession` carries the saved Agent conversation/draft. `cloudSharing`
 * carries the Account & Sharing policy + sync bookkeeping via the
 * field-by-field `buildCloudBackupMetadata` projection — auth tokens/session are
 * excluded by construction and must never be added to any export.
 */
export type FullBackup = Omit<PersistedAppState, "version" | "aiConfig"> & {
  cloudSharing: CloudBackupMetadata;
  agentSession: AgentSessionBackup;
};

export type NativeFullBackupBase = Omit<FullBackup, "activeWindowSamples">;

/**
 * The native exporter streams the complete decrypted capture journal directly
 * to disk. Remove the 2,000-row UI cache so it cannot masquerade as complete or
 * duplicate sensitive titles in the resulting backup.
 */
export function prepareNativeFullBackup(backup: FullBackup): NativeFullBackupBase {
  const { activeWindowSamples: _recentSampleCache, ...nativeBase } = backup;
  return nativeBase;
}

/** Browser/demo serializer. Native uses a streaming command for the complete encrypted journal. */
export function serializeFullBackup(backup: FullBackup, now = new Date()): string {
  const payload = {
    app: "Weekform" as const,
    kind: "full_backup",
    exported_at: now.toISOString(),
    data: backup,
  };
  return JSON.stringify(payload, null, 2);
}

// Consent-receipt CSV keeps every scalar; `shared_fields` — the byte-exact field
// allowlist of the approved payload — is joined into one cell in its recorded
// order (the JSON export retains it as an array at full fidelity). Receipts carry
// field NAMES and share metadata only — no metric values, no tokens — so
// exporting them to a local file is privacy-safe.
const CONSENT_RECEIPT_COLUMNS: Array<[string, (receipt: ConsentReceiptV1) => unknown]> = [
  ["receipt_id", (r) => r.receipt_id],
  ["recorded_at", (r) => r.recorded_at],
  ["trigger", (r) => r.trigger],
  ["destination", (r) => r.destination.kind],
  ["team_id", (r) => r.destination.team_id],
  ["week_id", (r) => r.week_id],
  ["share_level", (r) => r.share_level],
  ["client_snapshot_id", (r) => r.client_snapshot_id],
  ["content_fingerprint", (r) => r.content_fingerprint],
  ["shared_field_count", (r) => r.shared_fields.length],
  ["shared_fields", (r) => r.shared_fields.join("; ")],
];

/** Serialize the durable consent receipts (one per approved share) for local export. */
export function serializeConsentReceipts(
  receipts: ConsentReceiptV1[],
  format: ExportFormat
): string {
  if (format === "json") return envelope("consent_receipts", receipts);
  return toCsv(
    CONSENT_RECEIPT_COLUMNS.map(([header]) => header),
    receipts.map((receipt) => CONSENT_RECEIPT_COLUMNS.map(([, get]) => get(receipt)))
  );
}

export function serializeAuditTrail(events: AuditEvent[], format: ExportFormat): string {
  if (format === "json") return envelope("audit_trail", events);
  return toCsv(
    AUDIT_COLUMNS.map(([header]) => header),
    events.map((event) => AUDIT_COLUMNS.map(([, get]) => get(event)))
  );
}

export function exportMimeType(format: ExportFormat): string {
  return format === "json" ? "application/json" : "text/csv";
}

/** `weekform-work_ledger-2026-06-28-14-05-22.csv` */
export function exportFilename(kind: string, format: ExportFormat, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `weekform-${kind}-${stamp}.${format}`;
}

/** Trigger a local file download from in-memory text (browser + Tauri webview). */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
