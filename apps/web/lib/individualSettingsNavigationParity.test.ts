import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildIndividualSettingsUrl,
  shouldPushIndividualSettingsTab,
} from "./individualSettingsRoute";

const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const settingsSource = readFileSync(
  new URL("../components/IndividualHistorySettings.tsx", import.meta.url),
  "utf8",
);

test("Settings follows an allowlisted settings_tab change after client navigation", () => {
  const parentRemountsForResolvedTab =
    /<IndividualSettingsView[\s\S]*?key=\{resolveIndividualSettingsTab\(params\.settings_tab\)\}/.test(dashboardSource)
    || /const\s+(\w+)\s*=\s*resolveIndividualSettingsTab\(params\.settings_tab\)[\s\S]*?<IndividualSettingsView[\s\S]*?key=\{\1\}/.test(dashboardSource);
  const childSynchronizesInitialTab =
    /useEffect\([\s\S]*?setTab\(initialTab\)[\s\S]*?\[initialTab\][\s\S]*?\)/.test(settingsSource);

  assert.equal(
    parentRemountsForResolvedTab || childSynchronizesInitialTab,
    true,
    "initialTab currently seeds useState only; remount the settings view with the allowlisted route tab or synchronize the prop so server-action/search-param navigation cannot leave a stale panel visible",
  );
  assert.equal(
    childSynchronizesInitialTab,
    true,
    "the Settings component must reconcile an updated allowlisted initialTab even when a Next render preserves component state",
  );
});

test("Settings tab selection keeps the canonical deep link synchronized", () => {
  assert.match(
    settingsSource,
    /buildIndividualSettingsUrl\(window\.location\.href,\s*tab\)/,
    "settings tab navigation must build its URL through the canonical allowlisted route helper",
  );
  assert.match(
    settingsSource,
    /window\.history\.pushState\(/,
    "settings tab navigation must create browser history so Back can restore the prior panel",
  );
  assert.match(
    settingsSource,
    /addEventListener\(["']popstate["']/,
    "settings must listen for Back and Forward navigation",
  );
  assert.match(
    settingsSource,
    /const nextTab = resolveIndividualSettingsTab\(value\);[\s\S]*?setTab\(nextTab\)/,
    "settings must reconcile the visible panel from the canonical URL",
  );
  assert.match(
    settingsSource,
    /handlePopState[\s\S]*?focusSettingsTab\(routeTab\)/,
    "Back and Forward must restore keyboard focus to the tab that owns the restored panel",
  );
});

test("Settings deep links preserve unrelated state and reject unknown tabs", () => {
  const current = "https://weekform.dev/app?screen=setup&settings_tab=account&notice=saved&team_error=retry#controls";

  const selected = buildIndividualSettingsUrl(current, "ai-usage");
  assert.equal(selected.searchParams.get("screen"), "setup");
  assert.equal(selected.searchParams.get("settings_tab"), "ai-usage");
  assert.equal(selected.searchParams.get("notice"), "saved");
  assert.equal(selected.searchParams.get("team_error"), "retry");
  assert.equal(selected.hash, "#controls");

  const invalid = buildIndividualSettingsUrl(current, "<script>");
  assert.equal(invalid.searchParams.get("settings_tab"), "data-sources");

  assert.equal(shouldPushIndividualSettingsTab(current, "ai-usage"), true);
  assert.equal(shouldPushIndividualSettingsTab(selected, "ai-usage"), false);
});
