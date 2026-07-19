// Focused tests for the pure invite helpers (no Supabase, no network).
// Run: npx tsx --test apps/web/lib/invites.test.ts  (root: npm run test:web)

import test from "node:test";
import assert from "node:assert/strict";

import {
  TOKEN_HASH_PATTERN,
  buildInviteUrl,
  extractInviteToken,
  generateInviteToken,
  inviteExpiresAt,
  isPlausibleInviteToken,
  mapAcceptInviteError,
  normalizeInviteEmail,
  sha256Hex,
} from "./invites";

test("generateInviteToken produces long, URL-safe, unique tokens", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i += 1) {
    const token = generateInviteToken();
    assert.ok(
      token.length >= 32,
      `token must satisfy the RPC's 32-char minimum, got ${token.length}`,
    );
    assert.match(token, /^[A-Za-z0-9_-]+$/, "token must be base64url");
    assert.ok(!seen.has(token), "tokens must not repeat");
    seen.add(token);
  }
});

test("sha256Hex matches a known vector and the token_hash CHECK shape", () => {
  // Standard SHA-256 test vector.
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const hash = sha256Hex(generateInviteToken());
  assert.match(
    hash,
    TOKEN_HASH_PATTERN,
    "hash must satisfy team_invites_token_hash_shape ('^[a-f0-9]{64}$')",
  );
});

test("sha256Hex never equals its input (plaintext is not stored)", () => {
  const token = generateInviteToken();
  assert.notEqual(sha256Hex(token), token);
});

test("isPlausibleInviteToken enforces length and charset", () => {
  assert.equal(isPlausibleInviteToken(generateInviteToken()), true);
  assert.equal(isPlausibleInviteToken("short"), false);
  assert.equal(isPlausibleInviteToken(""), false);
  assert.equal(
    isPlausibleInviteToken("has spaces ".repeat(5)),
    false,
    "whitespace is never part of a token",
  );
  assert.equal(
    isPlausibleInviteToken("a".repeat(31)),
    false,
    "31 chars is below the RPC minimum",
  );
  assert.equal(isPlausibleInviteToken("a".repeat(32)), true);
});

test("extractInviteToken accepts a raw token", () => {
  const token = generateInviteToken();
  assert.equal(extractInviteToken(token), token);
  assert.equal(extractInviteToken(`  ${token}  `), token, "trims whitespace");
});

test("extractInviteToken accepts a full invite URL", () => {
  const token = generateInviteToken();
  const url = buildInviteUrl("https://weekform.example", token);
  assert.equal(extractInviteToken(url), token);
});

test("extractInviteToken rejects junk", () => {
  assert.equal(extractInviteToken(""), null);
  assert.equal(extractInviteToken("   "), null);
  assert.equal(extractInviteToken("not-a-token"), null);
  assert.equal(
    extractInviteToken("https://weekform.example/invite"),
    null,
    "URL without a token param",
  );
  assert.equal(
    extractInviteToken("https://weekform.example/invite?token=tiny"),
    null,
    "URL with an implausibly short token",
  );
  assert.equal(extractInviteToken("http://"), null, "unparseable URL");
});

test("normalizeInviteEmail lowercases and trims", () => {
  assert.equal(
    normalizeInviteEmail("  Casey.Rivera@Example.COM "),
    "casey.rivera@example.com",
  );
});

test("normalizeInviteEmail rejects invalid shapes", () => {
  assert.equal(normalizeInviteEmail(""), null);
  assert.equal(normalizeInviteEmail("no-at-sign"), null);
  assert.equal(normalizeInviteEmail("@leading.at"), null, "'@' cannot be first");
  assert.equal(normalizeInviteEmail("trailing@"), null, "'@' cannot be last");
  assert.equal(normalizeInviteEmail("has space@example.com"), null);
  assert.equal(
    normalizeInviteEmail(`${"a".repeat(320)}@example.com`),
    null,
    "over the 320-char CHECK",
  );
});

test("inviteExpiresAt defaults to 7 days and stays inside the 30-day CHECK", () => {
  const from = new Date("2026-07-19T12:00:00.000Z");
  assert.equal(inviteExpiresAt(from), "2026-07-26T12:00:00.000Z");
  assert.equal(inviteExpiresAt(from, 1), "2026-07-20T12:00:00.000Z");
  const expiry = new Date(inviteExpiresAt(from));
  const maxAllowed = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
  assert.ok(expiry > from, "expires_at must be after created_at");
  assert.ok(expiry <= maxAllowed, "expires_at must be within 30 days");
});

test("buildInviteUrl encodes the token and normalizes the origin", () => {
  const token = generateInviteToken();
  assert.equal(
    buildInviteUrl("https://weekform.example/", token),
    `https://weekform.example/invite?token=${encodeURIComponent(token)}`,
  );
  // base64url tokens contain '-' and '_' which survive encodeURIComponent
  // unchanged, so the URL round-trips through extractInviteToken.
  assert.equal(
    extractInviteToken(buildInviteUrl("http://localhost:3000", token)),
    token,
  );
});

test("mapAcceptInviteError maps every RPC raise message to distinct copy", () => {
  const rpcMessages = [
    "Invalid invitation token",
    "Invitation not found",
    "Invitation has already been accepted",
    "Invitation has expired",
    "Invitation email does not match signed-in account",
    "Already an active member of this team",
    "Authentication required",
  ];
  const mapped = rpcMessages.map((message) => mapAcceptInviteError(message));
  for (const copy of mapped) {
    assert.ok(copy.length > 20, "every mapping is a real sentence");
    assert.ok(
      !copy.includes("raise"),
      "no SQL internals leak into user-facing copy",
    );
  }
  assert.equal(
    new Set(mapped.slice(0, 6)).size,
    6,
    "the six user-distinguishable failures map to distinct messages",
  );
});

test("mapAcceptInviteError tolerates PostgREST prefixes and unknown input", () => {
  assert.equal(
    mapAcceptInviteError("P0001: Invitation has expired"),
    mapAcceptInviteError("Invitation has expired"),
  );
  const generic = mapAcceptInviteError(undefined);
  assert.equal(mapAcceptInviteError(null), generic);
  assert.equal(mapAcceptInviteError("something novel"), generic);
});
