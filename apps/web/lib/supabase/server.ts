import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseEnv } from "./config";

/**
 * Server-side Supabase client bound to the request's cookies.
 *
 * Uses only the publishable URL + anon key; the authenticated user's session
 * cookie determines row access via RLS. Returns null when Supabase is not
 * configured so pages and actions can degrade honestly.
 */
export async function createClient() {
  const env = getSupabaseEnv();
  if (!env) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component where cookies are read-only.
          // Safe to ignore when middleware refreshes sessions.
        }
      },
    },
  });
}
