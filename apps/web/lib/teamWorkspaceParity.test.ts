import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellSource = readFileSync(
  new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const teamPageSource = readFileSync(
  new URL("../app/teams/[teamId]/page.tsx", import.meta.url),
  "utf8",
);
const teamSelectorSource = readFileSync(
  new URL("../app/manager-access/page.tsx", import.meta.url),
  "utf8",
);
const siteHeaderSource = readFileSync(
  new URL("../components/SiteHeader.tsx", import.meta.url),
  "utf8",
);
const modeToggleSource = readFileSync(
  new URL("../components/WorkspaceModeToggle.tsx", import.meta.url),
  "utf8",
);
const globalStylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const teamGanttSource = readFileSync(
  new URL("../app/teams/[teamId]/TeamGantt.tsx", import.meta.url),
  "utf8",
);

test("the side panel exposes Team for any membership and hides it without one", () => {
  assert.match(shellSource, /teamAvailable\s*&&/);
  assert.match(shellSource, /<strong>Team<\/strong>/);
  assert.doesNotMatch(shellSource, /<strong>Manager Access<\/strong>/);
  assert.match(dashboardSource, /teamAvailable=\{teams\.length > 0\}/);
  assert.match(dashboardSource, /teamHref=\{teamHref\}/);
  assert.match(shellSource, /href=\{teamDestinationHref\}/);
  assert.doesNotMatch(shellSource, /href=\{activeTeamHref\}[\s\S]*?<strong>Team<\/strong>/);
});

test("the Individual and Manager switch remains visible above every workspace page", () => {
  assert.match(shellSource, /<main[\s\S]*?<WorkspaceModeToggle[\s\S]*?\{children\}/);
  assert.match(shellSource, /workspaceMode\?:\s*"individual"\s*\|\s*"manager"\s*\|\s*"team"/);
  assert.match(teamPageSource, /workspaceMode="manager"/);
  assert.match(teamPageSource, /workspaceMode="team"/);
  assert.match(shellSource, /teamRole\s*===\s*"member"\s*\?\s*"Team"\s*:\s*"Manager mode"/);
  assert.match(modeToggleSource, /Waypoints/);
  assert.match(modeToggleSource, /sessionStorage/);
  assert.match(modeToggleSource, /rememberWorkspaceMode/);
  assert.doesNotMatch(
    globalStylesSource,
    /data-workspace-mode=["']manager["'][^{]*\.web-workspace-mode-row\s*,[\s\S]*?display:\s*none/,
  );
  assert.doesNotMatch(modeToggleSource, />●●?</);
});

test("manager Team pages preserve the five Desktop destinations with team-wide content", () => {
  for (const view of ["today", "week", "agent", "history", "settings"]) {
    assert.match(
      teamPageSource,
      new RegExp(`data-web-view=["']${view}["']`),
      `the manager workspace must own a distinct ${view} view`,
    );
  }
  for (const heading of [
    "Team workload intelligence",
    "Team capacity",
    "Team briefing",
    "Team history",
    "Team controls",
  ]) {
    assert.match(teamPageSource, new RegExp(heading));
  }
});

test("the Web manager landing view follows the Desktop Team decision contract", () => {
  for (const copy of [
    "Team workload intelligence",
    "Decision now",
    "You are included in the team data",
    "latest team sync",
  ]) {
    assert.match(teamPageSource, new RegExp(copy));
  }
  assert.match(teamPageSource, /reviewCoveragePct/);
  assert.match(teamPageSource, /medianReviewCoverage/);
  assert.match(teamPageSource, /summary\.lastUpdatedAt/);
  assert.match(
    teamPageSource,
    /Decision now[\s\S]*?<TeamGantt[\s\S]*?Team roster/,
    "the real-snapshot Gantt must follow the decision surface before the detailed roster",
  );
});

test("members get a generalized Team workspace without manager-only data", () => {
  assert.match(teamPageSource, /workspaceMode="team"/);
  assert.match(teamPageSource, /teamRole=\{membership\.role\}/);
  assert.match(teamPageSource, /Your team connection/);
  assert.match(teamPageSource, /Your coordination signal/);
  assert.match(teamPageSource, /team-status-rail/);
  assert.match(teamPageSource, /manager\s*\?\s*\([\s\S]*?<ManagerView[\s\S]*?\)\s*:\s*\([\s\S]*?<MemberView/);
  assert.match(shellSource, /!teamWorkspace\s*&&\s*\(active === "today" \|\| active === "week"\)/);
});

test("members and managers get an explorable real-snapshot Gantt horizon", () => {
  assert.match(teamPageSource, /<TeamGantt/);
  assert.match(teamPageSource, /history=\{history\}/);
  assert.match(teamPageSource, /viewerId=\{viewerId\}/);
  assert.match(teamPageSource, /listTeamSnapshotHistory/);
  assert.match(teamGanttSource, /event\.key !== "Tab"/);
  assert.match(teamGanttSource, /returnFocusTo\?\.focus\(\)/);
  assert.match(teamGanttSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(teamGanttSource, /Team workload calendar/);
  assert.match(teamGanttSource, /Observed history/);
  assert.match(teamGanttSource, /Today/);
  assert.match(teamGanttSource, /Team forecast/);
  assert.match(teamGanttSource, /web-team-gantt-calendar-week/);
  assert.match(teamGanttSource, /Workload runway/);
  assert.match(teamGanttSource, /Reliable capacity[\s\S]*Reactive load[\s\S]*Meetings[\s\S]*Fragmented work/);
  assert.match(teamPageSource, /forecast=\{forecast\}/);
});

test("the legacy Manager Access URL is now a role-aware Team selector", () => {
  assert.match(teamSelectorSource, /title:\s*"Team"/);
  assert.match(teamSelectorSource, /listUserTeams/);
  assert.doesNotMatch(teamSelectorSource, /managerAccessMemberships/);
  assert.match(siteHeaderSource, /teams\.length > 0/);
  assert.match(siteHeaderSource, />Team</);
});
