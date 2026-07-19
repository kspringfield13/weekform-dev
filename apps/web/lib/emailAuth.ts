import { safeNextPath } from "./safeNextPath";

export function normalizeMagicLinkEmail(
  value: FormDataEntryValue | null,
): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email || null;
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
