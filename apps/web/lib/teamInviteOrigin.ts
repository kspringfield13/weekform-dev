import { CANONICAL_WEB_ORIGIN } from "./siteIdentity";

export interface TeamInviteOriginEnvironment {
  nodeEnv?: string;
  vercelEnv?: string;
  vercelUrl?: string;
}

function isDnsHostname(hostname: string): boolean {
  return hostname.split(".").every((label) => (
    label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  ));
}

function configuredPreviewOrigin(
  environment: TeamInviteOriginEnvironment,
): string | null {
  if (environment.vercelEnv !== "preview") return null;
  const configuredHost = environment.vercelUrl;
  if (!configuredHost || configuredHost !== configuredHost.trim()) return null;

  let preview: URL;
  try {
    preview = new URL(`https://${configuredHost}`);
  } catch {
    return null;
  }
  if (
    preview.protocol !== "https:"
    || preview.username !== ""
    || preview.password !== ""
    || preview.port !== ""
    || preview.pathname !== "/"
    || preview.search !== ""
    || preview.hash !== ""
    || preview.host !== configuredHost.toLowerCase()
    || !isDnsHostname(preview.hostname)
    || !preview.hostname.endsWith(".vercel.app")
  ) {
    return null;
  }
  return preview.origin;
}

function developmentLoopbackOrigin(headers: Pick<Headers, "get">): string | null {
  const host = headers.get("host");
  if (!host) return null;
  const match = /^(localhost|127\.0\.0\.1)(?::([1-9]\d{0,4}))?$/i.exec(host);
  if (!match) return null;
  const port = match[2];
  if (port && Number(port) > 65_535) return null;
  return `http://${match[1]?.toLowerCase()}${port ? `:${port}` : ""}`;
}

/** Resolve the only origin that may be embedded in a newly minted team invite. */
export function resolveTrustedWebOrigin(
  headers: Pick<Headers, "get">,
  environment: TeamInviteOriginEnvironment,
): string {
  const previewOrigin = configuredPreviewOrigin(environment);
  if (previewOrigin) return previewOrigin;
  if (environment.vercelEnv === "preview" || environment.nodeEnv !== "development") {
    return CANONICAL_WEB_ORIGIN;
  }
  return developmentLoopbackOrigin(headers) ?? CANONICAL_WEB_ORIGIN;
}

/** Backward-compatible semantic name for the team-invite caller. */
export const resolveTeamInviteOrigin = resolveTrustedWebOrigin;
