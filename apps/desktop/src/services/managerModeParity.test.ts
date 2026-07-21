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
const appShell = readFileSync(
  new URL("../components/shell/AppShell.tsx", import.meta.url),
  "utf8",
);
const screenRouter = readFileSync(
  new URL("../components/shell/ScreenRouter.tsx", import.meta.url),
  "utf8",
);
const screenTypes = readFileSync(
  new URL("../lib/types.ts", import.meta.url),
  "utf8",
);
const teamScreen = readFileSync(
  new URL("../components/team/TeamScreen.tsx", import.meta.url),
  "utf8",
);
const teamGantt = readFileSync(
  new URL("../components/team/TeamGantt.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../App.tsx", import.meta.url),
  "utf8",
);

test("Desktop Team is a membership-gated first-class destination", () => {
  assert.match(screenTypes, /export type Screen\s*=\s*[^;]*"team"/);
  assert.match(appShell, /teamAvailable\s*&&/);
  assert.match(appShell, /onClick=\{\(\)\s*=>\s*setActive\("team"\)\}/);
  assert.match(appShell, /<strong>Team<\/strong>/);
  assert.doesNotMatch(appShell, /<strong>Manager Access<\/strong>/);
  assert.match(screenRouter, /active === "team"[\s\S]*?<TeamScreen/);
});

test("Desktop Team exposes a real-data workload Gantt for members and managers", () => {
  assert.match(teamScreen, /TeamGantt/);
  assert.match(teamScreen, /fetchTeamWorkloadTimeline/);
  assert.match(teamGantt, /week[\s\S]*month[\s\S]*quarter/);
  assert.match(teamGantt, /selectedPoint/);
  assert.match(teamGantt, /event\.key !== "Tab"/);
  assert.match(teamGantt, /returnFocusTo\?\.focus\(\)/);
  assert.doesNotMatch(teamGantt, /Synthetic|const GANTT_FIXTURES/);
  assert.match(teamGantt, /Team workload calendar/);
  assert.match(teamGantt, /Observed history/);
  assert.match(teamGantt, /Today/);
  assert.match(teamGantt, /Forecast window/);
  assert.match(teamGantt, /team-gantt-calendar-week/);
  assert.match(teamGantt, /Workload runway/);
  assert.match(teamGantt, /Reliable capacity[\s\S]*Reactive load[\s\S]*Meetings[\s\S]*Fragmented work/);
});

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

test("Desktop mode toggles retain the current page instead of resetting to Today", () => {
  assert.match(
    managerWorkspace,
    /managerWorkspaceReducer,\s*initialPage,\s*createInitialManagerWorkspaceState/s,
  );
  assert.match(managerWorkspace, /onOpenIndividualWorkspace\(page\)/);
  assert.match(appSource, /initialPage=\{managerWorkspacePageForScreen\(active\)\}/);
  assert.match(appSource, /individualScreenForManagerWorkspacePage\(page, current\)/);
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
  assert.match(managerWorkspace, /<Waypoints[^>]*aria-hidden/);
  assert.match(managerWorkspace, /Team · Manager/);
  assert.doesNotMatch(managerWorkspace, /<span><i aria-hidden \/> Manager Access<\/span>/);
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
