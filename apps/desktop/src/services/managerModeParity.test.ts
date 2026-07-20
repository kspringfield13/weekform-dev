import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const managerWorkspace = readFileSync(
  new URL("../admin/ManagerAccessWorkspace.tsx", import.meta.url),
  "utf8",
);
const managerStyles = readFileSync(
  new URL("../admin/span-simulator.css", import.meta.url),
  "utf8",
);

test("Manager mode keeps the desktop shell and changes context rather than layout", () => {
  assert.match(
    managerWorkspace,
    /className=\{`manager-access-app\$\{sidebarCollapsed \? " is-sidebar-collapsed" : ""\}`\}[\s\S]*data-workspace-mode=\{mode\}/,
  );
  assert.match(
    managerWorkspace,
    /mode === "manager" && <span className="manager-mode-indicator"/,
  );
  assert.doesNotMatch(managerWorkspace, /manager-access-app[^\n]*\$\{mode/);
});

test("Manager Access uses the same desktop shell proportions as Weekform", () => {
  const managerWorkspaceStyles = managerStyles.slice(
    managerStyles.indexOf("/* Weekform Manager Access workspace */"),
  );

  assert.match(managerWorkspaceStyles, /--manager-toolbar:\s*44px/);
  assert.match(managerWorkspaceStyles, /--manager-sidebar:\s*224px/);
  assert.match(managerWorkspaceStyles, /\.manager-page-shell\s*\{[^}]*padding:\s*18px 20px 32px/s);
  assert.match(managerWorkspaceStyles, /\.manager-page-header h1\s*\{[^}]*font-size:\s*22px/s);
  assert.doesNotMatch(managerWorkspaceStyles, /font-size:\s*clamp\(32px,\s*4vw,\s*50px\)/);
});

test("Manager context is a restrained indicator, not a manager-only chrome band", () => {
  assert.match(managerStyles, /\.manager-mode-indicator\s*\{/);
  assert.match(managerStyles, /\.manager-mode-indicator\s+i\s*\{/);
  assert.doesNotMatch(managerStyles, /\.manager-access-app\[data-workspace-mode="manager"\][^{]*\{[^}]*grid-template/s);
});

test("Manager Mode loads production team data and exposes native window controls", () => {
  assert.match(managerWorkspace, /fetchManagerTeamWorkspace/);
  assert.match(managerWorkspace, /signed-in user included/);
  assert.match(managerWorkspace, /getCurrentWindow\(\)\.minimize\(\)/);
  assert.match(managerWorkspace, /getCurrentWindow\(\)\.toggleMaximize\(\)/);
  assert.doesNotMatch(managerWorkspace, /Synthetic preview|const MEMBERS|Three decisions today|Maya Chen|Ines Duarte/);
});

test("every Manager Mode page is derived from live data or routes to authenticated Web", () => {
  assert.match(managerWorkspace, /<ManagerToday[^>]*allMembers=\{filteredMembers\}/);
  assert.match(managerWorkspace, /<ManagerWeek[^>]*scopeMembers=\{filteredMembers\}/);
  assert.match(managerWorkspace, /<ManagerAgent members=\{filteredMembers\}/);
  assert.match(managerWorkspace, /<ManagerHistory members=\{filteredMembers\}/);
  assert.match(managerWorkspace, /No cached or placeholder team data is displayed/);
});

test("manager comparison controls stay hidden until approved team data is ready", () => {
  assert.match(
    managerWorkspace,
    /mode === "manager" && loadStatus === "ready" && \(page === "today" \|\| page === "week"\)/,
  );
});
