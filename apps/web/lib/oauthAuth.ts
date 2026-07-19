import { safeNextPath } from "./safeNextPath";

export const OAUTH_PROVIDERS = ["google", "github"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function parseOAuthProvider(
  value: FormDataEntryValue | null,
): OAuthProvider | null {
  return typeof value === "string" &&
    OAUTH_PROVIDERS.includes(value as OAuthProvider)
    ? (value as OAuthProvider)
    : null;
}

export function buildOAuthCallbackUrl(
  requestOrigin: string,
  next: FormDataEntryValue | null,
): string {
  let origin: URL;
  try {
    origin = new URL(requestOrigin);
  } catch {
    throw new Error("OAuth sign-in requires a valid HTTP origin.");
  }

  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("OAuth sign-in requires a valid HTTP origin.");
  }

  const callback = new URL("/auth/callback", origin.origin);
  callback.searchParams.set("next", safeNextPath(next));
  return callback.toString();
}
