import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const managerPageUrl = new URL("../app/manager-access/page.tsx", import.meta.url);
const legacyPageUrl = new URL("../app/admin/page.tsx", import.meta.url);

test("the compatibility route selects every authenticated Team workspace", () => {
  assert.equal(existsSync(managerPageUrl), true, "the canonical /manager-access page must exist");
  const source = readFileSync(managerPageUrl, "utf8");
  assert.match(source, /<SiteHeader\s*\/>/);
  assert.match(source, /<SiteFooter\s*\/>/);
  assert.match(source, /getTeamWorkspacePath/);
  assert.match(source, /teams\.map/);
  assert.doesNotMatch(source, /managerAccessMemberships/);
  assert.doesNotMatch(source, /AdminPortal|admin portal/i);
});

test("the legacy admin URL only redirects to the Team selector", () => {
  const source = readFileSync(legacyPageUrl, "utf8");
  assert.match(source, /redirect\("\/manager-access"\)/);
  assert.doesNotMatch(source, /AdminPortalClient|checkSimulatorAdminAccess|has_simulator_admin_access/);
});
