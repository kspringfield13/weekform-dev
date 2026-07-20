import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../next.config";
import { buildContentSecurityPolicy } from "./securityPolicy";

test("production CSP is deny-by-default while allowing Next and Supabase Realtime", () => {
  const policy = buildContentSecurityPolicy({ development: false });

  for (const directive of [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  ]) {
    assert.match(policy, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(policy, /unsafe-eval|http:\/\/127\.0\.0\.1|ws:\/\/127\.0\.0\.1/);
});

test("development CSP adds only the loopback and eval allowances needed by local Next and Supabase", () => {
  const policy = buildContentSecurityPolicy({ development: true });
  assert.match(policy, /'unsafe-eval'/);
  assert.match(policy, /http:\/\/127\.0\.0\.1:\*/);
  assert.match(policy, /ws:\/\/127\.0\.0\.1:\*/);
  assert.match(policy, /http:\/\/localhost:\*/);
  assert.match(policy, /ws:\/\/localhost:\*/);
});

test("authenticated dynamic pages can use a strict per-request script nonce", () => {
  const policy = buildContentSecurityPolicy({
    development: false,
    nonce: "0123456789abcdef0123456789abcdef",
  });
  assert.match(
    policy,
    /script-src 'self' 'nonce-0123456789abcdef0123456789abcdef' 'strict-dynamic'/,
  );
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-eval'/);
});

test("production CSP admits a configured HTTPS Supabase custom origin and its Realtime socket", () => {
  const policy = buildContentSecurityPolicy({
    development: false,
    supabaseUrl: "https://data.weekform.dev",
  });
  assert.match(policy, /https:\/\/data\.weekform\.dev/);
  assert.match(policy, /wss:\/\/data\.weekform\.dev/);
  assert.doesNotMatch(policy, /http:\/\/data\.weekform\.dev|ws:\/\/data\.weekform\.dev/);
});

test("every Web response receives the practical browser security baseline", async () => {
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers!();
  const globalRule = rules.find((rule) => rule.source === "/:path*");
  assert.ok(globalRule, "expected a global security-header rule");

  const headers = new Map(globalRule.headers.map(({ key, value }) => [key, value]));
  assert.ok(headers.get("Content-Security-Policy"));
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(
    headers.get("Permissions-Policy"),
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), display-capture=(), browsing-topics=()",
  );
  assert.equal(headers.get("X-Frame-Options"), "DENY");
});
