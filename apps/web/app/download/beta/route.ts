import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  BETA_RELEASE_INFO,
  parseArtifactConfig,
  parseBetaArtifactConfig,
  planBetaArtifactResponse,
} from "@/lib/download";

const BETA_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

/**
 * Authenticated bridge for the temporary Weekform Beta Version artifact.
 *
 * This route is intentionally separate from the notarized release route. It
 * accepts only the beta-specific signing proof and never claims Apple
 * notarization or stapling. The private Storage credential stays server-only.
 */
export async function GET(request: Request) {
  const supabase = await createClient();

  const plan = await planBetaArtifactResponse({
    supabaseConfigured: supabase !== null,
    getUser: async () => {
      const {
        data: { user },
        error,
      } = await supabase!.auth.getUser();
      return { userId: error || !user ? null : user.id };
    },
    config: parseBetaArtifactConfig(process.env),
    officialConfig: parseArtifactConfig(process.env),
    createSignedUrl: async (config) => {
      const serviceClient = createServiceClient(
        config.supabaseUrl,
        config.serviceRoleKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data, error } = await serviceClient.storage
        .from(config.bucket)
        .createSignedUrl(config.path, config.signedUrlTtlSeconds, {
          download: BETA_RELEASE_INFO.artifactFilename,
        });
      return error || !data?.signedUrl ? null : data.signedUrl;
    },
    requestUrl: request.url,
  });

  if (plan.kind === "json") {
    return NextResponse.json(plan.body, {
      status: plan.status,
      headers: BETA_RESPONSE_HEADERS,
    });
  }
  return NextResponse.redirect(plan.url, {
    status: plan.status,
    headers: BETA_RESPONSE_HEADERS,
  });
}
