import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  BUNDLED_ARTIFACT,
  parseArtifactConfig,
  planArtifactResponse,
} from "@/lib/download";

/**
 * Authenticated bridge for the official packaged Weekform artifact.
 *
 * It re-checks the session server-side (never trusts the page render), then
 * prefers a short-lived private Storage URL when one is configured. The Web
 * deployment also ships the release DMG as a static CDN artifact, so the
 * download remains functional without a separate release-bucket credential.
 * The service-role key, when used, stays inside this route.
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
    bundledArtifactUrl: new URL(BUNDLED_ARTIFACT.href, request.url).toString(),
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
