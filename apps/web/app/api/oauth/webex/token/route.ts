import "server-only";

import { NextResponse } from "next/server";
import {
  buildWebexTokenExchange,
  projectWebexTokenResponse,
  resolveWebexBrokerReadiness,
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
  });
}

function response(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
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
  const { config } = readiness;

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
      return response({ error: "Webex rejected the OAuth exchange." }, 502);
    }
    const projected = projectWebexTokenResponse(await upstream.json());
    return NextResponse.json(projected, { headers: NO_STORE_HEADERS });
  } catch {
    return response({ error: "The Webex OAuth exchange could not be completed." }, 502);
  }
}
