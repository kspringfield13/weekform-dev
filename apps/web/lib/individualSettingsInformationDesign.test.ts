import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = (name: string) => readFileSync(
  new URL(`../components/${name}`, import.meta.url),
  "utf8",
);

const dataSources = component("PersonalDataSourcesSettings.tsx");
const dataControl = component("PersonalWebDataControl.tsx");
const aiAssistance = component("PersonalAIAssistanceSettings.tsx");
const aiUsage = component("PersonalAIUsageSettings.tsx");
const notifications = component("PersonalNotificationsSettings.tsx");
const boundaryNote = component("PersonalSettingsLocalControl.tsx");
const allSettings = [dataSources, dataControl, aiAssistance, aiUsage, notifications].join("\n");

test("Data Sources lists implemented evidence sources instead of an unavailable Email control", () => {
  assert.doesNotMatch(dataSources, /title:\s*["']Email["']/);
  assert.doesNotMatch(dataSources, /^\s*email:\s*</m);
  assert.match(dataSources, /Email message content is not collected/);
  assert.match(dataSources, /Derived workload only/);
  assert.match(dataSources, /Provider-free when published/);
});

test("read-only Settings boundaries are informative rather than disabled button rows", () => {
  assert.doesNotMatch(allSettings, /LocalSettingsControl/);
  assert.doesNotMatch(allSettings, />Mac only</);
  assert.doesNotMatch(allSettings, /Get Weekform for Mac/);
  assert.doesNotMatch(allSettings, /LocalSettingsHandoff/);
  assert.match(allSettings, /SettingsBoundaryNote/);

  assert.doesNotMatch(boundaryNote, /import Link/);
  assert.doesNotMatch(boundaryNote, /className="button/);
  assert.match(boundaryNote, /export function SettingsBoundaryNote/);
});

test("Settings preserves only real Web actions", () => {
  assert.match(dataControl, /Delete private Web history/);
  assert.match(aiAssistance, /Open Web Ask/);
  assert.doesNotMatch(aiUsage, /Review Web boundary/);
});
