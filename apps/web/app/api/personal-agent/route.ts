import { NextResponse } from "next/server";

import {
  buildPersonalAgentContext,
  generatePersonalAgentAnswer,
  isPersonalAgentActionIntent,
  parsePersonalAgentRequest,
} from "@/lib/personalAgent";
import { readBoundedRequestText } from "@/lib/boundedRequestText";
import { listOwnPersonalReplicas } from "@/lib/personalReplica";
import {
  AI_RESERVED_TOKEN_UNITS,
  acquireAiRequestControl,
  completeAiRequestControl,
  deriveRequestIdempotencyKey,
  keyRequestIpSubject,
  requestControlFailure,
  resolveServerRequestControlEnvironment,
  type RequestControlOutcomeCode,
  type RequestControlRpcClient,
} from "@/lib/distributedRequestControl";
import { createClient } from "@/lib/supabase/server";

const MAX_REQUEST_BYTES = 2_048;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

function response(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

function controlledFailure(
  decision: Exclude<Awaited<ReturnType<typeof acquireAiRequestControl>>, { decision: "acquired" }>,
): NextResponse {
  const failure = requestControlFailure(decision);
  const headers: Record<string, string> = {};
  if (failure.retryAfterSeconds > 0) headers["Retry-After"] = String(failure.retryAfterSeconds);
  return response({ error: failure.message }, failure.status, headers);
}

function outcomeForPersonalAgent(
  result: Awaited<ReturnType<typeof generatePersonalAgentAnswer>>,
): RequestControlOutcomeCode {
  if (result.mode === "model") return "ok";
  if (result.fallbackReason === "timeout") return "provider_timeout";
  if (result.fallbackReason === "invalid_response") return "validation_error";
  return "provider_error";
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return response({ error: "Send the question as JSON." }, 415);
  }
  const bounded = await readBoundedRequestText(request, MAX_REQUEST_BYTES);
  if (bounded.status === "too_large") {
    return response({ error: "That question is too large." }, 413);
  }
  if (bounded.status === "invalid") {
    return response({ error: "The question could not be read." }, 400);
  }
  const supabase = await createClient();
  if (!supabase) return response({ error: "Weekform Cloud is not configured." }, 503);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return response({ error: "Your session expired. Sign in again." }, 401);

  let body: unknown;
  try { body = JSON.parse(bounded.text); } catch {
    return response({ error: "The question could not be read." }, 400);
  }
  const agentRequest = parsePersonalAgentRequest(body);
  if (!agentRequest) return response({ error: "Enter a valid question and request ID." }, 400);
  const { question, requestId } = agentRequest;

  // Reload under the authenticated user's RLS session. Browser-supplied workload
  // context is never accepted, even though the current replica is rendered there.
  const { replicas, error } = await listOwnPersonalReplicas(supabase);
  if (error) return response({ error: "Your review-safe workload summary could not be loaded." }, 503);
  const replicaView = replicas[0];
  const replica = replicaView?.payload;
  if (!replica || !replicaView) return response({ error: "No review-safe week is connected yet. Publish one from Weekform for Mac." }, 409);

  const context = buildPersonalAgentContext(replica);
  const providerConfigured = Boolean(
    process.env.OPENAI_API_KEY?.trim()
    && process.env.OPENAI_PERSONAL_AGENT_MODEL?.trim(),
  );
  if (!providerConfigured || isPersonalAgentActionIntent(question)) {
    const result = await generatePersonalAgentAnswer(context, question);
    return response(result);
  }

  const controls = resolveServerRequestControlEnvironment();
  const ipSubjectHash = controls ? keyRequestIpSubject(request.headers, controls) : null;
  if (!controls || !ipSubjectHash) {
    return response(
      { error: "Distributed request controls are unavailable, so no provider request was sent." },
      503,
    );
  }
  const controlClient = supabase as unknown as RequestControlRpcClient;
  const acquired = await acquireAiRequestControl(controlClient, "personal_agent", {
    ipSubjectHash,
    idempotencyKey: deriveRequestIdempotencyKey([
      "personal_agent",
      new Date().toISOString().slice(0, 10),
      user.id,
      requestId,
    ]),
    reservedTokenUnits: AI_RESERVED_TOKEN_UNITS.personal_agent,
    serverClaim: controls.serverClaim,
  });
  if (acquired.decision !== "acquired") return controlledFailure(acquired);

  const result = await generatePersonalAgentAnswer(context, question);
  const completed = await completeAiRequestControl(controlClient, {
    receiptId: acquired.receiptId,
    leaseToken: acquired.leaseToken,
    serverClaim: controls.serverClaim,
  }, outcomeForPersonalAgent(result));
  if (!completed) {
    return response(
      { error: "The provider response could not be safely finalized. Try again shortly." },
      503,
    );
  }
  return response(result);
}
