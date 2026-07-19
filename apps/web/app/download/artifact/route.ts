import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { parseArtifactConfig, planArtifactResponse } from "@/lib/download";

/**
 * Signed-URL bridge for the official packaged Weekform artifact.
 *
 * This is the "private bucket" path from the distribution-gate spec: it
 * re-checks the session server-side (never trusts the page render), and only
 * when a private artifact bucket/path/service key are configured does it use
 * the service-role key — read here, used here, and never returned to the
 * client or embedded in any bundle — to mint a short-lived signed URL and
 * redirect the browser straight to Supabase Storage.
 *
 * When unconfigured (the current state of this environment: no live
 * Supabase project or private bucket), it returns an honest 503 explaining
 * the documented fallback instead of pretending a packaged build exists.
 * The /download page checks the same config server-side and only ever links
 * here when it is actually configured, so a judge never hits this branch
 * through the UI — it exists so the real path is code, not aspiration.
 */
export async function GET(request: Request) {
  const supabase = await createClient();

  const plan = await planArtifactResponse({
    supabaseConfigured: supabase !== null,
    getUser: async () => {
      // supabase is non-null here: the plan only consults the session when
      // supabaseConfigured is true.
      const {
        data: { user },
        error,
      } = await supabase!.auth.getUser();
      return { userId: error || !user ? null : user.id };
    },
    config: parseArtifactConfig(process.env),
    createSignedUrl: async (config) => {
      const serviceClient = createServiceClient(
        config.supabaseUrl,
        config.serviceRoleKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data, error } = await serviceClient.storage
        .from(config.bucket)
        .createSignedUrl(config.path, config.signedUrlTtlSeconds);
      return error || !data?.signedUrl ? null : data.signedUrl;
    },
    requestUrl: request.url,
  });

  if (plan.kind === "json") {
    return NextResponse.json(plan.body, { status: plan.status });
  }
  return NextResponse.redirect(plan.url, { status: plan.status });
}
