import "server-only";

import { NextResponse } from "next/server";
import {
  acquireWebexRequestControl,
  completeWebexRequestControl,
  createAnonymousRequestControlClient,
  requestControlFailure,
  type RequestControlOutcomeCode,
} from "../../../../../lib/distributedRequestControl";
import {
  buildWebexTokenExchange,
  keyWebexIpSubject,
  projectWebexTokenResponse,
  resolveWebexBrokerReadiness,
  webexExchangeIdempotencyKey,
  type WebexTokenProjection,
} from "../../../../../lib/webexTokenBroker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 16_384;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

function brokerReadiness() {
  return resolveWebexBrokerReadiness({
    clientId: process.env.WEBEX_CHAT_CLIENT_ID,
    clientSecret: process.env.WEBEX_CHAT_CLIENT_SECRET,
    redirectUri: process.env.WEBEX_CHAT_REDIRECT_URI,
    securityVerified: process.env.WEBEX_CHAT_BROKER_SECURITY_VERIFIED,
    controlClaim: process.env.REQUEST_CONTROL_SERVER_CLAIM,
    ipHashSecret: process.env.REQUEST_CONTROL_IP_HASH_SECRET,
    trustedIpHeader: process.env.REQUEST_CONTROL_TRUSTED_IP_HEADER,
    trustedProxy: process.env.REQUEST_CONTROL_TRUSTED_PROXY,
    vercelDeployment: process.env.VERCEL,
  });
}

function response(
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

/**
 * Minimal Webex confidential-client boundary. It handles OAuth credentials
 * only; chat messages never transit Weekform Web. PKCE still binds an
 * authorization code to the verifier held by the Mac.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return response({ error: "Send the Webex exchange as JSON." }, 415);
  }
  const announcedLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(announcedLength) && announcedLength > MAX_REQUEST_BYTES) {
    return response({ error: "The Webex exchange request is too large." }, 413);
  }
  const readiness = brokerReadiness();
  if (!readiness.ready) {
    return response({
      error: readiness.reason === "security_unverified"
        ? "The Webex OAuth broker security controls are not verified."
        : "The Webex OAuth broker is not configured.",
    }, 503);
  }
  const { config, control } = readiness;

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    return response({ error: "The Webex exchange request is too large." }, 413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return response({ error: "The Webex exchange request is invalid." }, 400);
  }

  let exchange;
  try {
    exchange = buildWebexTokenExchange(payload, config);
  } catch {
    return response({ error: "The Webex exchange request did not pass validation." }, 400);
  }

  const controlClient = createAnonymousRequestControlClient();
  const subjectHash = keyWebexIpSubject(
    request.headers,
    control.trustedIpHeader,
    control.ipHashSecret,
  );
  if (!controlClient || !subjectHash) {
    return response({
      error: "Distributed request controls are unavailable, so no Webex request was sent.",
    }, 503);
  }
  const acquired = await acquireWebexRequestControl(controlClient, {
    subjectHash,
    idempotencyKey: webexExchangeIdempotencyKey(exchange, control.ipHashSecret),
    serverClaim: control.serverClaim,
  });
  if (acquired.decision !== "acquired") {
    const failure = requestControlFailure(acquired);
    return response(
      { error: failure.message },
      failure.status,
      failure.retryAfterSeconds > 0
        ? { "Retry-After": String(failure.retryAfterSeconds) }
        : {},
    );
  }

  let projected: WebexTokenProjection | null = null;
  let outcome: RequestControlOutcomeCode = "provider_error";
  let publicError = "The Webex OAuth exchange could not be completed.";
  try {
    const upstream = await fetch(exchange.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: exchange.form,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) {
      // Never relay provider bodies: they may contain request/account detail.
      publicError = "Webex rejected the OAuth exchange.";
    } else {
      try {
        projected = projectWebexTokenResponse(await upstream.json());
        outcome = "ok";
      } catch {
        outcome = "validation_error";
        publicError = "Webex returned an invalid OAuth response.";
      }
    }
  } catch (error) {
    outcome = error instanceof Error
      && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "provider_timeout"
      : "provider_error";
  }

  const completed = await completeWebexRequestControl(controlClient, {
    receiptId: acquired.receiptId,
    leaseToken: acquired.leaseToken,
    subjectHash,
    serverClaim: control.serverClaim,
  }, outcome);
  if (!completed) {
    return response({
      error: "The Webex response could not be safely finalized. Try again shortly.",
    }, 503);
  }
  return projected
    ? NextResponse.json(projected, { headers: NO_STORE_HEADERS })
    : response({ error: publicError }, 502);
}
