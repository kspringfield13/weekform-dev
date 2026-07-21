import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safeNextPath";
import { resolveTrustedWebOrigin } from "@/lib/teamInviteOrigin";

/**
 * Auth callback for Supabase links.
 *
 * Handles both:
 * - PKCE / OAuth style callbacks (`?code=...`) via exchangeCodeForSession
 * - Email confirmation links (`?token_hash=...&type=...`) via verifyOtp
 *
 * On failure, forwards a generic recovery-safe reason to /auth/error.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = resolveTrustedWebOrigin(request.headers, {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
  });
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const next = safeNextPath(searchParams.get("next"));

  const supabase = await createClient();

  if (!supabase) {
    return NextResponse.redirect(
      `${origin}/auth/error?reason=${encodeURIComponent(
        "Supabase is not configured for this deployment.",
      )}`,
    );
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/auth/error?reason=${encodeURIComponent("That sign-in link could not be verified. Request a new link and try again.")}`,
    );
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/auth/error?reason=${encodeURIComponent("That sign-in link could not be verified. Request a new link and try again.")}`,
    );
  }

  return NextResponse.redirect(
    `${origin}/auth/error?reason=${encodeURIComponent(
      "The sign-in link was missing its verification code. It may have been truncated by your email client.",
    )}`,
  );
}
