import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("Individual Web carries the Today review queue count into Desktop-parity chrome", () => {
  assert.match(
    shellSource,
    /reviewCount:\s*number/,
    "the Web shell must accept the same review-count input as the Desktop shell",
  );
  assert.match(
    dashboardSource,
    /reviewCount=\{currentReplica\?\.payload\.blocks\.filter\(\(block\)\s*=>\s*!block\.userVerified\)\.length\s*\?\?\s*0\}/,
    "the dashboard must derive the badge from the current review-safe replica without adding storage or another data source",
  );
});

test("Today exposes the Desktop pending-review badge and accessible count", () => {
  assert.match(shellSource, /destination\.id\s*===\s*["']today["']\s*&&\s*reviewCount\s*>\s*0/);
  assert.match(shellSource, /<b\s+aria-hidden[^>]*>\{reviewCount\}<\/b>/);
  assert.match(
    shellSource,
    /<span className=["']visually-hidden["']>/,
    "the spoken count must use the Web app's existing hidden-text utility",
  );
  assert.doesNotMatch(
    shellSource,
    /<span className=["']sr-only["']>/,
    "Desktop's sr-only class is not defined by the Web stylesheet",
  );
  assert.match(
    shellSource,
    /\{reviewCount\}\s+block\{reviewCount\s*===\s*1\s*\?\s*["']["']\s*:\s*["']s["']\}\s+awaiting review/,
    "the visual badge must include the same singular/plural screen-reader text as Desktop",
  );
});

test("Today keeps its label and description stacked when the review badge follows", () => {
  assert.match(
    shellSource,
    /<span className=["']nav-item-copy["']>\s*<strong>\{destination\.label\}<\/strong>\s*<small>\{destination\.description\}<\/small>/,
    "the visible destination copy needs an explicit layout hook that is independent of child order",
  );
  assert.match(
    stylesSource,
    /\.web-individual-app\s+\.nav-item\s*>\s*\.nav-item-copy\s*\{[^}]*display:\s*grid\s*;[^}]*gap:\s*2px\s*;[^}]*min-width:\s*0\s*;/s,
    "the Today title and description must remain a two-row stack when its badge is present",
  );
  assert.doesNotMatch(
    stylesSource,
    /\.web-individual-app\s+\.nav-item\s*>\s*span:last-child/,
    "nav copy layout cannot depend on being the last child because Today appends review-count content",
  );
});

test("History retains the Desktop destination description", () => {
  assert.match(
    shellSource,
    /id:\s*["']history["'],\s*label:\s*["']History["'],\s*description:\s*["']Ledger and audit trail["']/,
  );
});

test("Settings matches Desktop sidebar hierarchy on wide and narrow layouts", () => {
  assert.match(
    shellSource,
    /nav-item-settings/,
    "the Settings destination in the primary list needs a narrow-layout-only class",
  );
  assert.match(
    shellSource,
    /className=\{!teamWorkspace\s*&&\s*active\s*===\s*["']settings["']\s*\?\s*["']settings-button is-active["']\s*:\s*["']settings-button["']\}/,
    "wide Web layouts must expose Settings through the Desktop footer control",
  );
  assert.match(shellSource, /navigate\([^)]*settings/i);
  assert.match(
    shellSource,
    /className="web-sidebar-footer-actions"[\s\S]*?<MacAppLink[\s\S]*?<WeekformMark[\s\S]*?<\/MacAppLink>[\s\S]*?className=\{!teamWorkspace\s*&&\s*active\s*===\s*["']settings["']/,
    "the icon-only Desktop handoff must sit immediately left of the Settings footer control",
  );

  assert.match(
    stylesSource,
    /\.web-individual-app\s+\.nav-item\.nav-item-settings\s*\{[^}]*display:\s*none\s*;/s,
    "the Settings primary-list entry must be hidden on the wide Desktop-style sidebar",
  );
  assert.match(
    stylesSource,
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.web-individual-app\s+\.nav-item\.nav-item-settings\s*\{[^}]*display:\s*grid\s*;/,
    "the Settings primary-list entry must return when the footer control is unavailable on narrow layouts",
  );
  assert.match(
    stylesSource,
    /\.web-sidebar-footer-actions\s*\{[^}]*grid-template-columns:\s*36px\s+minmax\(0,\s*1fr\)/s,
  );
});
