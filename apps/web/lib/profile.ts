import type { SupabaseClient, User } from "@supabase/supabase-js";

export interface Profile {
  id: string;
  display_name: string | null;
}

/**
 * Read the signed-in user's profile row, bootstrapping it if absent.
 *
 * The `profiles` table (id uuid primary key references auth.users,
 * display_name text) may not exist yet in a given environment — the team
 * schema is not merged. Every failure path degrades to `null` so callers
 * fall back to the auth email instead of erroring the page.
 */
export async function getOrCreateProfile(
  supabase: SupabaseClient,
  user: User,
): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      // Table missing, RLS not yet configured, or transient failure.
      return null;
    }
    if (data) {
      return data as Profile;
    }

    // No row yet: bootstrap one from sign-up metadata. Best effort only.
    const displayName =
      typeof user.user_metadata?.display_name === "string"
        ? user.user_metadata.display_name
        : null;

    const { data: created, error: insertError } = await supabase
      .from("profiles")
      .insert({ id: user.id, display_name: displayName })
      .select("id, display_name")
      .maybeSingle();

    if (insertError || !created) {
      return null;
    }
    return created as Profile;
  } catch {
    return null;
  }
}
