import type { TokenUsageDay } from "../../../domain/src/models";
import { stableHash } from "../internal/normalize";

/**
 * Token-usage CSV import.
 *
 * Provider consoles and LLM gateways export usage CSVs with no shared schema —
 * so columns are resolved through a synonym table rather than a fixed header
 * contract, and everything degrades row-by-row: a malformed file never throws
 * (mirroring `import/rawEvents.ts`), it yields an empty result whose `error`
 * carries the reason.
 *
 * Rows may carry an authoritative cost column. That cost is summed onto the
 * bucket's `cost_usd` and always wins over the Settings price map — the map is
 * a fallback overlay for rows that only report tokens.
 *
 * Idempotency: every accepted row is identified by a `stableHash` of its
 * normalized content. The caller persists returned `row_hashes` and passes
 * them back as `knownRowHashes` on the next import, so re-uploading the same
 * export counts as `duplicates`, never double-counted usage.
 */

/** Header synonyms per logical field; first matching header (left-to-right in the file) wins. */
const HEADER_SYNONYMS: Record<UsageColumn, readonly string[]> = {
  date: ["date", "day", "timestamp", "time", "created_at", "usage_date", "start_time"],
  input_tokens: ["input_tokens", "prompt_tokens", "tokens_in", "input", "n_context_tokens_total"],
  output_tokens: [
    "output_tokens",
    "completion_tokens",
    "tokens_out",
    "output",
    "n_generated_tokens_total"
  ],
  cache_read_tokens: [
    "cache_read_tokens",
    "cache_read_input_tokens",
    "input_cached_tokens",
    "cached_input_tokens",
    "cached_tokens"
  ],
  cache_creation_tokens: [
    "cache_creation_tokens",
    "cache_creation_input_tokens",
    "cache_write_tokens"
  ],
  model: ["model", "model_name", "model_id"],
  provider: ["provider", "vendor", "service", "api"],
  cost_usd: ["cost_usd", "cost", "usd", "amount_usd", "amount", "total_cost", "spend"],
  prompt_count: [
    "prompt_count",
    "requests",
    "request_count",
    "num_requests",
    "n_requests",
    "messages"
  ]
};

type UsageColumn =
  | "date"
  | "input_tokens"
  | "output_tokens"
  | "cache_read_tokens"
  | "cache_creation_tokens"
  | "model"
  | "provider"
  | "cost_usd"
  | "prompt_count";

export interface UsageCsvImportResult {
  /** Aggregated daily buckets (`source_type: "csv_import"`, `measurement: "exact"`) from accepted rows. */
  days: TokenUsageDay[];
  /** `stableHash` per accepted row — persist and pass back as `knownRowHashes` for cross-import dedup. */
  row_hashes: string[];
  imported: number;
  /** Rows dropped for an unparseable date or no token/cost data. */
  skipped: number;
  /** Rows already imported (hash matched `knownRowHashes` or a prior row in this file). */
  duplicates: number;
  /**
   * Set when the file itself was unusable (empty, no data rows, or no
   * recognizable date + usage columns). Treated as an empty import — no throw,
   * mirroring the never-throwing calendar and raw-event sources.
   */
  error?: string;
}

export interface ParseUsageCsvOptions {
  /** Hashes of previously accepted rows; matching rows count as `duplicates`. */
  knownRowHashes?: ReadonlySet<string>;
}

/**
 * Minimal RFC-4180 tokenizer: quoted fields (with `""` escapes), embedded
 * commas/newlines inside quotes, CRLF and bare-CR line endings, BOM strip.
 * Returns rows of raw cell strings; blank lines are dropped.
 */
function tokenizeCsv(content: string): string[][] {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.trim() !== "")) {
      rows.push(row);
    }
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushCell();
    } else if (char === "\n") {
      pushRow();
    } else if (char === "\r") {
      if (text[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    pushRow();
  }
  return rows;
}

/** Normalize a header cell for synonym lookup: lowercase, trimmed, spaces/dashes → underscores. */
function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Map each logical field to the index of its first matching header, if any. */
function resolveColumns(headers: string[]): Partial<Record<UsageColumn, number>> {
  const normalized = headers.map(normalizeHeader);
  const columns: Partial<Record<UsageColumn, number>> = {};
  for (const field of Object.keys(HEADER_SYNONYMS) as UsageColumn[]) {
    for (const synonym of HEADER_SYNONYMS[field]) {
      const index = normalized.indexOf(synonym);
      if (index !== -1) {
        columns[field] = index;
        break;
      }
    }
  }
  return columns;
}

/** Local `YYYY-MM-DD` for a raw date cell: literal date prefix wins, else `Date.parse`. */
function parseDateKey(raw: string): string | null {
  const trimmed = raw.trim();
  const literal = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (literal) return literal[1];
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return null;
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${parsed.getFullYear()}-${month}-${day}`;
}

/** Non-negative finite number from a raw cell (strips `$`, commas, spaces), else null. */
function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Provider inferred from a model id's family prefix when the file has no provider column. */
function inferProvider(model: string): string {
  const lowered = model.toLowerCase();
  if (/^(gpt|o1|o3|o4)/.test(lowered)) return "openai";
  if (lowered.startsWith("gemini")) return "google";
  if (lowered.startsWith("grok")) return "xai";
  if (lowered.startsWith("deepseek")) return "deepseek";
  return "unknown";
}

interface NormalizedRow {
  date: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number | null;
  prompt_count: number;
}

function rowHash(row: NormalizedRow) {
  return stableHash(
    [
      row.date,
      row.provider,
      row.model,
      row.input_tokens,
      row.output_tokens,
      row.cache_read_tokens,
      row.cache_creation_tokens,
      row.cost_usd ?? "",
      row.prompt_count
    ].join("|")
  );
}

/**
 * Parse a token-usage CSV export into daily `TokenUsageDay` buckets WITHOUT
 * throwing. A row is accepted when its date parses AND it carries any token
 * count or a cost; everything else increments `skipped`. Duplicate rows —
 * within the file or against `knownRowHashes` — increment `duplicates` and are
 * not counted again.
 */
export function parseUsageCsv(
  content: string,
  options: ParseUsageCsvOptions = {}
): UsageCsvImportResult {
  const empty: UsageCsvImportResult = {
    days: [],
    row_hashes: [],
    imported: 0,
    skipped: 0,
    duplicates: 0
  };
  if (typeof content !== "string" || !content.trim()) {
    return { ...empty, error: "That file is empty — nothing to import." };
  }

  const rows = tokenizeCsv(content);
  if (rows.length < 2) {
    return { ...empty, error: "That file has no data rows beneath its header." };
  }

  const columns = resolveColumns(rows[0]);
  const hasUsageColumn =
    columns.input_tokens !== undefined ||
    columns.output_tokens !== undefined ||
    columns.cache_read_tokens !== undefined ||
    columns.cache_creation_tokens !== undefined ||
    columns.cost_usd !== undefined;
  if (columns.date === undefined || !hasUsageColumn) {
    return {
      ...empty,
      error:
        "Couldn't recognize the columns — the file needs a date column and at least one token or cost column."
    };
  }

  const known = options.knownRowHashes ?? new Set<string>();
  const seenInFile = new Set<string>();
  const buckets = new Map<string, TokenUsageDay>();
  const rowHashes: string[] = [];
  let imported = 0;
  let skipped = 0;
  let duplicates = 0;

  const cellAt = (row: string[], column: UsageColumn) => {
    const index = columns[column];
    return index === undefined ? undefined : row[index];
  };
  const resolvedInputHeader = columns.input_tokens === undefined
    ? ""
    : normalizeHeader(rows[0][columns.input_tokens] ?? "");

  for (const row of rows.slice(1)) {
    const date = parseDateKey(cellAt(row, "date") ?? "");
    if (!date) {
      skipped += 1;
      continue;
    }

    const model = cellAt(row, "model")?.trim() || "unknown";
    const provider = cellAt(row, "provider")?.trim().toLowerCase() || inferProvider(model);
    const reportedInputTokens = parseAmount(cellAt(row, "input_tokens")) ?? 0;
    const outputTokens = parseAmount(cellAt(row, "output_tokens")) ?? 0;
    const cacheReadTokens = parseAmount(cellAt(row, "cache_read_tokens")) ?? 0;
    const cacheCreationTokens = parseAmount(cellAt(row, "cache_creation_tokens")) ?? 0;
    // OpenAI-style prompt/input totals include cached tokens as a subset. Convert
    // those known-inclusive schemas to the domain's mutually exclusive buckets
    // so cache tokens are not billed twice. Other `input_tokens` schemas are
    // treated as exclusive unless their provider is known to include cache reads.
    const inputIncludesCache =
      resolvedInputHeader === "prompt_tokens" ||
      resolvedInputHeader === "n_context_tokens_total" ||
      (resolvedInputHeader === "input_tokens" && provider === "openai");
    const inputTokens = inputIncludesCache
      ? Math.max(0, reportedInputTokens - cacheReadTokens - cacheCreationTokens)
      : reportedInputTokens;
    const costUsd = parseAmount(cellAt(row, "cost_usd"));
    const hasTokens =
      inputTokens > 0 || outputTokens > 0 || cacheReadTokens > 0 || cacheCreationTokens > 0;
    if (!hasTokens && costUsd === null) {
      skipped += 1;
      continue;
    }

    // Only floor `prompt_count` to ≥1 for rows that actually carry token usage.
    // Honor an explicit count when present, and default a pure cost row
    // (`date,cost_usd`, no token/prompt column) to 0 so a monthly billing export
    // can't mint a fabricated "measured prompt" per row.
    const rawPromptCount = parseAmount(cellAt(row, "prompt_count"));
    const promptCount =
      rawPromptCount !== null ? Math.max(0, Math.round(rawPromptCount)) : hasTokens ? 1 : 0;

    const normalized: NormalizedRow = {
      date,
      provider,
      model,
      input_tokens: Math.round(inputTokens),
      output_tokens: Math.round(outputTokens),
      cache_read_tokens: Math.round(cacheReadTokens),
      cache_creation_tokens: Math.round(cacheCreationTokens),
      cost_usd: costUsd,
      prompt_count: promptCount
    };

    const hash = rowHash(normalized);
    if (known.has(hash) || seenInFile.has(hash)) {
      duplicates += 1;
      continue;
    }
    seenInFile.add(hash);
    rowHashes.push(hash);
    imported += 1;

    const key = `${normalized.date}|${normalized.provider}|${normalized.model}`;
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, {
        date: normalized.date,
        source_type: "csv_import",
        provider: normalized.provider,
        model: normalized.model,
        measurement: "exact",
        input_tokens: normalized.input_tokens,
        output_tokens: normalized.output_tokens,
        cache_read_tokens: normalized.cache_read_tokens,
        cache_creation_tokens: normalized.cache_creation_tokens,
        prompt_count: normalized.prompt_count,
        session_minutes: 0,
        cost_usd: normalized.cost_usd
      });
    } else {
      bucket.input_tokens += normalized.input_tokens;
      bucket.output_tokens += normalized.output_tokens;
      bucket.cache_read_tokens += normalized.cache_read_tokens;
      bucket.cache_creation_tokens += normalized.cache_creation_tokens;
      bucket.prompt_count += normalized.prompt_count;
      bucket.cost_usd =
        normalized.cost_usd === null ? bucket.cost_usd : (bucket.cost_usd ?? 0) + normalized.cost_usd;
    }
  }

  const days = [...buckets.values()].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.provider.localeCompare(right.provider) ||
      left.model.localeCompare(right.model)
  );
  return { days, row_hashes: rowHashes, imported, skipped, duplicates };
}
