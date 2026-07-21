import assert from "node:assert/strict";
import test from "node:test";

import { hasRegisteredDesktop } from "./desktopPresence";

test("desktop presence requires an unrevoked registered device", () => {
  assert.equal(hasRegisteredDesktop(null), false);
  assert.equal(hasRegisteredDesktop([]), false);
  assert.equal(hasRegisteredDesktop([{ id: "desktop-1", revoked_at: "2026-07-20T22:00:00Z" }]), false);
  assert.equal(hasRegisteredDesktop([{ id: "desktop-1", revoked_at: null }]), true);
});

test("desktop presence fails closed for malformed rows", () => {
  assert.equal(hasRegisteredDesktop([{ id: "", revoked_at: null }]), false);
  assert.equal(hasRegisteredDesktop([{ id: 42, revoked_at: null }]), false);
  assert.equal(hasRegisteredDesktop({ id: "desktop-1", revoked_at: null }), false);
});
