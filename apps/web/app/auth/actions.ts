"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safeNextPath";
import {
  buildEmailCallbackUrl,
  isMissingMagicLinkAccountError,
  normalizeMagicLinkEmail,
} from "@/lib/emailAuth";
import {
  buildOAuthCallbackUrl,
  parseOAuthProvider,
} from "@/lib/oauthAuth";
import {
  normalizePasswordResetEmail,
  validateReplacementPassword,
} from "@/lib/passwordRecovery";
import { resolveTrustedWebOrigin } from "@/lib/teamInviteOrigin";

const NOT_CONFIGURED =
  "This deployment has no Supabase project configured yet, so accounts are unavailable. See apps/web/README.md.";

function encodeMessage(message: string): string {
  return encodeURIComponent(message);
}

async function trustedRequestOrigin(): Promise<string> {
  return resolveTrustedWebOrigin(await headers(), {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
  });
}

export async function login(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const next = safeNextPath(formData.get("next"));

  if (!supabase) {
    redirect(`/login?error=${encodeMessage(NOT_CONFIGURED)}`);
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect(`/login?error=${encodeMessage("Enter your email and password.")}`);
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(
      `/login?error=${encodeMessage("The email or password was not accepted.")}&next=${encodeURIComponent(next)}`,
    );
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function loginWithMagicLink(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const next = safeNextPath(formData.get("next"));

  if (!supabase) {
    redirect(
      `/login?error=${encodeMessage(NOT_CONFIGURED)}&next=${encodeURIComponent(next)}`,
    );
  }

  const email = normalizeMagicLinkEmail(formData.get("email"));
  if (!email) {
    redirect(
      `/login?error=${encodeMessage("Enter your email to receive a sign-in link.")}&next=${encodeURIComponent(next)}`,
    );
  }

  let redirectTo: string;
  try {
    redirectTo = buildEmailCallbackUrl(await trustedRequestOrigin(), next);
  } catch {
    redirect(
      `/login?error=${encodeMessage("We could not start secure sign-in. Please try again.")}&next=${encodeURIComponent(next)}`,
    );
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: false,
    },
  });

  if (error) {
    if (isMissingMagicLinkAccountError(error)) {
      redirect(
        `/login?reason=account-not-found&next=${encodeURIComponent(next)}`,
      );
    }
    redirect(
      `/login?error=${encodeMessage("The sign-in email could not be sent. Try again shortly.")}&next=${encodeURIComponent(next)}`,
    );
  }

  redirect(
    `/login?notice=${encodeMessage("Check your email for a secure sign-in link.")}&next=${encodeURIComponent(next)}`,
  );
}

export async function loginWithOAuth(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const next = safeNextPath(formData.get("next"));

  if (!supabase) {
    redirect(
      `/login?error=${encodeMessage(NOT_CONFIGURED)}&next=${encodeURIComponent(next)}`,
    );
  }

  const provider = parseOAuthProvider(formData.get("provider"));
  if (!provider) {
    redirect(
      `/login?error=${encodeMessage("Choose Google or GitHub to continue.")}&next=${encodeURIComponent(next)}`,
    );
  }

  let redirectTo: string;
  try {
    redirectTo = buildOAuthCallbackUrl(await trustedRequestOrigin(), next);
  } catch {
    redirect(
      `/login?error=${encodeMessage("We could not start secure sign-in. Please try again.")}&next=${encodeURIComponent(next)}`,
    );
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });

  if (error || !data.url) {
    redirect(
      `/login?error=${encodeMessage("The sign-in provider could not be opened. Try again shortly.")}&next=${encodeURIComponent(next)}`,
    );
  }

  redirect(data.url);
}

export async function signup(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const next = safeNextPath(formData.get("next"));

  if (!supabase) {
    redirect(`/signup?error=${encodeMessage(NOT_CONFIGURED)}`);
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!email || !password) {
    redirect(`/signup?error=${encodeMessage("Enter an email and a password.")}`);
  }
  if (password.length < 8) {
    redirect(
      `/signup?error=${encodeMessage("Use a password of at least 8 characters.")}`,
    );
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: displayName ? { display_name: displayName } : undefined,
    },
  });

  if (error) {
    redirect(
      `/signup?error=${encodeMessage("The account could not be created. Try signing in or use another email.")}&next=${encodeURIComponent(next)}`,
    );
  }

  // If email confirmation is enabled the user has no session yet.
  if (!data.session) {
    redirect(
      `/login?notice=${encodeMessage(
        "Check your email to confirm your account, then sign in.",
      )}&next=${encodeURIComponent(next)}`,
    );
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function requestPasswordReset(formData: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) {
    redirect(`/forgot-password?error=${encodeMessage(NOT_CONFIGURED)}`);
  }
  const email = normalizePasswordResetEmail(formData.get("email"));
  if (!email) {
    redirect(`/forgot-password?error=${encodeMessage("Enter your account email.")}`);
  }

  const callback = new URL("/auth/callback", await trustedRequestOrigin());
  callback.searchParams.set("next", "/reset-password");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: callback.toString(),
  });
  if (error) {
    redirect(`/forgot-password?error=${encodeMessage("A reset email could not be sent. Try again shortly.")}`);
  }

  // Deliberately identical whether or not an account exists.
  redirect(`/forgot-password?notice=${encodeMessage("If that email belongs to an account, a password-reset link is on its way.")}`);
}

export async function updatePassword(formData: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) {
    redirect(`/reset-password?error=${encodeMessage(NOT_CONFIGURED)}`);
  }
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    redirect(`/forgot-password?error=${encodeMessage("That reset session expired. Request a new link.")}`);
  }
  const validation = validateReplacementPassword(
    formData.get("password"),
    formData.get("password_confirmation"),
  );
  if (!validation.ok) {
    redirect(`/reset-password?error=${encodeMessage(validation.message)}`);
  }

  const { error } = await supabase.auth.updateUser({ password: validation.password });
  if (error) {
    redirect(`/reset-password?error=${encodeMessage("Your password could not be updated. Request a new link and try again.")}`);
  }
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect(`/login?notice=${encodeMessage("Password updated. Sign in with your new password.")}`);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  revalidatePath("/", "layout");
  redirect("/");
}
