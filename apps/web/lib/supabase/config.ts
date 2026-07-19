/**
 * Supabase environment configuration.
 *
 * Only the publishable URL and anon key are ever read here. The web app has
 * no secret/service key anywhere; row access is governed by Supabase RLS.
 *
 * The app must build (and render honest "not configured" states) without a
 * Supabase project, so callers should check `isSupabaseConfigured()` before
 * creating a client and treat an unconfigured deployment as a first-class
 * state, not an error.
 */

export function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return null;
  }
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}
