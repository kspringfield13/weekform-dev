import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmailCallbackUrl,
  normalizeMagicLinkEmail,
} from "./emailAuth";

test("magic-link email is normalized and blank input is rejected", () => {
  assert.equal(normalizeMagicLinkEmail("  PERSON@Example.COM  "), "person@example.com");
  assert.equal(normalizeMagicLinkEmail("   "), null);
  assert.equal(normalizeMagicLinkEmail(null), null);
});

test("magic-link callback returns to the requested same-origin Weekform path", () => {
  assert.equal(
    buildEmailCallbackUrl("https://weekform.dev", "/manager-access"),
    "https://weekform.dev/auth/callback?next=%2Fmanager-access",
  );
});

test("magic-link callback falls back safely when next is an external URL", () => {
  assert.equal(
    buildEmailCallbackUrl("http://localhost:3000/", "https://evil.example"),
    "http://localhost:3000/auth/callback?next=%2Fdashboard",
  );
});

test("magic-link callback rejects an invalid request origin", () => {
  assert.throws(
    () => buildEmailCallbackUrl("not-an-origin", "/dashboard"),
    /valid HTTP origin/,
  );
});
