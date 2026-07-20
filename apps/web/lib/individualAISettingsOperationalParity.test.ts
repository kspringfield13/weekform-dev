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

test("AI settings hand off to a truthful Mac acquisition path", () => {
  const combined = `${sourceIfPresent(assistanceUrl)}\n${sourceIfPresent(usageUrl)}`;

  assert.match(combined, /Get Weekform for Mac/);
  assert.doesNotMatch(
    combined,
    /Open (?:Weekform for Mac|on Mac)/,
    "a /download link must not imply Web can launch an installed desktop app",
  );
});

test("AI settings expose availability without inventing browser-owned configuration", () => {
  const assistance = sourceIfPresent(assistanceUrl);
  const usage = sourceIfPresent(usageUrl);

  assert.match(assistance, /Mac only/i);
  assert.match(assistance, /API (?:key|keys|credentials)/i);
  assert.match(assistance, /Provider|Model/);
  assert.doesNotMatch(
    assistance,
    /Test Connection|Save Settings|Restore recommended defaults/,
    "read-only Web parity must not render Desktop configuration actions",
  );

  assert.match(usage, /Mac only/i);
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

test("AI Usage exposes its operational review-safe Web boundary", () => {
  const usage = sourceIfPresent(usageUrl);

  assert.match(usage, /Web usage boundary/i);
  assert.match(
    usage,
    /href=["']\/app\?screen=usage["']/,
    "AI Usage settings must reach the existing authenticated Week usage screen",
  );
  assert.match(usage, /Available in Web/);
  assert.match(usage, /no (?:usage )?measurements|review-safe boundary/i);
  assert.doesNotMatch(
    usage,
    /Web usage boundary[\s\S]{0,500}<strong>Mac only<\/strong>/,
    "the review-safe Web usage boundary must not be presented as Mac-only",
  );
});
