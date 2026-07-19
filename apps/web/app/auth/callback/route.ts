import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safeNextPath";

/**
 * Auth callback for Supabase links.
 *
 * Handles both:
 * - PKCE / OAuth style callbacks (`?code=...`) via exchangeCodeForSession
 * - Email confirmation links (`?token_hash=...&type=...`) via verifyOtp
 *
 * On failure, forwards a human-readable reason to /auth/error.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
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
      `${origin}/auth/error?reason=${encodeURIComponent(error.message)}`,
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
      `${origin}/auth/error?reason=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(
    `${origin}/auth/error?reason=${encodeURIComponent(
      "The sign-in link was missing its verification code. It may have been truncated by your email client.",
    )}`,
  );
}
