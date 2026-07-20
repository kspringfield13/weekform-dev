import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";

const MAX_QUESTION_LENGTH = 600;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PersonalAgentRequest {
  question: string;
  requestId: string;
}

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

/** A submit nonce distinguishes an intentional retry from transport replay. */
export function parsePersonalAgentRequest(value: unknown): PersonalAgentRequest | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("question") || !keys.includes("requestId")) return null;
  if (typeof value.question !== "string" || typeof value.requestId !== "string") return null;
  const question = value.question.trim();
  const requestId = value.requestId.toLowerCase();
  if (!question || question.length > MAX_QUESTION_LENGTH || !REQUEST_ID_PATTERN.test(requestId)) {
    return null;
  }
  return { question, requestId };
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

const ACTION_VERB = String.raw`(?:delete|remove|clear|wipe|erase|purge|reset|undo|add|create|mark|move|reschedule|schedule|cancel|enable|disable|toggle|switch|test|turn\s+off|stop\s+tracking|include|exclude|relabel|rename|confirm|approve|classify|capture|connect|disconnect|pause|resume|dismiss|share|export|import|publish|send|set|assign|archive|restore|save|make|generate\s+(?:a\s+)?(?:forecast|summary|narrative)|change|update|edit)`;
const ACTION_VERB_END = String.raw`${ACTION_VERB}(?=\s|[.!?,;:]|$)`;
const DIRECT_ACTION_INTENT = new RegExp(
  String.raw`^\s*(?:(?:please|go\s+ahead\s+and)\s+)?${ACTION_VERB_END}`,
  "i",
);
const REQUESTED_ACTION_INTENT = new RegExp(
  String.raw`\b(?:` +
    String.raw`(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:help\s+me\s+(?:to\s+)?|go\s+ahead\s+and\s+|try\s+to\s+)?|` +
    String.raw`please\s+|go\s+ahead\s+and\s+|` +
    String.raw`i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to\s+` +
  String.raw`)${ACTION_VERB_END}`,
  "i",
);
const HELP_ACTION_INTENT = new RegExp(
  String.raw`\bhelp\s+me\s+(?:to\s+)?${ACTION_VERB_END}`,
  "i",
);
const MIND_ACTION_INTENT = /\bwould\s+you\s+mind\s+(?:deleting|removing|clearing|wiping|erasing|purging|resetting|undoing|adding|creating|marking|moving|rescheduling|scheduling|canceling|cancelling|enabling|disabling|turning\s+off|stopping\s+tracking|including|excluding|relabeling|renaming|confirming|approving|classifying|capturing|connecting|disconnecting|pausing|resuming|dismissing|sharing|exporting|importing|publishing|sending|setting|assigning|archiving|restoring|saving|making|generating\s+(?:a\s+)?(?:forecast|summary|narrative)|changing|updating|editing)\b/i;
const ADVISORY_INTENTS = [
  /\bshare\s+(?:with\s+me\s+)?your\s+(?:assessment|analysis|opinion|view|thoughts?|recommendations?)\b/i,
  /\bshare\b[^.!?]{0,120}\bwith\s+me\b/i,
  /\bsend\s+me\s+(?:your|the)\s+(?:assessment|analysis|opinion|view|thoughts?|recommendations?|evidence|explanation|breakdown)\b/i,
  /\bset\s+out\s+(?:the\s+)?(?:assessment|analysis|evidence|reasons?|case|options?)\b/i,
  /\bmake\s+sense\s+of\b/i,
  /\bmake\s+(?:me\s+)?a?\s*recommendation\b/i,
  /\bcreate\s+(?:me\s+)?a?\s*(?:breakdown|analysis|assessment|explanation)\b/i,
  /\binclude\s+(?:the\s+)?evidence\s+in\s+(?:the|your)\s+answer\b/i,
  /\bsave\s+me\s+time\s+by\s+(?:explaining|summarizing|finding|analyzing)\b/i,
  /\b(?:explain|summarize|analyze|assess|recommend|find)\b[^.!?]{0,100}\b(?:whether|what|why|how|risk|capacity|load|evidence|breakdown)\b/i,
  /\b(?:what|how)\s+(?:should|could|would)\b/i,
  /\bhelp\s+me\s+(?:decide|understand|plan|assess)\b/i,
];
const MUTATION_TARGET = /\b(?:local\s+data|data|review\s+blocks?|blocks?|meetings?|plans?|work\s+blocks?|capture|tracking|activity|visual\s+context|observed\s+ai\s+estimates?|estimates?|ai\s+usage|manager\s+summar(?:y|ies)|api\s+keys?|skills?|provider(?:\s+connection)?|forecasts?|summar(?:y|ies)|narratives?|calendar|settings?|connections?)\b/i;
const MUTATION_OPERATION = /\b(?:delete|remove|clear|wipe|erase|purge|reset|undo|add|create|mark(?:ed)?|move|reschedule|schedule|cancel|enable|disable|toggle|switch|test|turn(?:ed)?\s+(?:on|off)|stop\s+tracking|shut\s+down|include|exclude|omit|leave\s+[^.!?]{0,40}\s+out|relabel|rename|replace|rotate|swap|use|confirm|approve|classify|capture|connect|disconnect|pause|resume|dismiss|share|export|import|publish|send|sent|set|assign|archive|restore|save|make|generate|change|update|edit|unlink(?:ed|ing)?|detach(?:ed|ing)?|unpair(?:ed|ing)?|trash(?:ed|ing)?|discard(?:ed|ing)?|drop|dropp(?:ed|ing)|revoke(?:d|ing)?|forget|forgot(?:ten)?|(?:delet|remov|clear|wip|eras|purg|add|creat|mark|mov|reschedul|schedul|cancel|enabl|disabl|toggl|switch|test|includ|exclud|omitt|relabel|renam|replac|rotat|swapp|confirm|approv|classif|captur|connect|disconnect|paus|resum|dismiss|shar|export|import|publish|assign|archiv|restor|sav|generat|chang|updat|edit)(?:ed|ing)|get\s+rid\s+of|take\s+[^.!?]{0,40}\s+off)\b/i;
const SENSITIVE_CREDENTIAL_INPUT = /\b(?:sk-[a-z0-9_-]{8,}|api\s+key\s*(?:is|:|=)\s*\S+)/i;
const SIMPLE_READ_ONLY_TARGET_QUESTION = /^\s*(?:(?:what|why|how|when|where|which)\s+(?:is|are|was|were|do|does|did|can|could|would|should|will|may|might)\b[^,;.!?]*\?|(?:(?:can|could|would)\s+you\s+|would\s+you\s+mind\s+)?(?:explain|summarize|analyze|assess|recommend|help\s+me\s+understand|tell\s+me\s+about)\b[^,;.!?]*[?.]?)\s*$/i;
const SIMPLE_READ_ONLY_PLANNING_REQUEST = /^\s*help\s+me\s+plan\b[^,;.!?]*[?.]?\s*$/i;
const MULTI_CLAUSE_CONNECTOR = /\b(?:and|but|then|before|after|afterwards|while|however|regardless|also|as\s+well\s+as)\b/i;
const PURE_MUTATION_ADVICE = [
  new RegExp(String.raw`^\s*(?:what|which|how)\s+(?:should|could|would)\s+(?:(?:i|we)\s+)?${ACTION_VERB_END}[^.!?]*[?.]?\s*$`, "i"),
  new RegExp(String.raw`^\s*(?:(?:can|could)\s+you\s+|would\s+you\s+mind\s+)?(?:explain|summarize|analyze|assess|recommend)\b[^.!?]*\b(?:what|whether)\s+(?:i|we)\s+should\s+${ACTION_VERB_END}[^.!?]*[?.]?\s*$`, "i"),
  new RegExp(String.raw`^\s*help\s+me\s+decide\s+what\s+to\s+${ACTION_VERB_END}[^.!?]*[?.]?\s*$`, "i"),
  /^\s*set\s+out\s+(?:the\s+)?(?:assessment|analysis|evidence|reasons?|case|options?)[^.!?]*[?.]?\s*$/i,
];

export function isPersonalAgentActionIntent(question: string): boolean {
  if (SENSITIVE_CREDENTIAL_INPUT.test(question)) return true;
  if (MUTATION_TARGET.test(question)) {
    const operationCount = question.match(new RegExp(MUTATION_OPERATION.source, "gi"))?.length ?? 0;
    if (operationCount === 1 && PURE_MUTATION_ADVICE.some((pattern) => pattern.test(question))) return false;
    if (operationCount === 0 && SIMPLE_READ_ONLY_PLANNING_REQUEST.test(question)) return false;
    if (SIMPLE_READ_ONLY_TARGET_QUESTION.test(question) && !MULTI_CLAUSE_CONNECTOR.test(question)) return false;
    if (operationCount > 0) return true;
    return true;
  }
  if (ADVISORY_INTENTS.some((pattern) => pattern.test(question))) return false;
  return DIRECT_ACTION_INTENT.test(question)
    || REQUESTED_ACTION_INTENT.test(question)
    || HELP_ACTION_INTENT.test(question)
    || MIND_ACTION_INTENT.test(question);
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
  if (!isRecord(value) || !Array.isArray(value.evidenceRefs)) return null;
  const refs = value.evidenceRefs.filter(
    (ref): ref is string => typeof ref === "string" && Object.hasOwn(context.evidenceCatalog, ref),
  );
  if (refs.length === 0) return null;
  const evidence = catalogEntries(context.evidenceCatalog, [...new Set(refs)].slice(0, 6));
  return {
    answer: `The review-safe evidence selected for your question shows: ${evidence.join(" ")} Use this as planning context; no local action was run.`,
    evidence,
    limitations: ["This server-composed answer uses only the latest review-safe Web replica; no provider-authored prose or local evidence is shown."],
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
        max_output_tokens: 1_200,
        instructions: "You are Weekform Agent. Select only the supplied review-safe evidence that best answers the question. Never claim access to raw activity, titles, notes, screenshots, local files, or omitted evidence. Do not execute or imply actions. Return JSON with evidenceRefs (catalog keys only). Weekform composes all visible prose from validated fields; do not return answer or limitation prose.",
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
    if (!validated) return {
      ...fallback,
      answer: `${fallback.answer} No local action was run.`,
      fallbackReason: "invalid_response",
      model,
    };
    return { ...validated, mode: "model", model };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "provider_error";
    return { ...fallback, fallbackReason: reason, model };
  } finally {
    clearTimeout(timer);
  }
}
