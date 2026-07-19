// Focused tests for the auth open-redirect guard: only same-origin
// relative paths may be used as a post-auth redirect target. Anything
// protocol-relative (`//`, `/\`, `\\`), absolute, or missing falls back
// to /dashboard. Browsers treat `\` as `/` in redirect locations, so a
// second character of either kind must be rejected.
// Run: npx tsx --test apps/web/lib/safeNextPath.test.ts  (root: npm run test:web)

import test from "node:test";
import assert from "node:assert/strict";

import { safeNextPath } from "./safeNextPath";

test("safeNextPath allows a normal same-origin relative path", () => {
  assert.equal(safeNextPath("/dashboard/x"), "/dashboard/x");
});

test("safeNextPath rejects protocol-relative //host redirects", () => {
  assert.equal(safeNextPath("//evil.com"), "/dashboard");
});

test("safeNextPath rejects backslash bypass /\\host redirects", () => {
  assert.equal(safeNextPath("/\\evil.com"), "/dashboard");
});

test("safeNextPath rejects double-backslash \\\\host redirects", () => {
  assert.equal(safeNextPath("\\\\evil.com"), "/dashboard");
});

test("safeNextPath rejects absolute URLs", () => {
  assert.equal(safeNextPath("https://evil.com"), "/dashboard");
});

test("safeNextPath falls back to /dashboard for empty or missing values", () => {
  assert.equal(safeNextPath(""), "/dashboard");
  assert.equal(safeNextPath(null), "/dashboard");
});
