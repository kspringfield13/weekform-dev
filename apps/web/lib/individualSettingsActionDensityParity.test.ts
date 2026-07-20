import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const componentUrl = new URL(
  "../components/PersonalSettingsLocalControl.tsx",
  import.meta.url,
);
const stylesUrl = new URL(
  "../components/PersonalSettingsLocalControl.module.css",
  import.meta.url,
);

function source(url: URL): string {
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

test("local Settings boundaries use a shared informational note without fake actions", () => {
  assert.equal(existsSync(componentUrl), true, "shared boundary-note composition must exist");
  const component = source(componentUrl);

  assert.match(component, /SettingsBoundaryNote/);
  assert.match(component, /On-device settings/);
  assert.doesNotMatch(component, /aria-disabled="true"|<button\b|<Link\b/);
});

test("each informational Settings tab uses one terminal ownership note", () => {
  for (const file of [
    "PersonalDataSourcesSettings.tsx",
    "PersonalAIAssistanceSettings.tsx",
    "PersonalAIUsageSettings.tsx",
    "PersonalNotificationsSettings.tsx",
    "PersonalWebDataControl.tsx",
  ]) {
    const value = source(new URL(`../components/${file}`, import.meta.url));
    assert.match(value, /<SettingsBoundaryNote\b/);
    assert.doesNotMatch(value, /<LocalSettings(?:Control|Handoff)\b|<Link\b[^>]*href=["']\/download["']/);
  }

  const shared = source(componentUrl);
  assert.equal((shared.match(/<Link\b/g) ?? []).length, 0);
});

test("Data Control keeps the operational Web deletion separate from local-only controls", () => {
  const value = source(new URL("../components/PersonalWebDataControl.tsx", import.meta.url));
  const deleteForm = value.match(/<form\b[\s\S]*?<\/form>/)?.[0] ?? "";

  assert.match(deleteForm, /action=\{deletePersonalReplicaHistory\}/);
  assert.match(deleteForm, /<FormSubmitButton\b/);
  assert.match(deleteForm, /confirmMessage=/);
  assert.match(deleteForm, /Delete private Web history/);
  assert.doesNotMatch(deleteForm, /SettingsBoundaryNote/);
  assert.equal((value.match(/<LocalSettingsControl\b/g) ?? []).length, 0);
  assert.equal((value.match(/<SettingsBoundaryNote\b/g) ?? []).length, 1);
});

test("the shared Settings boundary note keeps a fluid, compact geometry", () => {
  const styles = source(stylesUrl);

  assert.doesNotMatch(styles, /\.localControl\s*\{/);
  assert.match(styles, /\.handoff\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*7px minmax\(0, 1fr\)/);
  assert.match(styles, /@media\s*\(max-width:\s*620px\)[\s\S]*?\.handoff\s*\{[\s\S]*?align-items:\s*start/);
});
