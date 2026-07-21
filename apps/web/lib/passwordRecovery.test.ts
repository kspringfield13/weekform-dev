import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizePasswordResetEmail,
  validateReplacementPassword,
} from "./passwordRecovery";

test("password recovery normalizes email without exposing account existence", () => {
  assert.equal(normalizePasswordResetEmail("  PERSON@Example.COM  "), "person@example.com");
  assert.equal(normalizePasswordResetEmail("   "), null);
  assert.equal(normalizePasswordResetEmail(null), null);
});

test("replacement passwords require matching values and the account minimum", () => {
  assert.deepEqual(validateReplacementPassword("short", "short"), {
    ok: false,
    message: "Use a password of at least 8 characters.",
  });
  assert.deepEqual(validateReplacementPassword("long-enough", "different"), {
    ok: false,
    message: "The passwords do not match.",
  });
  assert.deepEqual(validateReplacementPassword("long-enough", "long-enough"), {
    ok: true,
    password: "long-enough",
  });
});

test("recovery has request and completion pages wired to Supabase server actions", () => {
  const forgotPath = new URL("../app/forgot-password/page.tsx", import.meta.url);
  const resetPath = new URL("../app/reset-password/page.tsx", import.meta.url);
  assert.equal(existsSync(forgotPath), true);
  assert.equal(existsSync(resetPath), true);

  const actions = readFileSync(new URL("../app/auth/actions.ts", import.meta.url), "utf8");
  const login = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  assert.match(actions, /resetPasswordForEmail/);
  assert.match(actions, /updateUser\(\{ password/);
  assert.match(actions, /resolveTrustedWebOrigin/);
  assert.match(login, /href="\/forgot-password"/);
});

test("auth callbacks pin redirects and never expose provider error text", () => {
  const actions = readFileSync(new URL("../app/auth/actions.ts", import.meta.url), "utf8");
  const callback = readFileSync(
    new URL("../app/auth/callback/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(callback, /resolveTrustedWebOrigin/);
  assert.doesNotMatch(callback, /\{\s*searchParams,\s*origin\s*\}/);
  assert.doesNotMatch(actions, /error(?:\?)?\.message/);
  assert.doesNotMatch(callback, /error\.message/);
});
