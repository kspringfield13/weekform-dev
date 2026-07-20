import {
  deriveSecretKeyedRequestHash,
  keyRequestIpSubject,
} from "./distributedRequestControl";

export interface WebexBrokerConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface WebexBrokerEnvironment {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  securityVerified?: string;
  controlClaim?: string;
  ipHashSecret?: string;
  trustedIpHeader?: string;
  trustedProxy?: string;
  vercelDeployment?: string;
}

export interface WebexBrokerControlConfig {
  serverClaim: string;
  ipHashSecret: string;
  trustedIpHeader: "x-forwarded-for";
  trustedProxy: "vercel";
}

export type WebexBrokerReadiness =
  | { ready: true; config: WebexBrokerConfig; control: WebexBrokerControlConfig }
  | {
    ready: false;
    reason: "security_unverified" | "configuration_missing" | "controls_missing";
  };

export interface WebexTokenExchange {
  endpoint: "https://webexapis.com/v1/access_token";
  form: URLSearchParams;
}

export interface WebexTokenProjection {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  refreshTokenExpiresIn?: number;
}

/**
 * The operational attestation is necessary but insufficient: readiness also
 * requires the secrets used by the implemented distributed control path.
 */
export function resolveWebexBrokerReadiness(
  environment: WebexBrokerEnvironment,
): WebexBrokerReadiness {
  if (environment.securityVerified !== "true") {
    return { ready: false, reason: "security_unverified" };
  }
  const clientId = environment.clientId?.trim();
  const clientSecret = environment.clientSecret?.trim();
  const redirectUri = environment.redirectUri?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    return { ready: false, reason: "configuration_missing" };
  }
  const serverClaim = environment.controlClaim?.trim();
  const ipHashSecret = environment.ipHashSecret?.trim();
  const trustedIpHeader = environment.trustedIpHeader?.trim().toLowerCase();
  const trustedProxy = environment.trustedProxy?.trim().toLowerCase();
  if (
    !serverClaim
    || new TextEncoder().encode(serverClaim).byteLength < 32
    || !ipHashSecret
    || new TextEncoder().encode(ipHashSecret).byteLength < 32
    || trustedIpHeader !== "x-forwarded-for"
    || trustedProxy !== "vercel"
    || environment.vercelDeployment !== "1"
  ) {
    return { ready: false, reason: "controls_missing" };
  }
  return {
    ready: true,
    config: { clientId, clientSecret, redirectUri },
    control: {
      serverClaim,
      ipHashSecret,
      trustedIpHeader,
      trustedProxy,
    },
  };
}

/** Return an HMAC subject only; the raw trusted-proxy IP is never persisted. */
export function keyWebexIpSubject(
  headers: Pick<Headers, "get">,
  trustedIpHeader: WebexBrokerControlConfig["trustedIpHeader"],
  secret: string,
): string | null {
  return keyRequestIpSubject(headers, {
    ipHashSecret: secret,
    trustedIpHeader,
  });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Webex broker request must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowlist = new Set(allowed);
  if (Object.keys(value).some((key) => !allowlist.has(key))) {
    throw new Error("The Webex broker request contains unsupported fields.");
  }
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value || value.length > maxLength || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function validateConfig(config: WebexBrokerConfig): void {
  boundedString(config.clientId, "Webex client id", 512);
  boundedString(config.clientSecret, "Webex client secret", 4096);
  const redirect = new URL(config.redirectUri);
  if (
    redirect.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(redirect.hostname) ||
    !redirect.port ||
    redirect.pathname !== "/chat-auth/callback" ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password
  ) {
    throw new Error("The configured Webex redirect is invalid.");
  }
}

/** Build a fixed-host Webex exchange without accepting caller-selected credentials or redirects. */
export function buildWebexTokenExchange(
  value: unknown,
  config: WebexBrokerConfig,
): WebexTokenExchange {
  validateConfig(config);
  const input = record(value);
  const grantType = input.grantType;
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    throw new Error("The Webex grant type is invalid.");
  }
  const clientId = boundedString(input.clientId, "Webex client id", 512);
  if (clientId !== config.clientId) {
    throw new Error("The Webex client id is not allowed.");
  }

  const form = new URLSearchParams({
    grant_type: grantType,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  if (grantType === "authorization_code") {
    exactKeys(input, ["grantType", "clientId", "code", "redirectUri", "codeVerifier"]);
    const redirectUri = boundedString(input.redirectUri, "Webex redirect", 1024);
    if (redirectUri !== config.redirectUri) {
      throw new Error("The Webex redirect is not allowed.");
    }
    const code = boundedString(input.code, "Webex authorization code", 4096);
    const verifier = boundedString(input.codeVerifier, "Webex PKCE verifier", 128);
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      throw new Error("The Webex PKCE verifier is invalid.");
    }
    form.set("code", code);
    form.set("redirect_uri", config.redirectUri);
    form.set("code_verifier", verifier);
  } else {
    exactKeys(input, ["grantType", "clientId", "refreshToken"]);
    form.set("refresh_token", boundedString(input.refreshToken, "Webex refresh token", 8192));
  }

  return { endpoint: "https://webexapis.com/v1/access_token", form };
}

/** Key the one-time code/refresh token in memory without retaining it in a receipt. */
export function webexExchangeIdempotencyKey(
  exchange: WebexTokenExchange,
  secret: string,
): string {
  const grantType = exchange.form.get("grant_type");
  const credential = grantType === "authorization_code"
    ? exchange.form.get("code")
    : grantType === "refresh_token"
      ? exchange.form.get("refresh_token")
      : null;
  if (!grantType || !credential) {
    throw new Error("The Webex exchange has no idempotency material.");
  }
  return deriveSecretKeyedRequestHash(secret, [
    "webex_oauth",
    grantType,
    exchange.form.get("client_id") ?? "",
    credential,
  ]);
}

function optionalSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

/** Allowlist the upstream token response before it returns to the native app. */
export function projectWebexTokenResponse(value: unknown): WebexTokenProjection {
  const input = record(value);
  const accessToken = boundedString(input.access_token, "Webex access token", 16_384);
  const refreshToken = boundedString(input.refresh_token, "Webex refresh token", 16_384);
  const expiresIn = optionalSeconds(input.expires_in);
  const refreshTokenExpiresIn = optionalSeconds(input.refresh_token_expires_in);
  return {
    accessToken,
    refreshToken,
    ...(expiresIn !== undefined ? { expiresIn } : {}),
    ...(refreshTokenExpiresIn !== undefined ? { refreshTokenExpiresIn } : {}),
  };
}
