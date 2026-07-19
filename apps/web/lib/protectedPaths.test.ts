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

test("similar public paths do not accidentally become protected", () => {
  for (const path of ["/", "/login", "/administrator", "/downloads"]) {
    assert.equal(isProtectedWebPath(path), false, `${path} must remain public`);
  }
});
