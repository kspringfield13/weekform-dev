/**
 * Pure helpers for the account-gated /download page and its
 * /download/artifact signed-URL route.
 *
 * Nothing here touches Supabase, cookies, or the network — that keeps the
 * config-parsing and copy logic testable with plain node:test and keeps the
 * service-role key handling (which does need Supabase) isolated to the route
 * handler, which is the only place it is ever read or used.
 */

/** Static release metadata shown on /download. Update by hand on release. */
export const RELEASE_INFO = {
  version: "0.1.0",
  generatedDate: "2026-07-19",
  macOsRequirement: "macOS 13 Ventura or later (Apple silicon or Intel)",
  artifactFilename: "Weekform_0.1.0_universal.dmg",
  architecture: "Apple silicon and Intel",
  releaseChannel: "Build Week preview",
  verification: "Developer preview — notarization pending",
  releaseNotes: [
    {
      title: "A clearer weekly close",
      body: "Review what changed, resolve uncertain work blocks, and carry a more reliable capacity picture into next week.",
    },
    {
      title: "Mac and Web now work as one system",
      body: "Keep raw evidence and the full workload model on your Mac, then approve only the review-safe summaries you want on the Web.",
    },
    {
      title: "More deliberate Agent actions",
      body: "Grounded answers retain their evidence, and any consequential action stays visible and approval-gated before it runs.",
    },
  ],
  features: [
    "Turn local calendar and activity signals into reviewable work blocks",
    "See planned, reactive, fragmented, and carryover load together",
    "Forecast what reliably fits before accepting more work",
    "Pause capture, correct evidence, export data, or reset at any time",
  ],
  tips: [
    "Begin in Today: confirm or relabel uncertain work before trusting the weekly model.",
    "Use Forecast when a new commitment appears; reliable capacity is not the same as empty calendar time.",
    "Pause from the menu bar whenever you switch into personal or sensitive work.",
  ],
} as const;

export interface ArtifactConfig {
  /** Supabase Storage bucket holding the official packaged artifact. */
  bucket: string;
  /** Object path within that bucket, e.g. "releases/Weekform_0.1.0_universal.dmg". */
  path: string;
  /** Supabase project URL (same project as the publishable client). */
  supabaseUrl: string;
  /** Secret service-role key. Server-only; never sent to the client. */
  serviceRoleKey: string;
  /** How long a signed URL stays valid, in seconds. */
  signedUrlTtlSeconds: number;
}

const DEFAULT_SIGNED_URL_TTL_SECONDS = 300; // 5 minutes
const MIN_SIGNED_URL_TTL_SECONDS = 30;
const MAX_SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

/**
 * Parse the private-bucket signed-URL configuration from an env-like record.
 *
 * Returns null (not a throw) when any required variable is missing or blank,
 * so callers can treat "unconfigured" as a first-class, honestly-labeled
 * state rather than an error — this is what powers the documented fallback:
 * when the official artifact hasn't been uploaded to a private bucket, the
 * page and route degrade to an honestly unavailable release action instead
 * of claiming a packaged download exists.
 */
export function parseArtifactConfig(
  env: Record<string, string | undefined>,
): ArtifactConfig | null {
  const bucket = env.WEEKFORM_ARTIFACT_BUCKET?.trim();
  const path = env.WEEKFORM_ARTIFACT_PATH?.trim();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!bucket || !path || !supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const signedUrlTtlSeconds = parseTtlSeconds(
    env.WEEKFORM_ARTIFACT_SIGNED_URL_TTL_SECONDS,
  );

  return { bucket, path, supabaseUrl, serviceRoleKey, signedUrlTtlSeconds };
}

/** True when the private-bucket signed-URL path is fully configured. */
export function isArtifactConfigured(
  env: Record<string, string | undefined>,
): boolean {
  return parseArtifactConfig(env) !== null;
}

/**
 * Parse and clamp the configured TTL, falling back to a safe default for a
 * missing or malformed value rather than producing an unbounded signed URL.
 */
function parseTtlSeconds(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_SIGNED_URL_TTL_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SIGNED_URL_TTL_SECONDS;
  }
  return Math.min(
    Math.max(parsed, MIN_SIGNED_URL_TTL_SECONDS),
    MAX_SIGNED_URL_TTL_SECONDS,
  );
}

/**
 * The full decision sequence of the /download/artifact route, expressed as a
 * pure plan over injected dependencies so every branch — including the
 * signed-URL "configured" branch that needs a live bucket to exercise for
 * real — is testable without Supabase or the network.
 *
 * Ordering is part of the contract the tests pin down: the session is never
 * consulted when Supabase itself is unconfigured, and `createSignedUrl` (the
 * only step that touches the service-role key) is never invoked unless the
 * caller is authenticated AND the private bucket is fully configured.
 */
export type ArtifactPlan =
  | {
      kind: "json";
      status: 401 | 503;
      body: { error: string; message: string };
    }
  | { kind: "redirect"; status: 303 | 307; url: string };

export async function planArtifactResponse(deps: {
  /** Whether the publishable Supabase client could be constructed at all. */
  supabaseConfigured: boolean;
  /** Server-side session re-check; only called when Supabase is configured. */
  getUser: () => Promise<{ userId: string | null }>;
  /** Parsed private-bucket config, or null when unconfigured. */
  config: ArtifactConfig | null;
  /** Mint a signed URL; resolves null on storage failure. Service-key step. */
  createSignedUrl: (config: ArtifactConfig) => Promise<string | null>;
  /** The incoming request URL, base for the styled-page error redirect. */
  requestUrl: string;
}): Promise<ArtifactPlan> {
  if (!deps.supabaseConfigured) {
    return {
      kind: "json",
      status: 503,
      body: {
        error: "not_configured",
        message:
          "Supabase is not configured for this deployment, so the account-gated download is unavailable.",
      },
    };
  }

  const { userId } = await deps.getUser();

  if (!userId) {
    return {
      kind: "json",
      status: 401,
      body: {
        error: "unauthenticated",
        message: "Sign in to download Weekform.",
      },
    };
  }

  if (!deps.config) {
    return {
      kind: "json",
      status: 503,
      body: {
        error: "artifact_not_configured",
        message:
          "The official Weekform DMG has not been published to the private release bucket yet. Return to /download for current release status.",
      },
    };
  }

  const signedUrl = await deps.createSignedUrl(deps.config);

  if (!signedUrl) {
    // The one failure a signed-in user can actually reach from the /download
    // button, so send them back to the styled page instead of raw JSON.
    return {
      kind: "redirect",
      status: 303,
      url: new URL("/download?error=artifact", deps.requestUrl).toString(),
    };
  }

  return { kind: "redirect", status: 307, url: signedUrl };
}

/** Human-readable expiry window for UI copy, e.g. "5 minutes". */
export function formatTtl(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}
