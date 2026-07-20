import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync(
  new URL("../components/PersonalSensitiveBoundaryScreen.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../components/PersonalSensitiveBoundaryScreen.module.css", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);

test("Flagged Captures has a canonical History tab and rendered deep-link target", () => {
  assert.match(shellSource, /active === "history" && activeSubview === "sensitive"[\s\S]*id:\s*"sensitive" as const,\s*label:\s*"Flagged"/);
  assert.match(dashboardSource, /data-web-subview="sensitive"[\s\S]*<IndividualSensitiveBoundaryView\s*\/>/);
});

test("the Web boundary matches the Desktop flagged-capture composition without exposing local evidence", () => {
  assert.match(componentSource, /Flagged captures/);
  assert.match(componentSource, /Review and purge visual captures flagged as sensitive\./);
  assert.match(componentSource, /<strong aria-hidden="true">—<\/strong>/);
  assert.match(componentSource, /Flagged captures are unavailable in Web\./);
  assert.match(componentSource, /Visual captures detected as potentially sensitive will appear here for review and removal\./);
  assert.match(componentSource, /Open Weekform on this Mac/);
  assert.match(componentSource, /aria-label="Flagged captures privacy boundary"/);

  assert.match(stylesSource, /\.screen\s*\{[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/);
  assert.match(stylesSource, /\.intro\s*\{[\s\S]*max-width:\s*60ch[\s\S]*font-size:\s*13px[\s\S]*line-height:\s*1\.5/);
  assert.match(stylesSource, /\.emptyState\s*\{[\s\S]*min-height:\s*148px/);
});

test("the sensitive boundary cannot fetch, persist, render, or mutate Desktop capture data", () => {
  assert.doesNotMatch(componentSource, /fetch\(|createClient|supabase|localStorage|sessionStorage/i);
  assert.doesNotMatch(componentSource, /VisualContextInsight|activity_summary|project_hint|raw_screenshot|onDiscard|Discard capture/);
  assert.doesNotMatch(componentSource, /input|textarea|contentEditable/);
});
