import assert from "node:assert/strict";
import test from "node:test";

import { isProtectedWebPath } from "./protectedPaths";

test("Manager Access and account surfaces require an authenticated session", () => {
  for (const path of [
    "/admin",
    "/manager-access",
    "/dashboard",
    "/download/artifact",
    "/teams/123",
  ]) {
    assert.equal(isProtectedWebPath(path), true, `${path} must be protected`);
  }
});

test("public pages and content-addressed preview artifacts remain explicitly public", () => {
  for (const path of [
    "/",
    "/login",
    "/administrator",
    "/downloads",
    "/downloads/5a14980de083abb5/Weekform_0.1.0_universal.dmg",
  ]) {
    assert.equal(isProtectedWebPath(path), false, `${path} must remain public`);
  }
});
