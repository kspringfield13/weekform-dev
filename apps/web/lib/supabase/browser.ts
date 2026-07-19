"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "./config";

/** Ephemeral browser client used only for private Realtime invalidations. */
export function createRealtimeClient() {
  const env = getSupabaseEnv();
  if (!env) return null;
  return createBrowserClient(env.url, env.anonKey);
}
