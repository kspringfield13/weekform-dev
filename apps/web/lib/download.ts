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
  generatedDate: "2026-07-20",
  macOsRequirement: "macOS 13 Ventura or later (Apple silicon or Intel)",
  artifactFilename: "Weekform_0.1.0_universal.dmg",
  architecture: "Apple silicon and Intel",
  releaseChannel: "Build Week preview",
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

/** Temporary, explicitly non-notarized channel used only while Apple processes the release. */
export const BETA_RELEASE_INFO = {
  artifactFilename: "Weekform_0.1.0_universal_Beta.dmg",
} as const;

export interface ReleaseProof {
  /** Explicit release attestation: signed with an Apple Developer ID identity. */
  developerIdSigned: true;
  /** Explicit release attestation: Apple's notarization service accepted it. */
  notarized: true;
  /** Explicit release attestation: the notarization ticket is stapled and validates. */
  stapled: true;
  /** SHA-256 of the exact DMG uploaded to private release storage. */
  sha256: string;
  /** ISO timestamp for the completed verification run. */
  verifiedAt: string;
}

export interface ArtifactConfig {
  /** Supabase Storage bucket holding the official packaged artifact. */
  bucket: string;
  /** Immutable object path: releases/stable/<sha256>/Weekform_0.1.0_universal.dmg. */
  path: string;
  /** Supabase project URL (same project as the publishable client). */
  supabaseUrl: string;
  /** Secret service-role key. Server-only; never sent to the client. */
  serviceRoleKey: string;
  /** How long a signed URL stays valid, in seconds. */
  signedUrlTtlSeconds: number;
  /** Required, explicit proof that the hosted bytes passed the Mac release gate. */
  releaseProof: ReleaseProof;
}

export interface BetaReleaseProof {
  /** The beta is signed with the same Developer ID identity as the release candidate. */
  developerIdSigned: true;
  /** SHA-256 of the exact beta DMG uploaded to private release storage. */
  sha256: string;
  /** ISO timestamp for the beta artifact verification run. */
  verifiedAt: string;
}

export interface BetaArtifactConfig {
  bucket: string;
  path: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  signedUrlTtlSeconds: number;
  releaseProof: BetaReleaseProof;
}

export type ReleasePresentation =
  | {
      kind: "available";
      action: { label: "Download now"; href: "/download/artifact" };
      filename: string;
      note: string;
    }
  | {
      kind: "pending";
      title: "Mac release is being finalized";
      body: string;
      action: { label: "Open Weekform Web"; href: "/app" };
      detail: string;
    };

export type BetaReleasePresentation = {
  kind: "beta";
  title: "Beta Version";
  action: { label: "Download Beta"; href: "/download/beta" };
  filename: typeof BETA_RELEASE_INFO.artifactFilename;
  disclosure: string;
};

const DEFAULT_SIGNED_URL_TTL_SECONDS = 300; // 5 minutes
const MIN_SIGNED_URL_TTL_SECONDS = 30;
const MAX_SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

/**
 * Parse the private-bucket signed-URL configuration from an env-like record.
 *
 * Returns null (not a throw) when any required variable is missing or blank,
 * so callers can treat "unconfigured" as a first-class, honestly-labeled
 * state rather than an error. When private hosting or any required release
 * proof is incomplete, the page and route degrade to an honestly unavailable
 * release action instead of claiming a trusted package exists.
 */
export function parseArtifactConfig(
  env: Record<string, string | undefined>,
): ArtifactConfig | null {
  const bucket = env.WEEKFORM_ARTIFACT_BUCKET?.trim();
  const path = env.WEEKFORM_ARTIFACT_PATH?.trim();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const developerIdSigned = parseRequiredAttestation(
    env.WEEKFORM_ARTIFACT_DEVELOPER_ID_SIGNED,
  );
  const notarized = parseRequiredAttestation(
    env.WEEKFORM_ARTIFACT_NOTARIZED,
  );
  const stapled = parseRequiredAttestation(env.WEEKFORM_ARTIFACT_STAPLED);
  const sha256 = env.WEEKFORM_ARTIFACT_SHA256?.trim().toLowerCase();
  const verifiedAt = env.WEEKFORM_ARTIFACT_VERIFIED_AT?.trim();

  if (
    !bucket
    || !path
    || !supabaseUrl
    || !serviceRoleKey
    || !developerIdSigned
    || !notarized
    || !stapled
    || !sha256
    || !/^[a-f0-9]{64}$/.test(sha256)
    || path !== `releases/stable/${sha256}/${RELEASE_INFO.artifactFilename}`
    || !verifiedAt
    || !isCanonicalUtcTimestamp(verifiedAt)
  ) {
    return null;
  }

  const signedUrlTtlSeconds = parseTtlSeconds(
    env.WEEKFORM_ARTIFACT_SIGNED_URL_TTL_SECONDS,
  );

  return {
    bucket,
    path,
    supabaseUrl,
    serviceRoleKey,
    signedUrlTtlSeconds,
    releaseProof: {
      developerIdSigned,
      notarized,
      stapled,
      sha256,
      verifiedAt,
    },
  };
}

/**
 * Parse the temporary beta channel independently from the trusted release.
 *
 * The beta deliberately has no notarized or stapled fields. Keeping the env
 * namespace and proof shape separate makes it impossible for this fallback
 * to satisfy the official release gate accidentally.
 */
export function parseBetaArtifactConfig(
  env: Record<string, string | undefined>,
): BetaArtifactConfig | null {
  const bucket = env.WEEKFORM_BETA_ARTIFACT_BUCKET?.trim();
  const path = env.WEEKFORM_BETA_ARTIFACT_PATH?.trim();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const developerIdSigned = parseRequiredAttestation(
    env.WEEKFORM_BETA_ARTIFACT_DEVELOPER_ID_SIGNED,
  );
  const sha256 = env.WEEKFORM_BETA_ARTIFACT_SHA256?.trim().toLowerCase();
  const verifiedAt = env.WEEKFORM_BETA_ARTIFACT_VERIFIED_AT?.trim();

  if (
    !bucket
    || !path
    || path.split("/").at(-1) !== BETA_RELEASE_INFO.artifactFilename
    || !supabaseUrl
    || !serviceRoleKey
    || !developerIdSigned
    || !sha256
    || !/^[a-f0-9]{64}$/.test(sha256)
    || path !== `releases/beta/${sha256}/${BETA_RELEASE_INFO.artifactFilename}`
    || !verifiedAt
    || !isCanonicalUtcTimestamp(verifiedAt)
  ) {
    return null;
  }

  return {
    bucket,
    path,
    supabaseUrl,
    serviceRoleKey,
    signedUrlTtlSeconds: parseTtlSeconds(
      env.WEEKFORM_BETA_ARTIFACT_SIGNED_URL_TTL_SECONDS,
    ),
    releaseProof: {
      developerIdSigned,
      sha256,
      verifiedAt,
    },
  };
}

/** True when the private-bucket signed-URL path is fully configured. */
export function isArtifactConfigured(
  env: Record<string, string | undefined>,
): boolean {
  return parseArtifactConfig(env) !== null;
}

/**
 * Turn infrastructure availability into user-facing release behavior.
 *
 * An unpublished artifact is never presented as a disabled download. The
 * visitor gets a useful next action, while the active download state remains
 * filename-specific and explains the short-lived private link.
 */
export function getReleasePresentation(
  config: ArtifactConfig | null,
): ReleasePresentation {
  if (!config) {
    return {
      kind: "pending",
      title: "Mac release is being finalized",
      body:
        "The Mac installer is completing its final release checks. You can keep using Weekform Web with the same account in the meantime.",
      action: { label: "Open Weekform Web", href: "/app" },
      detail:
        "The installer will appear here only after Developer ID signing, Apple notarization, stapler validation, checksum recording, and secure private release hosting are complete.",
    };
  }

  const verifiedDate = formatVerifiedDate(config.releaseProof.verifiedAt);
  return {
    kind: "available",
    action: { label: "Download now", href: "/download/artifact" },
    filename: RELEASE_INFO.artifactFilename,
    note: `Developer ID signed, Apple-notarized, and stapled; verified ${verifiedDate}. Your private link lasts ${formatTtl(config.signedUrlTtlSeconds)}. Open the DMG, move Weekform to Applications, and launch it.`,
  };
}

/** Honest presentation for the signed beta while Apple notarization is pending. */
export function getBetaReleasePresentation(
  config: BetaArtifactConfig,
): BetaReleasePresentation {
  const verifiedDate = formatVerifiedDate(config.releaseProof.verifiedAt);
  return {
    kind: "beta",
    title: "Beta Version",
    action: { label: "Download Beta", href: "/download/beta" },
    filename: BETA_RELEASE_INFO.artifactFilename,
    disclosure: `Developer ID signed and checksum-verified ${verifiedDate}. This beta is not Apple-notarized or stapled, so macOS may block it. Use it only for evaluation; the final release will replace it here. Your private link lasts ${formatTtl(config.signedUrlTtlSeconds)}.`,
  };
}

function parseRequiredAttestation(raw: string | undefined): true | null {
  return raw?.trim().toLowerCase() === "true" ? true : null;
}

function isCanonicalUtcTimestamp(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) {
    return false;
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === raw;
}

function formatVerifiedDate(verifiedAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(verifiedAt));
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

type PrivateArtifactPlanDeps<Config> = {
  supabaseConfigured: boolean;
  getUser: () => Promise<{ userId: string | null }>;
  config: Config | null;
  createSignedUrl: (config: Config) => Promise<string | null>;
  requestUrl: string;
};

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
  return planPrivateArtifactResponse(deps, {
    unavailableMessage:
      "The verified Weekform DMG release is not fully configured. Return to /download for current release status.",
    errorQuery: "artifact",
  });
}

/** The beta route keeps its proof and failure copy separate from the release. */
export async function planBetaArtifactResponse(
  deps: PrivateArtifactPlanDeps<BetaArtifactConfig> & {
    officialConfig?: ArtifactConfig | null;
  },
): Promise<ArtifactPlan> {
  return planPrivateArtifactResponse(deps, {
    unavailableMessage:
      "The Weekform Beta Version is not fully configured. Return to /download for current availability.",
    errorQuery: "beta",
    replacementUrl: deps.officialConfig
      ? new URL("/download/artifact", deps.requestUrl).toString()
      : null,
  });
}

async function planPrivateArtifactResponse<Config>(
  deps: PrivateArtifactPlanDeps<Config>,
  copy: {
    unavailableMessage: string;
    errorQuery: "artifact" | "beta";
    replacementUrl?: string | null;
  },
): Promise<ArtifactPlan> {
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

  if (copy.replacementUrl) {
    return { kind: "redirect", status: 303, url: copy.replacementUrl };
  }

  if (!deps.config) {
    return {
      kind: "json",
      status: 503,
      body: {
        error: "artifact_not_configured",
        message: copy.unavailableMessage,
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
      url: new URL(`/download?error=${copy.errorQuery}`, deps.requestUrl).toString(),
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
