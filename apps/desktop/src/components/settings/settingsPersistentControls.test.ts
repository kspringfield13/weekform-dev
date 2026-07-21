import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const setupSource = readFileSync(
  new URL("./SetupScreen.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

test("walkthrough and window preferences remain visible above every settings tab", () => {
  const preferencesStart = setupSource.indexOf('className="settings-preferences-grid"');
  const tabsStart = setupSource.indexOf('className="settings-tabs"');

  assert.ok(preferencesStart >= 0, "settings should render a persistent preferences group");
  assert.ok(tabsStart > preferencesStart, "persistent preferences should stay above the settings tabs");

  const preferencesSource = setupSource.slice(preferencesStart, tabsStart);
  assert.match(preferencesSource, /App walkthrough/);
  assert.match(preferencesSource, /Default window size/);
  assert.doesNotMatch(
    preferencesSource,
    /isAccountSettings/,
    "account selection must not hide either persistent preference",
  );
});

test("persistent settings preferences use a responsive two-column layout", () => {
  assert.match(
    stylesSource,
    /\.settings-preferences-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
  );
  assert.match(
    stylesSource,
    /\.settings-preferences-grid\s+\.settings-walkthrough-replay\s*\{[^}]*margin:\s*0/s,
  );
  assert.match(
    stylesSource,
    /@media\s*\(max-width:\s*720px\)[\s\S]*?\.settings-preferences-grid\s*\{[^}]*grid-template-columns:\s*1fr/s,
  );
});
