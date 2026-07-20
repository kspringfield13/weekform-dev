import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const assistanceUrl = new URL(
  "../components/PersonalAIAssistanceSettings.tsx",
  import.meta.url,
);
const usageUrl = new URL(
  "../components/PersonalAIUsageSettings.tsx",
  import.meta.url,
);

function sourceIfPresent(url: URL): string {
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

test("AI settings explain the on-device boundary without acquisition prompts", () => {
  const combined = `${sourceIfPresent(assistanceUrl)}\n${sourceIfPresent(usageUrl)}`;

  assert.match(combined, /SettingsBoundaryNote/);
  assert.doesNotMatch(combined, /Get Weekform for Mac|href=["']\/download["']/);
});

test("AI settings expose availability without inventing browser-owned configuration", () => {
  const assistance = sourceIfPresent(assistanceUrl);
  const usage = sourceIfPresent(usageUrl);

  assert.doesNotMatch(assistance, /Mac only/i);
  assert.match(assistance, /API (?:key|keys|credentials)|API credentials/i);
  assert.match(assistance, /macOS Keychain/);
  assert.match(assistance, /Provider|Model/);
  assert.doesNotMatch(
    assistance,
    /Test Connection|Save Settings|Restore recommended defaults/,
    "read-only Web parity must not render Desktop configuration actions",
  );

  assert.doesNotMatch(usage, /Mac only/i);
  assert.match(usage, /estimates/i);
  assert.match(usage, /manager summar(?:y|ies)/i);
  assert.doesNotMatch(
    usage,
    /Enable Estimates|Disable Estimates|Include in Summary|Make Internal Only|Import Usage CSV/,
    "read-only Web parity must not render controls that mutate local usage state",
  );
});

test("AI Assistance exposes the operational authenticated Web Ask path", () => {
  const assistance = sourceIfPresent(assistanceUrl);

  assert.match(assistance, /Web Ask/);
  assert.match(
    assistance,
    /href=["']\/app\?screen=agent["']/,
    "the operational Web Ask capability must be reachable from its settings surface",
  );
  assert.match(assistance, /Available in Web/);
  assert.match(assistance, /review-safe (?:weekly )?summary/i);
  assert.doesNotMatch(
    assistance,
    /Web Ask[\s\S]{0,500}<strong>Mac only<\/strong>/,
    "Web Ask must not be presented as a Mac-only capability",
  );
});

test("AI Usage documents its review-safe Web boundary without a redundant action", () => {
  const usage = sourceIfPresent(usageUrl);

  assert.match(usage, /Not uploaded/);
  assert.match(usage, /not part of the private Web replica|underlying measurements/i);
  assert.doesNotMatch(usage, /href=["']\/app\?screen=usage["']|Review Web boundary/);
});
