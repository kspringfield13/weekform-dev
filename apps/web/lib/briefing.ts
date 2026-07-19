/**
 * Team Briefing Agent — evidence-grounded, server-only synthesis over the
 * SAME deterministic aggregates and risk flags already computed by
 * lib/workload.ts. This module never imports Supabase and never touches the
 * network by itself; `generateTeamBriefing` is the only function that may
 * call OpenAI, and only when both OPENAI_API_KEY and
 * OPENAI_TEAM_BRIEFING_MODEL are configured server-side.
 *
 * Blueprint reference: docs/WEEKFORM_TEAM_CLAWFATHER_HACKATHON_BLUEPRINT.md
 * §9 "Team Briefing Agent specification".
 *
 * Hard rules encoded here:
 * - Input allowlist ONLY: team name, latest shared metrics, member display
 *   names/neutral labels, share level/freshness/review coverage, and the
 *   deterministic aggregates/risk flags from lib/workload.ts. No raw
 *   titles, evidence, notes, screenshots, unshared metrics, or credentials
 *   ever enter `BriefingInput`.
 * - Missing data stays missing (`null`/omitted), never coerced to zero.
 * - No ranking, no productivity/performance score, no burnout or
 *   HR/medical/legal/discipline language — in the prompt OR the fallback.
 * - Every risk/opportunity the model returns must cite `evidenceRefs` drawn
 *   from a fixed catalog built from the allowlisted input; unknown refs are
 *   dropped, not trusted.
 * - `OPENAI_API_KEY` is read only in this server-only module; it is never
 *   returned to a caller and never reaches the browser.
 */

import type { RiskFlag, TeamWorkloadSummary } from "./workload";
import {
  approvedSnapshotProvenance,
  memberRiskFlags,
  reviewCoveragePct,
  type MemberWorkloadInput,
} from "./workload";

// ---------------------------------------------------------------------------
// Allowlisted input
// ---------------------------------------------------------------------------

export interface BriefingMemberInput {
  /** Stable but neutral reference id, e.g. "member:1". Never the raw userId. */
  ref: string;
  /** Display name if the member set one, else a neutral label like "Member 2". */
  displayName: string;
  shareLevel: string;
  freshnessLabel: string;
  reviewCoveragePct: number | null;
  reliableCapacityPct: number | null;
  reactivePct: number | null;
  meetingPct: number | null;
  fragmentedPct: number | null;
  /** Deterministic risk flags already computed by workload.ts for this member. */
  riskFlags: RiskFlag[];
}

export interface BriefingInput {
  teamName: string;
  generatedAt: string;
  memberCount: number;
  sharingCount: number;
  members: BriefingMemberInput[];
  aggregates: TeamWorkloadSummary;
  /** refId -> human-readable description, the only facts the model may cite. */
  evidenceCatalog: Record<string, string>;
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

function neutralLabel(index: number): string {
  return `Member ${index + 1}`;
}

/**
 * Builds the allowlisted `BriefingInput` from data the manager dashboard
 * already has. Callers pass in roster/snapshot data they fetched through the
 * normal RLS-gated reads (lib/teams.ts, lib/snapshots.ts) — this function
 * does not fetch anything itself, so it is pure and unit-testable.
 */
export function buildBriefingInput(params: {
  teamName: string;
  nowIso: string;
  memberCount: number;
  roster: Array<{ userId: string; displayName: string | null }>;
  snapshotsByUser: Map<string, MemberWorkloadInput & { freshnessLabelText: string }>;
  aggregates: TeamWorkloadSummary;
}): BriefingInput {
  const evidenceCatalog: Record<string, string> = {};
  const members: BriefingMemberInput[] = [];

  params.roster.forEach((entry, index) => {
    const ref = `member:${index + 1}`;
    const displayName = entry.displayName?.trim() || neutralLabel(index);
    const snapshot = params.snapshotsByUser.get(entry.userId);

    if (!snapshot) {
      members.push({
        ref,
        displayName,
        shareLevel: "none",
        freshnessLabel: "No shared snapshot",
        reviewCoveragePct: null,
        reliableCapacityPct: null,
        reactivePct: null,
        meetingPct: null,
        fragmentedPct: null,
        riskFlags: [],
      });
      evidenceCatalog[ref] = `${displayName}: has not shared a workload snapshot.`;
      return;
    }

    const flags = memberRiskFlags(snapshot, params.nowIso);
    const coverage = reviewCoveragePct(snapshot.reviewedBlocks, snapshot.eligibleBlocks);

    members.push({
      ref,
      displayName,
      shareLevel: snapshot.shareLevel,
      freshnessLabel: snapshot.freshnessLabelText,
      reviewCoveragePct: coverage,
      reliableCapacityPct: snapshot.reliableCapacityPct,
      reactivePct: snapshot.reactivePct,
      meetingPct: snapshot.meetingPct,
      fragmentedPct: snapshot.fragmentedPct,
      riskFlags: flags,
    });

    const parts: string[] = [
      `${displayName} shares at level "${snapshot.shareLevel}" (${snapshot.freshnessLabelText}).`,
    ];
    parts.push(
      snapshot.reliableCapacityPct === null
        ? `${displayName} did not share reliable capacity.`
        : `${displayName} reliable capacity: ${pct(snapshot.reliableCapacityPct)}.`,
    );
    parts.push(
      snapshot.reactivePct === null
        ? `${displayName} did not share reactive load.`
        : `${displayName} reactive load: ${pct(snapshot.reactivePct)}.`,
    );
    parts.push(
      snapshot.meetingPct === null
        ? `${displayName} did not share meeting load.`
        : `${displayName} meeting load: ${pct(snapshot.meetingPct)}.`,
    );
    parts.push(
      snapshot.fragmentedPct === null
        ? `${displayName} did not share fragmented-work percentage.`
        : `${displayName} fragmented work: ${pct(snapshot.fragmentedPct)}.`,
    );
    parts.push(
      coverage === null
        ? `${displayName} has no reviewable blocks yet.`
        : `${displayName} review coverage: ${coverage}%.`,
    );
    evidenceCatalog[ref] = parts.join(" ");

    flags.forEach((flag) => {
      evidenceCatalog[`${ref}:risk:${flag.id}`] = `${displayName} — ${flag.title}: ${flag.explanation}`;
    });
  });

  evidenceCatalog["team:reliableCapacity"] = params.aggregates.reliableCapacity
    ? `Team median reliable capacity: ${pct(params.aggregates.reliableCapacity.median)} (range ${pct(params.aggregates.reliableCapacity.min)}–${pct(params.aggregates.reliableCapacity.max)}, ${params.aggregates.reliableCapacity.sharedCount} sharing).`
    : "Team reliable capacity: not shared by any current member.";
  evidenceCatalog["team:reactive"] = params.aggregates.reactive
    ? `Team median reactive load: ${pct(params.aggregates.reactive.median)} (range ${pct(params.aggregates.reactive.min)}–${pct(params.aggregates.reactive.max)}, ${params.aggregates.reactive.sharedCount} sharing).`
    : "Team reactive load: not shared by any current member.";
  evidenceCatalog["team:meetings"] = params.aggregates.meetings
    ? `Team median meeting load: ${pct(params.aggregates.meetings.median)} (range ${pct(params.aggregates.meetings.min)}–${pct(params.aggregates.meetings.max)}, ${params.aggregates.meetings.sharedCount} sharing).`
    : "Team meeting load: not shared by any current member.";
  evidenceCatalog["team:fragmentation"] = params.aggregates.fragmentation
    ? `Team median fragmented work: ${pct(params.aggregates.fragmentation.median)} (range ${pct(params.aggregates.fragmentation.min)}–${pct(params.aggregates.fragmentation.max)}, ${params.aggregates.fragmentation.sharedCount} sharing).`
    : "Team fragmented work: not shared by any current member.";
  evidenceCatalog["team:lowHeadroom"] =
    `Low headroom: ${params.aggregates.lowHeadroom.count} of ${params.aggregates.lowHeadroom.consideredCount} considered members are below the ${params.aggregates.lowHeadroom.thresholdPct}% prototype threshold ` +
    `(${params.aggregates.lowHeadroom.excludedStaleCount} excluded as stale, ${params.aggregates.lowHeadroom.excludedNotSharedCount} excluded as not shared).`;
  evidenceCatalog["team:sharingCoverage"] =
    `${params.aggregates.sharingCount} of ${params.aggregates.memberCount} team members have ever shared a snapshot.`;

  return {
    teamName: params.teamName,
    generatedAt: params.nowIso,
    memberCount: params.memberCount,
    sharingCount: params.aggregates.sharingCount,
    members,
    aggregates: params.aggregates,
    evidenceCatalog,
  };
}

// ---------------------------------------------------------------------------
// Structured output contract (blueprint §9.3)
// ---------------------------------------------------------------------------

export interface TeamBriefingResult {
  headline: string;
  summary: string;
  sharedEvidenceCoverage: string;
  risks: Array<{
    title: string;
    explanation: string;
    evidenceRefs: string[];
  }>;
  coordinationOpportunities: Array<{
    title: string;
    action: string;
    evidenceRefs: string[];
  }>;
  questionsForTheTeam: string[];
  limitations: string[];
}

export const AI_DISCLOSURE =
  "AI-generated from shared workload signals. This is a planning aid, not a performance score — treat it as a starting point for a conversation, not a conclusion.";

export type BriefingMode = "model" | "fallback";

export type BriefingFallbackReason =
  | "not_configured"
  | "no_data"
  | "model_error"
  | "schema_error"
  | "timeout";

export interface BriefingResponse {
  result: TeamBriefingResult;
  mode: BriefingMode;
  fallbackReason?: BriefingFallbackReason;
  model?: string;
}

const MAX_LIST_LENGTH = 8;
const MAX_TEXT_LENGTH = 600;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Filters an `evidenceRefs` array down to refs that actually exist in the
 * catalog we sent. A model that invents a reference is not "grounded" —
 * drop the invented ref rather than trust it.
 */
function sanitizeEvidenceRefs(value: unknown, catalog: Record<string, string>): string[] {
  if (!isStringArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const ref of value) {
    if (Object.prototype.hasOwnProperty.call(catalog, ref) && !seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
    if (refs.length >= MAX_LIST_LENGTH) {
      break;
    }
  }
  return refs;
}

/**
 * Validates and sanitizes an untrusted model response against the
 * `TeamBriefingResult` schema. Returns `{ ok: false }` for anything
 * malformed so the caller falls back to the deterministic briefing rather
 * than render partial or fabricated structure.
 */
export function validateBriefingResult(
  candidate: unknown,
  input: BriefingInput,
): { ok: true; result: TeamBriefingResult } | { ok: false; error: string } {
  if (typeof candidate !== "object" || candidate === null) {
    return { ok: false, error: "Model output was not a JSON object." };
  }
  const value = candidate as Record<string, unknown>;

  if (!isNonEmptyString(value.headline)) {
    return { ok: false, error: "Missing or empty headline." };
  }
  if (!isNonEmptyString(value.summary)) {
    return { ok: false, error: "Missing or empty summary." };
  }
  if (!isNonEmptyString(value.sharedEvidenceCoverage)) {
    return { ok: false, error: "Missing or empty sharedEvidenceCoverage." };
  }
  if (!Array.isArray(value.risks)) {
    return { ok: false, error: "risks must be an array." };
  }
  if (!Array.isArray(value.coordinationOpportunities)) {
    return { ok: false, error: "coordinationOpportunities must be an array." };
  }
  if (!isStringArray(value.questionsForTheTeam)) {
    return { ok: false, error: "questionsForTheTeam must be a string array." };
  }
  if (!isStringArray(value.limitations)) {
    return { ok: false, error: "limitations must be a string array." };
  }

  const risks: TeamBriefingResult["risks"] = [];
  for (const raw of value.risks.slice(0, MAX_LIST_LENGTH)) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const risk = raw as Record<string, unknown>;
    if (!isNonEmptyString(risk.title) || !isNonEmptyString(risk.explanation)) {
      continue;
    }
    risks.push({
      title: truncate(risk.title, 120),
      explanation: truncate(risk.explanation, MAX_TEXT_LENGTH),
      evidenceRefs: sanitizeEvidenceRefs(risk.evidenceRefs, input.evidenceCatalog),
    });
  }

  const opportunities: TeamBriefingResult["coordinationOpportunities"] = [];
  for (const raw of value.coordinationOpportunities.slice(0, MAX_LIST_LENGTH)) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const opportunity = raw as Record<string, unknown>;
    if (!isNonEmptyString(opportunity.title) || !isNonEmptyString(opportunity.action)) {
      continue;
    }
    opportunities.push({
      title: truncate(opportunity.title, 120),
      action: truncate(opportunity.action, MAX_TEXT_LENGTH),
      evidenceRefs: sanitizeEvidenceRefs(opportunity.evidenceRefs, input.evidenceCatalog),
    });
  }

  return {
    ok: true,
    result: {
      headline: truncate(value.headline, 160),
      summary: truncate(value.summary, MAX_TEXT_LENGTH),
      sharedEvidenceCoverage: truncate(value.sharedEvidenceCoverage, MAX_TEXT_LENGTH),
      risks,
      coordinationOpportunities: opportunities,
      questionsForTheTeam: value.questionsForTheTeam
        .slice(0, MAX_LIST_LENGTH)
        .map((question) => truncate(question, 200)),
      limitations: value.limitations.slice(0, MAX_LIST_LENGTH).map((item) => truncate(item, 200)),
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic fallback (blueprint §9: "Provide a deterministic fallback
// briefing from existing risk flags.") — no network, no randomness, same
// inputs always produce the same output.
// ---------------------------------------------------------------------------

const FALLBACK_LIMITATIONS = [
  "This is a deterministic summary of shared metrics and risk flags, not an AI-generated narrative.",
  "Based only on metrics members chose to share; a member who shares nothing is not counted as having zero workload.",
  "Thresholds behind each risk flag are labeled prototype heuristics, not organizational benchmarks.",
  "This is a planning aid for a conversation with the team, not a performance or productivity score.",
];

/** Aggregates identical risk flags across members into one deterministic risk entry. */
function groupedMemberRisks(
  input: BriefingInput,
): Array<{ title: string; explanation: string; evidenceRefs: string[] }> {
  const byFlag = new Map<
    string,
    { title: string; members: string[]; evidenceRefs: string[] }
  >();

  for (const member of input.members) {
    for (const flag of member.riskFlags) {
      if (flag.id === "stale-data") {
        continue; // surfaced via freshness/coverage text, not as a "risk"
      }
      const existing = byFlag.get(flag.id);
      const ref = `${member.ref}:risk:${flag.id}`;
      if (existing) {
        existing.members.push(member.displayName);
        existing.evidenceRefs.push(ref);
      } else {
        byFlag.set(flag.id, {
          title: flag.title,
          members: [member.displayName],
          evidenceRefs: [ref],
        });
      }
    }
  }

  return Array.from(byFlag.values()).map((entry) => ({
    title: entry.title,
    explanation: `${entry.members.length === 1 ? `${entry.members[0]} shows` : `${entry.members.length} members (${entry.members.join(", ")}) show`} this flag from their latest shared snapshot.`,
    evidenceRefs: entry.evidenceRefs,
  }));
}

/** Builds a safe, evidence-cited briefing entirely from deterministic inputs. */
export function deterministicFallbackBriefing(input: BriefingInput): TeamBriefingResult {
  if (input.sharingCount === 0) {
    return {
      headline: `No shared workload data yet for ${input.teamName}`,
      summary:
        "No member of this team has shared a workload snapshot yet, so there is nothing to summarize. Sharing is opt-in from Weekform for Mac.",
      sharedEvidenceCoverage: `Evidence comes ${approvedSnapshotProvenance(0, input.memberCount)}.`,
      risks: [],
      coordinationOpportunities: [],
      questionsForTheTeam: [
        "Would the team be open to sharing summary workload metrics to make this briefing useful?",
      ],
      limitations: FALLBACK_LIMITATIONS,
    };
  }

  const risks = groupedMemberRisks(input);

  const opportunities: TeamBriefingResult["coordinationOpportunities"] = [];
  const reactiveRisk = risks.find((risk) => risk.title === "High reactive load");
  if (reactiveRisk) {
    opportunities.push({
      title: "Batch reactive work",
      action:
        "Consider a shared window for triaging interrupts (e.g. a daily batch or an on-call rotation) so planned work is displaced less often.",
      evidenceRefs: reactiveRisk.evidenceRefs,
    });
  }
  const meetingRisk = risks.find((risk) => risk.title === "Meeting-heavy week");
  if (meetingRisk) {
    opportunities.push({
      title: "Review recurring meetings",
      action:
        "Revisit recurring meetings for necessity, attendee list, and length before adding new recurring time.",
      evidenceRefs: meetingRisk.evidenceRefs,
    });
  }
  const headroomRisk = risks.find((risk) => risk.title === "Low headroom");
  if (headroomRisk) {
    opportunities.push({
      title: "Clarify priorities before adding new work",
      action:
        "Before committing new work, confirm priority order with members who show low reliable capacity this week.",
      evidenceRefs: headroomRisk.evidenceRefs,
    });
  }
  const fragmentationRisk = risks.find((risk) => risk.title === "Fragmented focus");
  if (fragmentationRisk) {
    opportunities.push({
      title: "Protect focus blocks",
      action:
        "Try protecting a recurring block of uninterrupted time for members whose work is highly fragmented this week.",
      evidenceRefs: fragmentationRisk.evidenceRefs,
    });
  }

  const questions: string[] = [
    "Does anything here match what the team is already feeling, or does the data suggest something being missed?",
  ];
  if (input.sharingCount < input.memberCount) {
    questions.push(
      `${input.memberCount - input.sharingCount} of ${input.memberCount} members haven't shared a snapshot — would they be willing to, so this briefing reflects the whole team?`,
    );
  }
  if (headroomRisk) {
    questions.push("Is there committed work that could move to someone with more headroom right now?");
  }

  const coverageParts = [`Evidence comes ${approvedSnapshotProvenance(input.sharingCount, input.memberCount)}.`];
  const staleCount = input.members.filter((member) =>
    member.riskFlags.some((flag) => flag.id === "stale-data"),
  ).length;
  if (staleCount > 0) {
    coverageParts.push(`${staleCount} of those snapshots are stale or of unknown freshness.`);
  }
  const lowCoverageCount = input.members.filter(
    (member) => member.reviewCoveragePct !== null && member.reviewCoveragePct < 50,
  ).length;
  if (lowCoverageCount > 0) {
    coverageParts.push(`${lowCoverageCount} member(s) have review coverage below 50%, so treat their metrics as less certain.`);
  }

  return {
    headline:
      risks.length > 0
        ? `${risks.length} workload flag${risks.length === 1 ? "" : "s"} to discuss for ${input.teamName}`
        : `No workload flags raised for ${input.teamName} this week`,
    summary:
      risks.length > 0
        ? `Deterministic risk flags from shared snapshots surfaced ${risks.length} item${risks.length === 1 ? "" : "s"} worth a team conversation. See evidence references for the exact members and metrics behind each flag.`
        : "No shared snapshot currently crosses a prototype risk threshold. This does not confirm the team is fully healthy — it only reflects what was shared.",
    sharedEvidenceCoverage: coverageParts.join(" "),
    risks,
    coordinationOpportunities: opportunities,
    questionsForTheTeam: questions,
    limitations: FALLBACK_LIMITATIONS,
  };
}

// ---------------------------------------------------------------------------
// Prompt construction (pure — no network) and model invocation
// ---------------------------------------------------------------------------

const SYSTEM_INSTRUCTION = `You write a short "Team Briefing" for a manager, from workload signals members explicitly chose to share.

Rules you must follow:
- Use ONLY the facts provided below. Do not assume, guess, or infer anything not stated.
- A field marked "did not share" or "not shared" means the data is absent, not zero. Never treat missing data as zero or as evidence of low workload.
- Never rank, compare, or score people against each other. Never produce or imply a productivity, performance, or effort score.
- Never diagnose burnout, stress, or any mental- or physical-health condition. Never make medical, legal, or HR conclusions or recommend disciplinary action.
- Prefer team/process-level actions: clarify priorities, rebalance committed work, reduce or review meetings, protect focus time, batch reactive requests, reduce scope. Address the situation, not a person's character or effort.
- Every item in "risks" and "coordinationOpportunities" must include "evidenceRefs": an array of reference IDs copied EXACTLY from the evidence catalog you are given. Never invent a reference ID and never cite a fact not present in the catalog.
- State plainly that this is a planning aid that requires a human conversation, not a conclusion.
- Output must be a single JSON object matching the required schema exactly, with no extra commentary, prose, or markdown outside the JSON.`;

export interface BriefingPrompt {
  system: string;
  user: string;
}

/** Builds the exact prompt sent to the model. Pure and unit-testable. */
export function buildBriefingPrompt(input: BriefingInput): BriefingPrompt {
  const catalogLines = Object.entries(input.evidenceCatalog)
    .map(([ref, description]) => `- ${ref}: ${description}`)
    .join("\n");

  const schema = `{
  "headline": string,
  "summary": string,
  "sharedEvidenceCoverage": string,
  "risks": [{ "title": string, "explanation": string, "evidenceRefs": string[] }],
  "coordinationOpportunities": [{ "title": string, "action": string, "evidenceRefs": string[] }],
  "questionsForTheTeam": string[],
  "limitations": string[]
}`;

  const user = `Team: ${input.teamName}
Generated at: ${input.generatedAt}
Members on roster: ${input.memberCount}
Members currently sharing a snapshot: ${input.sharingCount}

Evidence catalog (the ONLY facts you may use; cite entries by their ID exactly as written):
${catalogLines}

Return one JSON object matching this shape exactly:
${schema}`;

  return { system: SYSTEM_INSTRUCTION, user };
}

export interface BriefingModelConfig {
  apiKey: string;
  model: string;
}

/**
 * Reads server-only env vars for the Team Briefing model. Returns null when
 * either is unset — callers must treat that as "run in deterministic
 * fallback mode", never guess a model ID or fabricate a key.
 */
export function getBriefingModelConfig(
  env: Record<string, string | undefined> = process.env,
): BriefingModelConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_TEAM_BRIEFING_MODEL?.trim();
  if (!apiKey || !model) {
    return null;
  }
  return { apiKey, model };
}

type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Extracts the first text output from a Responses API payload without
 * assuming a specific SDK shape (the API returns `output[]` items; we only
 * read text content, never tool calls or anything else).
 */
function extractResponseText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const root = payload as Record<string, unknown>;
  if (typeof root.output_text === "string" && root.output_text.trim()) {
    return root.output_text;
  }
  const output = root.output;
  if (!Array.isArray(output)) {
    return null;
  }
  for (const item of output) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const text = (block as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim()) {
        return text;
      }
    }
  }
  return null;
}

/**
 * Generates a Team Briefing. Runs in deterministic-fallback mode with no
 * network call whenever `OPENAI_API_KEY` / `OPENAI_TEAM_BRIEFING_MODEL` are
 * not both configured, and falls back on any model, schema, or timeout
 * failure. This is the only function in the module that performs network
 * I/O, and it only ever runs server-side (callers are server components /
 * server actions in apps/web/app).
 */
export async function generateTeamBriefing(
  input: BriefingInput,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
): Promise<BriefingResponse> {
  const config = getBriefingModelConfig(options.env ?? process.env);
  const fallback = deterministicFallbackBriefing(input);

  if (!config) {
    return { result: fallback, mode: "fallback", fallbackReason: "not_configured" };
  }
  if (input.sharingCount === 0) {
    return { result: fallback, mode: "fallback", fallbackReason: "no_data" };
  }

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) {
    return { result: fallback, mode: "fallback", fallbackReason: "model_error" };
  }

  const prompt = buildBriefingPrompt(input);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        instructions: prompt.system,
        input: prompt.user,
        store: false,
        text: { format: { type: "json_object" } },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { result: fallback, mode: "fallback", fallbackReason: "model_error", model: config.model };
    }

    const payload = await response.json();
    const text = extractResponseText(payload);
    if (!text) {
      return { result: fallback, mode: "fallback", fallbackReason: "schema_error", model: config.model };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { result: fallback, mode: "fallback", fallbackReason: "schema_error", model: config.model };
    }

    const validated = validateBriefingResult(parsed, input);
    if (!validated.ok) {
      return { result: fallback, mode: "fallback", fallbackReason: "schema_error", model: config.model };
    }

    return {
      result: {
        ...validated.result,
        // Coverage is deterministic product copy, not model-authored prose.
        sharedEvidenceCoverage: fallback.sharedEvidenceCoverage,
      },
      mode: "model",
      model: config.model,
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return {
      result: fallback,
      mode: "fallback",
      fallbackReason: isAbort ? "timeout" : "model_error",
      model: config.model,
    };
  } finally {
    clearTimeout(timer);
  }
}
