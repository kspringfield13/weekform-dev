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
  assert.equal(safeNextPath("//evil.com"), "/app");
});

test("safeNextPath rejects backslash bypass /\\host redirects", () => {
  assert.equal(safeNextPath("/\\evil.com"), "/app");
});

test("safeNextPath rejects double-backslash \\\\host redirects", () => {
  assert.equal(safeNextPath("\\\\evil.com"), "/app");
});

test("safeNextPath rejects absolute URLs", () => {
  assert.equal(safeNextPath("https://evil.com"), "/app");
});

test("safeNextPath falls back to the canonical /app workspace for empty or missing values", () => {
  assert.equal(safeNextPath(""), "/app");
  assert.equal(safeNextPath(null), "/app");
});
