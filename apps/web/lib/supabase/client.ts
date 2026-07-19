"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "./config";

/**
 * Browser-side Supabase client (publishable anon key only).
 *
 * Returns null when the deployment has no Supabase environment configured so
 * client components can render an honest "not configured" state instead of
 * throwing at render time.
 */
export function createClient() {
  const env = getSupabaseEnv();
  if (!env) {
    return null;
  }
  return createBrowserClient(env.url, env.anonKey);
}
