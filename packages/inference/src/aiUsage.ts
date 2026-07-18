import type {
  ActivitySession,
  ModelPrice,
  ProxyUsageEvent,
  TokenUsageDay,
  UsageMeasurement,
  WeeklyAIUsageSummary
} from "../../domain/src/models";
import { resolveModelPrice } from "../../integrations/src/usage/modelPricing";
import { normalizeWeekId } from "./capacity";

/**
 * Deterministic AI-usage model — merges exact token rollups from CSV imports
 * with proxy estimates mined from observed activity, and rolls both
 * into the weekly summary the Usage screen / agent tool / narrative consume.
 * No AI, no network. Privacy: the proxy detector reads ActivitySession fields
 * but matches window titles IN MEMORY ONLY and emits derived labels — assistant
 * names from our own keyword table, minutes, counts — NEVER raw titles.
 */

/** Sessions shorter than this are ignored — a passing tab, not an AI work session. */
const MIN_PROXY_SESSION_MINUTES = 2;

/**
 * Assumed engaged-chat cadence: about one prompt per this many minutes. Deliberately
 * conservative (undercounts fast users) — the figure is labeled an estimate everywhere.
 */
const MINUTES_PER_ESTIMATED_PROMPT = 4;

/** Per-session ceiling on estimated prompts, so one marathon session can't dominate the week. */
const MAX_ESTIMATED_PROMPTS_PER_SESSION = 30;

/**
 * Persisted-bucket ceiling. `TokenUsageDay` rollups are bounded by construction
 * (days × sources × models), but a pathological import could still bloat the
 * single persisted JSON blob — drop the OLDEST dates first past this cap.
 */
const MAX_USAGE_BUCKETS = 2000;

interface AssistantIdentity {
  assistant: string;
  provider: string;
}

/**
 * Native AI-assistant apps, matched against `app_name` (case-insensitive substring).
 * IDEs and terminals are deliberately excluded because they contain mixed activity
 * that cannot be attributed to an assistant reliably.
 */
const NATIVE_AI_APPS: ReadonlyArray<readonly [string, AssistantIdentity]> = [
  ["chatgpt", { assistant: "ChatGPT", provider: "openai" }],
  ["perplexity", { assistant: "Perplexity", provider: "perplexity" }],
  ["copilot", { assistant: "Copilot", provider: "microsoft" }],
  ["gemini", { assistant: "Gemini", provider: "google" }],
  ["poe", { assistant: "Poe", provider: "poe" }],
  ["lm studio", { assistant: "LM Studio", provider: "local" }],
  ["msty", { assistant: "Msty", provider: "local" }]
];

/** Browsers whose window titles are eligible for local-only keyword matching. */
const BROWSER_APP_NAMES: ReadonlySet<string> = new Set([
  "safari",
  "google chrome",
  "chrome",
  "arc",
  "firefox",
  "microsoft edge",
  "brave browser",
  "orion",
  "zen"
]);

/**
 * Title keywords → assistant identity for browser-based chatbots. The matched
 * keyword's LABEL is what reaches evidence and persisted data — the title itself
 * never leaves this function.
 */
const BROWSER_TITLE_KEYWORDS: ReadonlyArray<readonly [string, AssistantIdentity]> = [
  ["chatgpt", { assistant: "ChatGPT", provider: "openai" }],
  ["chat.openai", { assistant: "ChatGPT", provider: "openai" }],
  ["gemini", { assistant: "Gemini", provider: "google" }],
  ["perplexity", { assistant: "Perplexity", provider: "perplexity" }],
  ["copilot", { assistant: "Copilot", provider: "microsoft" }],
  ["poe.com", { assistant: "Poe", provider: "poe" }],
  ["deepseek", { assistant: "DeepSeek", provider: "deepseek" }],
  ["grok", { assistant: "Grok", provider: "xai" }],
  ["le chat", { assistant: "Le Chat", provider: "mistral" }],
  ["mistral", { assistant: "Le Chat", provider: "mistral" }]
];

/** Djb2 — stable, deterministic id seed (mirrors accelerate.ts / the sessionizer's local helper). */
function stableHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function finiteMinutes(value: number) {
  return Number.isFinite(value) ? value : 0;
}

/** Local calendar date key (`YYYY-MM-DD`) for an ISO timestamp, or null when unparseable. */
function localDateKey(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * ISO-8601 week id for a `YYYY-MM-DD` date key (e.g. `2026-W28`), or null for a
 * malformed key. UTC math on the calendar date, mirroring the integrations
 * importer — this package cannot import the app's `lib/date` or the
 * integrations package, so the ~10 lines are duplicated by design.
 */
function isoWeekIdOfDateKey(dateKey: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const utcDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(utcDate.getTime())) return null;
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** The ISO week id immediately before `weekId`, or null when `weekId` isn't parseable. */
function previousIsoWeekId(weekId: string): string | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(normalizeWeekId(weekId));
  if (!match) return null;
  // Jan 4 is always in ISO week 1; walk to this week's Monday, step back 7 days.
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (Number(match[2]) - 1) * 7 - 7);
  const month = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const day = String(monday.getUTCDate()).padStart(2, "0");
  return isoWeekIdOfDateKey(`${monday.getUTCFullYear()}-${month}-${day}`);
}

function matchAssistant(
  haystack: string,
  table: ReadonlyArray<readonly [string, AssistantIdentity]>
): AssistantIdentity | null {
  const lowered = haystack.toLowerCase();
  for (const [keyword, identity] of table) {
    if (lowered.includes(keyword)) return identity;
  }
  return null;
}

/**
 * Detect AI-assistant sessions in observed activity: native assistant apps by
 * `app_name`, and browser tabs by local-only `window_title` keyword matching.
 * Sessions under 2 minutes are ignored; prompt counts are conservative
 * estimates (~1 per 4 engaged minutes, capped per session) and every consumer
 * must label them as such. Pure and deterministic — safe to recompute on every
 * render, so heuristic improvements retroactively apply to retained history.
 */
export function detectProxyUsage(sessions: ActivitySession[]): ProxyUsageEvent[] {
  const events: ProxyUsageEvent[] = [];

  for (const session of sessions) {
    const minutes = finiteMinutes(session.duration_minutes);
    if (minutes < MIN_PROXY_SESSION_MINUTES) continue;
    const date = localDateKey(session.start_time);
    if (!date) continue;

    const native = matchAssistant(session.app_name, NATIVE_AI_APPS);
    let identity = native;
    let detectedVia: ProxyUsageEvent["detected_via"] = "app_name";
    if (!identity && BROWSER_APP_NAMES.has(session.app_name.toLowerCase()) && session.window_title) {
      identity = matchAssistant(session.window_title, BROWSER_TITLE_KEYWORDS);
      detectedVia = "browser_title";
    }
    if (!identity) continue;

    const roundedMinutes = Math.round(minutes);
    events.push({
      event_id: `proxy-${stableHash(session.session_id)}`,
      date,
      assistant: identity.assistant,
      provider: identity.provider,
      detected_via: detectedVia,
      session_minutes: roundedMinutes,
      estimated_prompt_count: Math.min(
        MAX_ESTIMATED_PROMPTS_PER_SESSION,
        Math.max(1, Math.round(minutes / MINUTES_PER_ESTIMATED_PROMPT))
      ),
      evidence: [
        detectedVia === "app_name"
          ? `Observed AI assistant session: ${identity.assistant} (native app), ${roundedMinutes} min`
          : `Browser AI session (${identity.assistant}, title keyword match), ${roundedMinutes} min`,
        `Estimated ~1 prompt per ${MINUTES_PER_ESTIMATED_PROMPT} min of session time (estimate)`
      ]
    });
  }

  return events;
}

/**
 * Fold proxy events into daily `TokenUsageDay` buckets (`measurement: "proxy"`,
 * `source_type: "observed"`, zero tokens, no cost). The assistant's display
 * label rides in the `model` field so per-assistant rows survive aggregation —
 * proxy sources have no real model id to report.
 */
export function proxyEventsToUsageDays(events: ProxyUsageEvent[]): TokenUsageDay[] {
  const incoming = events.map(
    (event): TokenUsageDay => ({
      date: event.date,
      source_type: "observed",
      provider: event.provider,
      model: event.assistant,
      measurement: "proxy",
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      prompt_count: event.estimated_prompt_count,
      session_minutes: event.session_minutes,
      cost_usd: null
    })
  );
  return mergeTokenUsageDays([], incoming);
}

function bucketKey(day: TokenUsageDay) {
  return `${day.date}|${day.source_type}|${day.provider}|${day.model}|${day.measurement}`;
}

/**
 * Purely additive rollup upsert: buckets sharing an identity key sum their
 * token fields, counts, minutes, and authoritative costs (null + null stays
 * null — "no authoritative cost" must not become $0). Idempotency is the
 * CALLERS' job: the CSV importer's row hashes guarantee the same source data
 * is never offered twice. Result is sorted by
 * (date, provider, model) and capped at 2000 buckets, dropping oldest dates.
 */
export function mergeTokenUsageDays(
  existing: TokenUsageDay[],
  incoming: TokenUsageDay[]
): TokenUsageDay[] {
  const merged = new Map<string, TokenUsageDay>();
  for (const day of [...existing, ...incoming]) {
    const key = bucketKey(day);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...day });
      continue;
    }
    current.input_tokens += finiteMinutes(day.input_tokens);
    current.output_tokens += finiteMinutes(day.output_tokens);
    current.cache_read_tokens += finiteMinutes(day.cache_read_tokens);
    current.cache_creation_tokens += finiteMinutes(day.cache_creation_tokens);
    current.prompt_count += finiteMinutes(day.prompt_count);
    current.session_minutes += finiteMinutes(day.session_minutes);
    current.cost_usd =
      day.cost_usd === null ? current.cost_usd : (current.cost_usd ?? 0) + day.cost_usd;
  }

  const sorted = [...merged.values()].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.provider.localeCompare(right.provider) ||
      left.model.localeCompare(right.model)
  );
  // Sorted ascending by date, so trimming from the front drops the oldest dates first.
  return sorted.length > MAX_USAGE_BUCKETS ? sorted.slice(sorted.length - MAX_USAGE_BUCKETS) : sorted;
}

/**
 * Price one bucket: an authoritative (CSV-carried) cost always wins; otherwise
 * the price map is applied to input, output, and optional cache rates. Legacy
 * two-rate entries preserve the original behavior: cache creation falls back
 * to input price, while cache reads remain unpriced.
 * Returns null when the bucket has tokens but no way to price them, and 0 for
 * a token-free bucket (nothing to price is not "unpriceable").
 */
function bucketCost(day: TokenUsageDay, priceMap: Record<string, ModelPrice>): number | null {
  if (day.cost_usd !== null) return day.cost_usd;
  const tokenBearing =
    day.input_tokens > 0 ||
    day.output_tokens > 0 ||
    day.cache_creation_tokens > 0 ||
    day.cache_read_tokens > 0;
  if (!tokenBearing) return 0;
  const price = resolveModelPrice(priceMap, day.provider, day.model, day.date);
  if (!price) return null;
  if (day.cache_read_tokens > 0 && price.cache_read_usd_per_mtok === undefined) return null;
  const cacheWritePrice = price.cache_write_usd_per_mtok ?? price.input_usd_per_mtok;
  const cacheReadPrice = price.cache_read_usd_per_mtok ?? 0;
  return (
    (day.input_tokens / 1_000_000) * price.input_usd_per_mtok +
    (day.output_tokens / 1_000_000) * price.output_usd_per_mtok +
    (day.cache_creation_tokens / 1_000_000) * cacheWritePrice +
    (day.cache_read_tokens / 1_000_000) * cacheReadPrice
  );
}

interface WeekTotals {
  total_tokens: number;
  prompt_count: number;
  has_data: boolean;
}

function weekTotals(days: TokenUsageDay[], weekId: string): WeekTotals {
  let totalTokens = 0;
  let promptCount = 0;
  let hasData = false;
  for (const day of days) {
    if (isoWeekIdOfDateKey(day.date) !== weekId) continue;
    hasData = true;
    totalTokens += day.input_tokens + day.output_tokens + day.cache_creation_tokens;
    // Week-over-week is a measurement-only trend (see WeeklyAIUsageSummary: "estimates
    // never blend into measurements"). Token deltas are already measurement-only because
    // proxy buckets carry zero tokens; prompt_count must be gated the same way so a week
    // that only added browser-AI proxy sessions doesn't read as a real "+N% prompts" jump.
    if (day.measurement === "exact") promptCount += day.prompt_count;
  }
  return { total_tokens: totalTokens, prompt_count: promptCount, has_data: hasData };
}

function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Roll a week of usage buckets (persisted exact days plus live-derived proxy
 * days) into the `WeeklyAIUsageSummary` every usage surface consumes. Cost is
 * a computed overlay: a model group is "priced" only when EVERY token-bearing
 * bucket in it could be priced (authoritative cost or price-map entry), so a
 * partially-priceable model reads as unpriced rather than silently understated.
 * A zero-token, cost-only authoritative group (from a `date,cost_usd` CSV row)
 * carries real, already-priced spend and flows into the total too.
 * Proxy buckets never participate in cost.
 */
export function computeWeeklyAIUsageSummary(
  days: TokenUsageDay[],
  weekId: string,
  priceMap: Record<string, ModelPrice>
): WeeklyAIUsageSummary {
  const week = normalizeWeekId(weekId);
  const weekDays = days.filter((day) => isoWeekIdOfDateKey(day.date) === week);

  const exact = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    prompt_count: 0
  };
  const proxy = { session_minutes: 0, estimated_prompt_count: 0, assistant_count: 0 };
  const proxyAssistants = new Set<string>();

  interface ModelGroup {
    provider: string;
    model: string;
    measurement: UsageMeasurement;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    prompt_count: number;
    session_minutes: number;
    cost_usd: number | null;
    token_bearing: boolean;
    unpriced: boolean;
    authoritative_usd: number;
  }
  const modelGroups = new Map<string, ModelGroup>();
  const dayTotals = new Map<
    string,
    { input_tokens: number; output_tokens: number; prompt_count: number; session_minutes: number }
  >();

  for (const day of weekDays) {
    if (day.measurement === "exact") {
      exact.input_tokens += day.input_tokens;
      exact.output_tokens += day.output_tokens;
      exact.cache_read_tokens += day.cache_read_tokens;
      exact.cache_creation_tokens += day.cache_creation_tokens;
      exact.prompt_count += day.prompt_count;
    } else {
      proxy.session_minutes += day.session_minutes;
      proxy.estimated_prompt_count += day.prompt_count;
      proxyAssistants.add(day.model);
    }

    const groupKey = `${day.provider}|${day.model}|${day.measurement}`;
    let group = modelGroups.get(groupKey);
    if (!group) {
      group = {
        provider: day.provider,
        model: day.model,
        measurement: day.measurement,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        prompt_count: 0,
        session_minutes: 0,
        cost_usd: day.measurement === "proxy" ? null : 0,
        token_bearing: false,
        unpriced: false,
        authoritative_usd: 0
      };
      modelGroups.set(groupKey, group);
    }
    group.input_tokens += day.input_tokens;
    group.output_tokens += day.output_tokens;
    group.cache_read_tokens += day.cache_read_tokens;
    group.cache_creation_tokens += day.cache_creation_tokens;
    group.prompt_count += day.prompt_count;
    group.session_minutes += day.session_minutes;
    if (day.measurement === "exact") {
      const tokenBearing =
        day.input_tokens > 0 ||
        day.output_tokens > 0 ||
        day.cache_creation_tokens > 0 ||
        day.cache_read_tokens > 0;
      group.token_bearing = group.token_bearing || tokenBearing;
      group.authoritative_usd += day.cost_usd ?? 0;
      const cost = bucketCost(day, priceMap);
      if (cost === null) {
        group.unpriced = true;
        group.cost_usd = null;
      } else if (!group.unpriced) {
        group.cost_usd = (group.cost_usd ?? 0) + cost;
      }
    }

    let totals = dayTotals.get(day.date);
    if (!totals) {
      totals = { input_tokens: 0, output_tokens: 0, prompt_count: 0, session_minutes: 0 };
      dayTotals.set(day.date, totals);
    }
    totals.input_tokens += day.input_tokens;
    totals.output_tokens += day.output_tokens;
    totals.prompt_count += day.prompt_count;
    totals.session_minutes += day.session_minutes;
  }
  proxy.assistant_count = proxyAssistants.size;

  const groups = [...modelGroups.values()].sort(
    (left, right) =>
      right.input_tokens + right.output_tokens + right.cache_creation_tokens -
        (left.input_tokens + left.output_tokens + left.cache_creation_tokens) ||
      left.model.localeCompare(right.model)
  );

  // A group contributes cost when it carries token-derived cost OR an authoritative
  // CSV cost. A zero-token cost-only row (`date,cost_usd`) is real, already-priced
  // spend, so it must flow into `total_usd` — otherwise the total denies spend the
  // authoritative share still reports (a self-contradiction). Such a group can never
  // be "unpriced": its cost is carried, not computed from tokens.
  const costGroups = groups.filter(
    (group) => group.measurement === "exact" && (group.token_bearing || group.authoritative_usd > 0)
  );
  const pricedGroups = costGroups.filter((group) => !group.unpriced);
  const unpricedModels = [...new Set(costGroups.filter((g) => g.unpriced).map((g) => g.model))];
  const totalUsd =
    pricedGroups.length === 0
      ? null
      : Number(pricedGroups.reduce((total, group) => total + (group.cost_usd ?? 0), 0).toFixed(2));
  const coverage: WeeklyAIUsageSummary["cost"]["coverage"] =
    pricedGroups.length === 0
      ? "none"
      : unpricedModels.length === 0
        ? "full"
        : "partial";
  // The CSV-carried share OF `total_usd`: sum authoritative cost only over the same
  // priced groups the total is built from, so it can never exceed the total it is a
  // share of (an unpriced group dropped from the total contributes to neither).
  const authoritativeUsd = Number(
    pricedGroups.reduce((total, group) => total + group.authoritative_usd, 0).toFixed(2)
  );

  const previousWeekId = previousIsoWeekId(week);
  const previous = previousWeekId ? weekTotals(days, previousWeekId) : null;
  const current = weekTotals(days, week);
  const weekOverWeek =
    previousWeekId && previous && previous.has_data
      ? {
          prev_week_id: previousWeekId,
          total_tokens_delta_pct: deltaPct(current.total_tokens, previous.total_tokens),
          prompt_count_delta_pct: deltaPct(current.prompt_count, previous.prompt_count)
        }
      : null;

  return {
    week_id: week,
    exact,
    proxy,
    by_model: groups.map((group) => ({
      provider: group.provider,
      model: group.model,
      measurement: group.measurement,
      input_tokens: group.input_tokens,
      output_tokens: group.output_tokens,
      cache_read_tokens: group.cache_read_tokens,
      cache_creation_tokens: group.cache_creation_tokens,
      prompt_count: group.prompt_count,
      session_minutes: group.session_minutes,
      cost_usd:
        group.measurement === "proxy" || group.unpriced
          ? null
          : Number((group.cost_usd ?? 0).toFixed(2))
    })),
    by_day: [...dayTotals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, totals]) => ({ date, ...totals })),
    cost: {
      total_usd: totalUsd,
      coverage,
      unpriced_models: unpricedModels,
      authoritative_usd: authoritativeUsd
    },
    week_over_week: weekOverWeek
  };
}
