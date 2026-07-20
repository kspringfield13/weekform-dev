import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";

const MAX_QUESTION_LENGTH = 600;
const MAX_ANSWER_LENGTH = 6_000;

export interface PersonalAgentContext {
  weekId: string;
  sourceUpdatedAt: string;
  reliableCapacityPct: number;
  allocatedPct: number;
  reactivePct: number;
  plannedPct: number;
  fragmentedPct: number;
  meetingPct: number;
  carryoverRiskPct: number;
  summaryConfidencePct: number;
  reviewedBlockCount: number;
  pendingReviewCount: number;
  blockerCount: number;
  modeCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  evidenceCatalog: Record<string, string>;
}

export type PersonalAgentFallbackReason =
  | "not_configured"
  | "provider_error"
  | "timeout"
  | "invalid_response";

export interface PersonalAgentResponse {
  answer: string;
  evidence: string[];
  limitations: string[];
  mode: "model" | "fallback" | "mac_handoff";
  fallbackReason?: PersonalAgentFallbackReason;
  model?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePersonalAgentQuestion(value: unknown): string | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !("question" in value)) return null;
  if (typeof value.question !== "string") return null;
  const question = value.question.trim();
  if (!question || question.length > MAX_QUESTION_LENGTH) return null;
  return question;
}

function counts(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

function catalogEntries(catalog: Record<string, string>, refs: string[]): string[] {
  return refs.flatMap((ref) => {
    const entry = catalog[ref];
    return entry === undefined ? [] : [entry];
  });
}

/**
 * Reduces the already-positive-allowlisted replica one more time before it can
 * reach an AI provider. No block identifiers, timestamps, revisions, notes,
 * titles, evidence, or raw capture fields are representable here.
 */
export function buildPersonalAgentContext(replica: PersonalWorkloadReplicaV1): PersonalAgentContext {
  const capacity = replica.capacity;
  const reviewedBlockCount = replica.blocks.filter((block) => block.userVerified).length;
  const context = {
    weekId: replica.weekId,
    sourceUpdatedAt: replica.sourceUpdatedAt,
    reliableCapacityPct: Math.round(capacity.reliableNewWorkCapacityPct),
    allocatedPct: Math.round(capacity.allocatedPct),
    reactivePct: Math.round(capacity.reactivePct),
    plannedPct: Math.round(capacity.plannedPct),
    fragmentedPct: Math.round(capacity.fragmentedWorkPct),
    meetingPct: Math.round(capacity.meetingPct),
    carryoverRiskPct: Math.round(capacity.carryoverRiskPct),
    summaryConfidencePct: Math.round(capacity.summaryConfidence * 100),
    reviewedBlockCount,
    pendingReviewCount: replica.blocks.length - reviewedBlockCount,
    blockerCount: replica.blocks.filter((block) => block.blockerFlag).length,
    modeCounts: counts(replica.blocks.map((block) => block.mode)),
    categoryCounts: counts(replica.blocks.map((block) => block.category)),
  };
  return {
    ...context,
    evidenceCatalog: {
      "week:capacity": `${context.weekId}: ${context.reliableCapacityPct}% reliable new-work capacity and ${context.allocatedPct}% allocated.`,
      "week:load": `${context.plannedPct}% planned, ${context.reactivePct}% reactive, ${context.fragmentedPct}% fragmented, and ${context.meetingPct}% meetings.`,
      "week:risk": `${context.carryoverRiskPct}% carryover risk and ${context.blockerCount} review-safe blocked work block(s).`,
      "week:review": `${context.reviewedBlockCount} reviewed and ${context.pendingReviewCount} pending-review block(s); summary confidence ${context.summaryConfidencePct}%.`,
      "week:modes": `Review-safe work-mode counts: ${JSON.stringify(context.modeCounts)}.`,
      "week:categories": `Review-safe category counts: ${JSON.stringify(context.categoryCounts)}.`,
    },
  };
}

const ACTION_INTENT = /^(?:(?:please|can you|could you|would you|go ahead and|i want you to)\s+)?(?:delete|reset|exclude|relabel|confirm|approve|classify|capture|connect|disconnect|pause|resume|generate (?:a )?(?:forecast|summary|narrative)|change|update|edit)\b/i;

export function isPersonalAgentActionIntent(question: string): boolean {
  return ACTION_INTENT.test(question);
}

function deterministicAnswer(context: PersonalAgentContext, question: string): PersonalAgentResponse {
  const normalized = question.toLowerCase();
  let answer: string;
  let refs: string[];
  if (/fit|capacity|commit|plan|take on/.test(normalized)) {
    answer = `Your latest review-safe published week shows ${context.reliableCapacityPct}% reliable capacity for new work, with ${context.allocatedPct}% already allocated. Treat that as a planning bound, not a promise: keep room for the ${context.reactivePct}% reactive load already visible and review ${context.pendingReviewCount} pending block${context.pendingReviewCount === 1 ? "" : "s"} before committing.`;
    refs = ["week:capacity", "week:load", "week:review"];
  } else if (/risk|carry|fragment|reactive|block/.test(normalized)) {
    answer = `The review-safe risk signals are ${context.carryoverRiskPct}% carryover risk, ${context.reactivePct}% reactive load, ${context.fragmentedPct}% fragmented work, and ${context.blockerCount} blocked block${context.blockerCount === 1 ? "" : "s"}. Start with the largest of those pressures and verify any pending blocks on Mac before changing the plan.`;
    refs = ["week:risk", "week:load", "week:review"];
  } else {
    answer = `For ${context.weekId}, the published summary shows ${context.reliableCapacityPct}% reliable capacity, ${context.plannedPct}% planned load, and ${context.reactivePct}% reactive load. I can explain capacity, workload risk, review coverage, or what may fit next from this review-safe summary.`;
    refs = ["week:capacity", "week:load", "week:review"];
  }
  return {
    answer,
    evidence: catalogEntries(context.evidenceCatalog, refs),
    limitations: ["This answer uses only the latest review-safe Web replica; raw activity, titles, notes, screenshots, and local evidence are not available."],
    mode: "fallback",
  };
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (input: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}) => Promise<FetchResponse>;

function responseText(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  if (!Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const block of item.content) {
      if (isRecord(block) && typeof block.text === "string" && block.text.trim()) return block.text.trim();
    }
  }
  return null;
}

function validatedModelAnswer(value: unknown, context: PersonalAgentContext): Omit<PersonalAgentResponse, "mode" | "model"> | null {
  if (!isRecord(value) || typeof value.answer !== "string") return null;
  const answer = value.answer.trim();
  if (!answer || answer.length > MAX_ANSWER_LENGTH || !Array.isArray(value.evidenceRefs) || !Array.isArray(value.limitations)) return null;
  const refs = value.evidenceRefs.filter((ref): ref is string => typeof ref === "string" && ref in context.evidenceCatalog);
  if (refs.length === 0) return null;
  const limitations = value.limitations.filter((item): item is string => typeof item === "string" && item.trim().length > 0 && item.length <= 300).slice(0, 4);
  return {
    answer,
    evidence: catalogEntries(context.evidenceCatalog, [...new Set(refs)].slice(0, 6)),
    limitations,
  };
}

export async function generatePersonalAgentAnswer(
  context: PersonalAgentContext,
  question: string,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
): Promise<PersonalAgentResponse> {
  if (isPersonalAgentActionIntent(question)) {
    return {
      answer: "That request would change local Weekform truth. Open Weekform for Mac to review and approve it; Web Ask is read-only and did not run the action.",
      evidence: [],
      limitations: ["No model call or state mutation was performed."],
      mode: "mac_handoff",
    };
  }

  const fallback = deterministicAnswer(context, question);
  const env = options.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_PERSONAL_AGENT_MODEL?.trim();
  if (!apiKey || !model) return { ...fallback, fallbackReason: "not_configured" };
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) return { ...fallback, fallbackReason: "provider_error", model };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        store: false,
        instructions: "You are Weekform Agent. Answer only from the supplied review-safe evidence catalog. Never claim access to raw activity, titles, notes, screenshots, local files, or omitted evidence. Do not execute or imply actions. Return JSON with answer (string), evidenceRefs (catalog keys only), and limitations (string array).",
        input: JSON.stringify({ question, evidenceCatalog: context.evidenceCatalog }),
        text: { format: { type: "json_object" } },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ...fallback, fallbackReason: "provider_error", model };
    const text = responseText(await response.json());
    if (!text) return { ...fallback, fallbackReason: "invalid_response", model };
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { ...fallback, fallbackReason: "invalid_response", model }; }
    const validated = validatedModelAnswer(parsed, context);
    if (!validated) return { ...fallback, fallbackReason: "invalid_response", model };
    return { ...validated, mode: "model", model };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "provider_error";
    return { ...fallback, fallbackReason: reason, model };
  } finally {
    clearTimeout(timer);
  }
}
