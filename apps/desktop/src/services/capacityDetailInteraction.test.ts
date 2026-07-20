import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(new URL("../components/shell/AppShell.tsx", import.meta.url), "utf8");
const managerWorkspace = readFileSync(new URL("../admin/ManagerAccessWorkspace.tsx", import.meta.url), "utf8");
const detailModal = readFileSync(new URL("../components/common/CapacityDetailModal.tsx", import.meta.url), "utf8");

test("the individual capacity card opens the shared capacity detail dialog", () => {
  assert.match(appShell, /className="sidebar-intelligence capacity-summary-trigger"/);
  assert.match(appShell, /aria-haspopup="dialog"/);
  assert.match(appShell, /buildIndividualCapacityDetail\(snapshot, hasWorkBlocks\)/);
  assert.match(appShell, /<CapacityDetailModal[\s\S]*model=\{capacityDetail\}/);
});

test("the manager capacity card opens the same dialog with approved team scope", () => {
  assert.match(managerWorkspace, /className="manager-sidebar-signal capacity-summary-trigger"/);
  assert.match(managerWorkspace, /aria-haspopup="dialog"/);
  assert.match(managerWorkspace, /buildTeamCapacityDetail\(members\)/);
  assert.match(managerWorkspace, /<CapacityDetailModal[\s\S]*model=\{capacityDetail\}/);
});

test("capacity detail is a dismissible modal with an explicit scope indicator", () => {
  assert.match(detailModal, /role="dialog"/);
  assert.match(detailModal, /aria-modal="true"/);
  assert.match(detailModal, /aria-label="Close capacity detail"/);
  assert.match(detailModal, /capacity-detail-scope/);
});
