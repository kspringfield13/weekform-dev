import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  RELEASE_INFO,
  parseArtifactConfig,
  planArtifactResponse,
} from "@/lib/download";

const ARTIFACT_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

/**
 * Authenticated bridge for the official packaged Weekform artifact.
 *
 * It re-checks the session server-side (never trusts the page render), then
 * creates a short-lived private Storage URL only when release hosting and the
 * signed/notarized/stapled verification proof are all configured. The
 * service-role key stays inside this route.
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
        .createSignedUrl(config.path, config.signedUrlTtlSeconds, {
          download: RELEASE_INFO.artifactFilename,
        });
      return error || !data?.signedUrl ? null : data.signedUrl;
    },
    requestUrl: request.url,
  });

  if (plan.kind === "json") {
    return NextResponse.json(plan.body, {
      status: plan.status,
      headers: ARTIFACT_RESPONSE_HEADERS,
    });
  }
  return NextResponse.redirect(plan.url, {
    status: plan.status,
    headers: ARTIFACT_RESPONSE_HEADERS,
  });
}
