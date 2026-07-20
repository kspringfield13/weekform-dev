import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "./supabase/config";

export type AiRequestControlScope = "personal_agent" | "team_briefing";
export const AI_RESERVED_TOKEN_UNITS: Record<AiRequestControlScope, number> = {
  personal_agent: 4_096,
  team_briefing: 8_192,
};
export type RequestControlOutcomeCode =
  | "ok"
  | "provider_timeout"
  | "provider_error"
  | "validation_error"
  | "internal_error";

type RejectedDecision =
  | "in_progress"
  | "busy"
  | "budget_exhausted"
  | "replay_succeeded"
  | "replay_failed"
  | "replay_expired"
  | "unavailable";

export type RequestControlDecision =
  | {
    decision: "acquired";
    receiptId: string;
    leaseToken: string;
    retryAfterSeconds: number;
    dailyRemaining: number;
    tokenBudgetRemaining: number;
  }
  | {
    decision: RejectedDecision;
    retryAfterSeconds: number;
    dailyRemaining: number;
    tokenBudgetRemaining: number;
  };

export interface RequestControlLease {
  receiptId: string;
  leaseToken: string;
}

export interface RequestControlRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

interface ControlRow {
  decision?: unknown;
  receipt_id?: unknown;
  lease_token?: unknown;
  retry_after_seconds?: unknown;
  daily_remaining?: unknown;
  token_budget_remaining?: unknown;
}

export interface ServerRequestControlEnvironment {
  serverClaim: string;
  ipHashSecret: string;
  trustedIpHeader: "x-forwarded-for";
  trustedProxy: "vercel";
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REJECTED_DECISIONS = new Set<RejectedDecision>([
  "in_progress",
  "busy",
  "budget_exhausted",
  "replay_succeeded",
  "replay_failed",
  "replay_expired",
]);

function unavailable(): RequestControlDecision {
  return {
    decision: "unavailable",
    retryAfterSeconds: 0,
    dailyRemaining: 0,
    tokenBudgetRemaining: 0,
  };
}

function boundedInteger(value: unknown, maximum: number): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maximum
    ? Number(value)
    : null;
}

function parseControlDecision(data: unknown): RequestControlDecision {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable();
  const row = value as ControlRow;
  const retryAfterSeconds = boundedInteger(row.retry_after_seconds, 86_400);
  const dailyRemaining = boundedInteger(row.daily_remaining, 100_000);
  const tokenBudgetRemaining = boundedInteger(row.token_budget_remaining, 10_000_000);
  if (
    retryAfterSeconds === null
    || dailyRemaining === null
    || tokenBudgetRemaining === null
  ) return unavailable();

  if (row.decision === "acquired") {
    if (
      typeof row.receipt_id !== "string"
      || !UUID_PATTERN.test(row.receipt_id)
      || typeof row.lease_token !== "string"
      || !UUID_PATTERN.test(row.lease_token)
    ) return unavailable();
    return {
      decision: "acquired",
      receiptId: row.receipt_id,
      leaseToken: row.lease_token,
      retryAfterSeconds,
      dailyRemaining,
      tokenBudgetRemaining,
    };
  }
  if (typeof row.decision === "string" && REJECTED_DECISIONS.has(row.decision as RejectedDecision)) {
    return {
      decision: row.decision as RejectedDecision,
      retryAfterSeconds,
      dailyRemaining,
      tokenBudgetRemaining,
    };
  }
  return unavailable();
}

async function acquire(
  client: RequestControlRpcClient,
  rpcName: string,
  args: Record<string, unknown>,
): Promise<RequestControlDecision> {
  try {
    const { data, error } = await client.rpc(rpcName, args);
    if (error) return unavailable();
    return parseControlDecision(data);
  } catch {
    return unavailable();
  }
}

async function complete(
  client: RequestControlRpcClient,
  rpcName: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc(rpcName, args);
    return !error && data === true;
  } catch {
    return false;
  }
}

function appendDigestPart(
  hash: ReturnType<typeof createHash> | ReturnType<typeof createHmac>,
  part: string,
): void {
  const byteLength = Buffer.byteLength(part, "utf8");
  hash.update(String(byteLength));
  hash.update(":");
  hash.update(part, "utf8");
  hash.update(";");
}

export function deriveRequestIdempotencyKey(parts: readonly string[]): string {
  if (parts.length === 0) throw new Error("At least one idempotency component is required.");
  const hash = createHash("sha256");
  for (const part of parts) appendDigestPart(hash, part);
  return hash.digest("hex");
}

export function deriveSecretKeyedRequestHash(
  secret: string,
  parts: readonly string[],
): string {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("The request-control hashing secret is too short.");
  }
  if (parts.length === 0) throw new Error("At least one keyed component is required.");
  const hash = createHmac("sha256", secret);
  for (const part of parts) appendDigestPart(hash, part);
  return hash.digest("hex");
}

export function resolveServerRequestControlEnvironment(
  env: Record<string, string | undefined> = process.env,
): ServerRequestControlEnvironment | null {
  const serverClaim = env.REQUEST_CONTROL_SERVER_CLAIM?.trim();
  const ipHashSecret = env.REQUEST_CONTROL_IP_HASH_SECRET?.trim();
  const trustedIpHeader = env.REQUEST_CONTROL_TRUSTED_IP_HEADER?.trim().toLowerCase();
  const trustedProxy = env.REQUEST_CONTROL_TRUSTED_PROXY?.trim().toLowerCase();
  if (
    !serverClaim
    || Buffer.byteLength(serverClaim, "utf8") < 32
    || !ipHashSecret
    || Buffer.byteLength(ipHashSecret, "utf8") < 32
    || trustedIpHeader !== "x-forwarded-for"
    || trustedProxy !== "vercel"
    || env.VERCEL !== "1"
  ) return null;
  return { serverClaim, ipHashSecret, trustedIpHeader, trustedProxy };
}

function canonicalIp(value: string): string | null {
  if (value.includes(",") || isIP(value) === 0) return null;
  if (isIP(value) === 4) return value;
  try {
    const hostname = new URL(`http://[${value}]`).hostname;
    return hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1).toLowerCase()
      : null;
  } catch {
    return null;
  }
}

export function keyRequestIpSubject(
  headers: Pick<Headers, "get">,
  environment: Pick<ServerRequestControlEnvironment, "ipHashSecret" | "trustedIpHeader">,
): string | null {
  const raw = headers.get(environment.trustedIpHeader)?.trim();
  if (!raw) return null;
  const ip = canonicalIp(raw);
  return ip
    ? deriveSecretKeyedRequestHash(environment.ipHashSecret, ["request_ip", ip])
    : null;
}

export function createAnonymousRequestControlClient(): RequestControlRpcClient | null {
  const env = getSupabaseEnv();
  if (!env) return null;
  return createSupabaseClient(env.url, env.anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  }) as unknown as RequestControlRpcClient;
}

export async function acquireAiRequestControl(
  client: RequestControlRpcClient,
  scope: AiRequestControlScope,
  input: {
    ipSubjectHash: string;
    idempotencyKey: string;
    reservedTokenUnits: number;
    serverClaim: string;
  },
): Promise<RequestControlDecision> {
  if (
    !DIGEST_PATTERN.test(input.ipSubjectHash)
    || !DIGEST_PATTERN.test(input.idempotencyKey)
    || input.reservedTokenUnits !== AI_RESERVED_TOKEN_UNITS[scope]
  ) return unavailable();
  return acquire(client, "acquire_ai_request_control", {
    p_scope: scope,
    p_ip_subject_hash: input.ipSubjectHash,
    p_idempotency_key: input.idempotencyKey,
    p_reserved_token_units: input.reservedTokenUnits,
    p_server_claim: input.serverClaim,
  });
}

export async function completeAiRequestControl(
  client: RequestControlRpcClient,
  lease: RequestControlLease & { serverClaim: string },
  outcomeCode: RequestControlOutcomeCode,
): Promise<boolean> {
  return complete(client, "complete_ai_request_control", {
    p_receipt_id: lease.receiptId,
    p_lease_token: lease.leaseToken,
    p_outcome_code: outcomeCode,
    p_server_claim: lease.serverClaim,
  });
}

export async function acquireWebexRequestControl(
  client: RequestControlRpcClient,
  input: {
    subjectHash: string;
    idempotencyKey: string;
    serverClaim: string;
  },
): Promise<RequestControlDecision> {
  if (!DIGEST_PATTERN.test(input.subjectHash) || !DIGEST_PATTERN.test(input.idempotencyKey)) {
    return unavailable();
  }
  return acquire(client, "acquire_webex_request_control", {
    p_subject_hash: input.subjectHash,
    p_idempotency_key: input.idempotencyKey,
    p_server_claim: input.serverClaim,
  });
}

export async function completeWebexRequestControl(
  client: RequestControlRpcClient,
  lease: RequestControlLease & { subjectHash: string; serverClaim: string },
  outcomeCode: RequestControlOutcomeCode,
): Promise<boolean> {
  return complete(client, "complete_webex_request_control", {
    p_receipt_id: lease.receiptId,
    p_lease_token: lease.leaseToken,
    p_subject_hash: lease.subjectHash,
    p_server_claim: lease.serverClaim,
    p_outcome_code: outcomeCode,
  });
}

export function requestControlFailure(
  decision: Exclude<RequestControlDecision, { decision: "acquired" }>,
): { status: 409 | 429 | 503; message: string; retryAfterSeconds: number } {
  if (decision.decision === "budget_exhausted") {
    return {
      status: 429,
      message: "This request budget is exhausted. Try again after the UTC budget resets.",
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  }
  if (decision.decision === "busy") {
    return {
      status: 429,
      message: "Another request is already running. Try again after it finishes.",
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  }
  if (decision.decision === "in_progress") {
    return {
      status: 409,
      message: "This request is already running.",
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  }
  if (decision.decision.startsWith("replay_")) {
    return {
      status: 409,
      message: "This request was already processed. Start a new request to run it again.",
      retryAfterSeconds: 0,
    };
  }
  return {
    status: 503,
    message: "Distributed request controls are unavailable, so no provider request was sent.",
    retryAfterSeconds: 0,
  };
}
