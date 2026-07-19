import { createHash, randomBytes } from "node:crypto";

/**
 * Pure invite helpers for the team invitation flow (server-side only — this
 * module uses node:crypto and must never be imported from a client component).
 *
 * Contract (see supabase/migrations/202607190001_team_cloud_v1.sql):
 *  - The raw token is >= 32 chars of cryptographically random, URL-safe text.
 *  - Only the SHA-256 hex hash is persisted (team_invites.token_hash,
 *    CHECK '^[a-f0-9]{64}$'). The plaintext exists once, in the invite URL.
 *  - Invite emails are stored lowercase (CHECK email = lower(btrim(email))).
 *  - expires_at must be > created_at and <= created_at + 30 days.
 */

export const INVITE_TOKEN_BYTES = 32;
export const INVITE_TTL_DAYS = 7;
export const MIN_RAW_TOKEN_LENGTH = 32;

export const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;

/** URL-safe base64 charset — what generateInviteToken produces. */
const TOKEN_CHARSET_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Generate a raw invite token: 32 random bytes, base64url-encoded (43 chars,
 * comfortably above the RPC's 32-char minimum). Never persist this value.
 */
export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
}

/** Lowercase SHA-256 hex of a raw token — the only form that may be stored. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * True when a string could be a token this app minted: long enough for the
 * RPC's minimum and restricted to the base64url charset.
 */
export function isPlausibleInviteToken(value: string): boolean {
  return (
    value.length >= MIN_RAW_TOKEN_LENGTH && TOKEN_CHARSET_PATTERN.test(value)
  );
}

/**
 * Accept either a raw token or a full invite URL (as pasted by a user) and
 * return the raw token, or null when nothing plausible is present.
 */
export function extractInviteToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("://")) {
    try {
      const url = new URL(trimmed);
      const fromQuery = url.searchParams.get("token");
      return fromQuery && isPlausibleInviteToken(fromQuery) ? fromQuery : null;
    } catch {
      return null;
    }
  }
  return isPlausibleInviteToken(trimmed) ? trimmed : null;
}

/**
 * Normalize an invitee email for storage: trim + lowercase, mirroring the
 * database CHECKs (length 3–320, '@' not first) plus basic shape sanity.
 * Returns null when the input cannot be a deliverable address.
 */
export function normalizeInviteEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 320) {
    return null;
  }
  if (/\s/.test(email)) {
    return null;
  }
  const at = email.indexOf("@");
  if (at < 1 || at === email.length - 1) {
    return null;
  }
  return email;
}

/** ISO timestamp `days` days after `from` (default: the 7-day invite TTL). */
export function inviteExpiresAt(
  from: Date,
  days: number = INVITE_TTL_DAYS,
): string {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Build the shareable invite URL. Origin must include the scheme. */
export function buildInviteUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/invite?token=${encodeURIComponent(token)}`;
}

const GENERIC_ACCEPT_ERROR =
  "The invitation could not be accepted. Try again, and if it keeps failing ask the team manager for a fresh link.";

/**
 * Map the accept_team_invite RPC's `raise exception` messages (surfaced
 * verbatim in the PostgREST error message) to human-readable copy.
 * Substring matching keeps this robust to PostgREST prefixes/suffixes.
 */
export function mapAcceptInviteError(
  message: string | null | undefined,
): string {
  if (!message) {
    return GENERIC_ACCEPT_ERROR;
  }
  if (message.includes("Invalid invitation token")) {
    return "That invite link looks incomplete or damaged. Paste the full link exactly as it was shared with you.";
  }
  if (message.includes("Invitation not found")) {
    return "This invite link isn't recognized. It may have been revoked — ask the team manager for a new one.";
  }
  if (message.includes("already been accepted")) {
    return "This invite has already been used. Each link works exactly once — ask the team manager for a new invite.";
  }
  if (message.includes("Invitation has expired")) {
    return "This invite has expired. Ask the team manager to send you a fresh link.";
  }
  if (message.includes("does not match signed-in account")) {
    return "This invite was issued to a different email address. Sign in with the invited address, or ask the manager to invite the address you're using now.";
  }
  if (message.includes("Already an active member")) {
    return "You're already an active member of this team — there's nothing to accept.";
  }
  if (
    message.includes("Authentication required") ||
    message.includes("no email")
  ) {
    return "You need to be signed in with a confirmed email address to accept an invitation.";
  }
  return GENERIC_ACCEPT_ERROR;
}
