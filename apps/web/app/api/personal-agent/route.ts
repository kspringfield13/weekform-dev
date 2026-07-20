import { NextResponse } from "next/server";

import {
  buildPersonalAgentContext,
  generatePersonalAgentAnswer,
  isPersonalAgentActionIntent,
  parsePersonalAgentRequest,
} from "@/lib/personalAgent";
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

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function controlledFailure(
  decision: Exclude<Awaited<ReturnType<typeof acquireAiRequestControl>>, { decision: "acquired" }>,
): NextResponse {
  const failure = requestControlFailure(decision);
  const headers: Record<string, string> = { ...NO_STORE_HEADERS };
  if (failure.retryAfterSeconds > 0) headers["Retry-After"] = String(failure.retryAfterSeconds);
  return NextResponse.json({ error: failure.message }, { status: failure.status, headers });
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
    return NextResponse.json({ error: "Send the question as JSON." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 2_048) {
    return NextResponse.json({ error: "That question is too large." }, { status: 413 });
  }
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Weekform Cloud is not configured." }, { status: 503 });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "The question could not be read." }, { status: 400 });
  }
  const agentRequest = parsePersonalAgentRequest(body);
  if (!agentRequest) return NextResponse.json({ error: "Enter a valid question and request ID." }, { status: 400 });
  const { question, requestId } = agentRequest;

  // Reload under the authenticated user's RLS session. Browser-supplied workload
  // context is never accepted, even though the current replica is rendered there.
  const { replicas, error } = await listOwnPersonalReplicas(supabase);
  if (error) return NextResponse.json({ error: "Your review-safe workload summary could not be loaded." }, { status: 503 });
  const replicaView = replicas[0];
  const replica = replicaView?.payload;
  if (!replica || !replicaView) return NextResponse.json({ error: "No review-safe week is connected yet. Publish one from Weekform for Mac." }, { status: 409 });

  const context = buildPersonalAgentContext(replica);
  const providerConfigured = Boolean(
    process.env.OPENAI_API_KEY?.trim()
    && process.env.OPENAI_PERSONAL_AGENT_MODEL?.trim(),
  );
  if (!providerConfigured || isPersonalAgentActionIntent(question)) {
    const result = await generatePersonalAgentAnswer(context, question);
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  }

  const controls = resolveServerRequestControlEnvironment();
  const ipSubjectHash = controls ? keyRequestIpSubject(request.headers, controls) : null;
  if (!controls || !ipSubjectHash) {
    return NextResponse.json(
      { error: "Distributed request controls are unavailable, so no provider request was sent." },
      { status: 503, headers: NO_STORE_HEADERS },
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
    return NextResponse.json(
      { error: "The provider response could not be safely finalized. Try again shortly." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(result, { headers: NO_STORE_HEADERS });
}
