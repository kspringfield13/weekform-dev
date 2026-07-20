import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOAuthCallbackUrl,
  parseOAuthProvider,
  OAUTH_PROVIDERS,
} from "./oauthAuth";

test("OAuth sign-in exposes only Google and GitHub", () => {
  assert.deepEqual(OAUTH_PROVIDERS, ["google", "github"]);
  assert.equal(parseOAuthProvider("google"), "google");
  assert.equal(parseOAuthProvider("github"), "github");
  assert.equal(parseOAuthProvider("gitlab"), null);
  assert.equal(parseOAuthProvider(null), null);
});

test("OAuth callback returns to the requested same-origin Weekform path", () => {
  assert.equal(
    buildOAuthCallbackUrl("https://weekform.dev", "/app"),
    "https://weekform.dev/auth/callback?next=%2Fapp",
  );
});

test("OAuth callback falls back safely when next is an external URL", () => {
  assert.equal(
    buildOAuthCallbackUrl("http://localhost:3000/", "https://evil.example"),
    "http://localhost:3000/auth/callback?next=%2Fdashboard",
  );
});

test("OAuth callback rejects an invalid request origin", () => {
  assert.throws(
    () => buildOAuthCallbackUrl("not-an-origin", "/dashboard"),
    /valid HTTP origin/,
  );
});
