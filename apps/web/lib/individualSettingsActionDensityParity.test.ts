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

test("local-only Settings rows keep the Desktop control footprint without fake actions", () => {
  assert.equal(existsSync(componentUrl), true, "shared local-control composition must exist");
  const component = source(componentUrl);

  assert.match(component, /aria-disabled="true"/);
  assert.match(component, /Local control/);
  assert.doesNotMatch(component, /<button\b/);
});

test("each local-only Settings tab uses one terminal Mac handoff", () => {
  for (const file of [
    "PersonalAIAssistanceSettings.tsx",
    "PersonalNotificationsSettings.tsx",
    "PersonalWebDataControl.tsx",
  ]) {
    const value = source(new URL(`../components/${file}`, import.meta.url));
    assert.match(value, /<LocalSettingsHandoff\b/);
    assert.match(value, /<LocalSettingsControl\b/);
    assert.doesNotMatch(value, /<Link\b[^>]*href=["']\/download["']/);
  }

  const shared = source(componentUrl);
  assert.equal((shared.match(/<Link\b/g) ?? []).length, 1);
});

test("Data Control keeps the operational Web deletion separate from local-only controls", () => {
  const value = source(new URL("../components/PersonalWebDataControl.tsx", import.meta.url));
  const deleteForm = value.match(/<form\b[\s\S]*?<\/form>/)?.[0] ?? "";

  assert.match(deleteForm, /action=\{deletePersonalReplicaHistory\}/);
  assert.match(deleteForm, /<FormSubmitButton\b/);
  assert.match(deleteForm, /confirmMessage=/);
  assert.match(deleteForm, /Delete private Web history/);
  assert.doesNotMatch(deleteForm, /LocalSettingsControl|LocalSettingsHandoff/);
  assert.equal((value.match(/<LocalSettingsControl\b/g) ?? []).length, 3);
  assert.equal((value.match(/<LocalSettingsHandoff\b/g) ?? []).length, 1);
});

test("the shared Settings control and handoff match Desktop geometry and collapse narrowly", () => {
  const styles = source(stylesUrl);

  assert.match(styles, /\.localControl\s*\{[\s\S]*?min-width:\s*82px[\s\S]*?min-height:\s*32px/);
  assert.match(styles, /\.handoff\s*\{[\s\S]*?display:\s*flex/);
  assert.match(styles, /@media\s*\(max-width:\s*620px\)[\s\S]*?\.handoff\s*\{[\s\S]*?flex-direction:\s*column/);
});
