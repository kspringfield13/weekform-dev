import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsSource = readFileSync(
  new URL("../components/IndividualHistorySettings.tsx", import.meta.url),
  "utf8",
);

test("Individual Web gives every Desktop Settings tab its own labelled panel", () => {
  const settingsTabMappings = settingsSource.match(/SETTINGS_TABS\.map\(/g) ?? [];

  assert.ok(
    settingsTabMappings.length >= 2,
    "Settings must map the shared tab definition into both tab buttons and distinct tab panels",
  );
  assert.match(
    settingsSource,
    /id=\{`web-settings-panel-\$\{item\.id\}`\}/,
    "each Settings panel needs a stable id derived from its tab",
  );
  assert.match(
    settingsSource,
    /aria-controls=\{`web-settings-panel-\$\{item\.id\}`\}/,
    "each Settings tab must control its matching panel",
  );
  assert.match(
    settingsSource,
    /aria-labelledby=\{`web-settings-tab-\$\{item\.id\}`\}/,
    "each Settings panel must be labelled by its matching tab",
  );
  assert.match(
    settingsSource,
    /hidden=\{tab\s*!==\s*item\.id\}/,
    "inactive Settings panels must use the Desktop hidden-panel contract",
  );
  assert.match(
    settingsSource,
    /role=["']tabpanel["'][^>]*tabIndex=\{0\}/s,
    "the active Desktop-style Settings panel must be keyboard focusable",
  );
  assert.doesNotMatch(
    settingsSource,
    /(?:id|aria-controls)=["']web-settings-tabpanel["']/,
    "a single generic tabpanel cannot preserve the Desktop Settings relationships",
  );
});
