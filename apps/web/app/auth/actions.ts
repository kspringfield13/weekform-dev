"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safeNextPath";

const NOT_CONFIGURED =
  "This deployment has no Supabase project configured yet, so accounts are unavailable. See apps/web/README.md.";

function encodeMessage(message: string): string {
  return encodeURIComponent(message);
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
      `/login?error=${encodeMessage(error.message)}&next=${encodeURIComponent(next)}`,
    );
  }

  revalidatePath("/", "layout");
  redirect(next);
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
      `/signup?error=${encodeMessage(error.message)}&next=${encodeURIComponent(next)}`,
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

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  revalidatePath("/", "layout");
  redirect("/");
}
