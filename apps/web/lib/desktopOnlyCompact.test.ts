import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const team = readFileSync(new URL("../app/teams/[teamId]/page.tsx", import.meta.url), "utf8");
const entry = readFileSync(new URL("../app/app/page.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const desktop = readFileSync(new URL("../../desktop/src-tauri/src/lib.rs", import.meta.url), "utf8");

test("compact view exists only in the Desktop app", () => {
  assert.doesNotMatch(shell, /WebCompact|openCompactWebWindow|CompactWindowIcon|>Compact</);
  assert.doesNotMatch(dashboard + team + entry, /resolveWebWindowSurface|popup\?:|window\?:|mode\?:/);
  assert.doesNotMatch(globals, /\.web-compact-/);
  assert.equal(existsSync(new URL("../components/WebCompactWorkspace.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../components/WebCompactWindowHandoff.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("./webCompactWindow.ts", import.meta.url)), false);

  assert.match(desktop, /COMPACT_WINDOW_WIDTH/);
  assert.match(desktop, /show_quick_view/);
  assert.match(desktop, /apply_window_mode\([^,]+, "compact"\)/);
});
