import { safeNextPath } from "./safeNextPath";

interface MagicLinkAuthError {
  code?: string;
  message?: string;
}

export function normalizeMagicLinkEmail(
  value: FormDataEntryValue | null,
): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email || null;
}

export function isMissingMagicLinkAccountError(
  error: MagicLinkAuthError,
): boolean {
  return (
    error.code === "otp_disabled" &&
    /signups? not allowed for otp/i.test(error.message ?? "")
  );
}

export function buildEmailCallbackUrl(
  requestOrigin: string,
  next: FormDataEntryValue | null,
): string {
  let origin: URL;
  try {
    origin = new URL(requestOrigin);
  } catch {
    throw new Error("Passwordless sign-in requires a valid HTTP origin.");
  }

  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("Passwordless sign-in requires a valid HTTP origin.");
  }

  const callback = new URL("/auth/callback", origin.origin);
  callback.searchParams.set("next", safeNextPath(next));
  return callback.toString();
}
