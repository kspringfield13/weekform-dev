import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const settingsSource = readFileSync(
  new URL("../components/IndividualHistorySettings.tsx", import.meta.url),
  "utf8",
);
const assistanceUrl = new URL(
  "../components/PersonalAIAssistanceSettings.tsx",
  import.meta.url,
);
const usageUrl = new URL(
  "../components/PersonalAIUsageSettings.tsx",
  import.meta.url,
);
const stylesUrl = new URL(
  "../components/PersonalAISettings.module.css",
  import.meta.url,
);

function sourceIfPresent(url: URL): string {
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

test("Web Settings mounts dedicated AI Assistance and AI Usage parity surfaces", () => {
  assert.equal(existsSync(assistanceUrl), true);
  assert.equal(existsSync(usageUrl), true);
  assert.match(settingsSource, /<PersonalAIAssistanceSettings\s*\/>/);
  assert.match(settingsSource, /<PersonalAIUsageSettings\s*\/>/);
});

test("AI Assistance keeps Desktop hierarchy while making local ownership explicit", () => {
  const source = sourceIfPresent(assistanceUrl);

  for (const label of [
    "AI assistance",
    "AI Provider",
    "Provider connection",
    "Classification and guidance",
    "Visual Context",
  ]) {
    assert.match(source, new RegExp(label, "i"));
  }

  assert.match(source, /stored locally only/i);
  assert.match(source, /reviewable/i);
  assert.match(
    source,
    /OpenAI(?: \(or OpenAI-compatible\)|-compatible)[\s\S]{0,240}only the Agent chat/i,
    "Web must preserve Desktop's distinction between generation-capable providers and chat-only providers",
  );
  assert.match(source, /Web Ask uses its separate authenticated server path/i);
  assert.doesNotMatch(source, /browser does not receive[^.]*private prompts/i);
  assert.match(source, /href=["']\/download["']/);
});

test("AI Usage keeps Desktop hierarchy without reconstructing local measurements", () => {
  const source = sourceIfPresent(usageUrl);

  for (const label of [
    "AI usage",
    "Observed AI estimates",
    "Include AI usage in manager summaries",
    "Usage CSV import",
    "Model pricing",
  ]) {
    assert.match(source, new RegExp(label, "i"));
  }

  assert.match(source, /not copied|never uploaded|stays on your Mac/i);
  assert.match(source, /href=["']\/download["']/);
  assert.doesNotMatch(source, /Measured tokens|Measured prompts|Estimated cost|Model mix/i);
});

test("AI settings remain read-only, cache-free, and responsive in Web", () => {
  const combined = `${sourceIfPresent(assistanceUrl)}\n${sourceIfPresent(usageUrl)}`;
  const styles = sourceIfPresent(stylesUrl);

  assert.doesNotMatch(
    combined,
    /<input\b|<select\b|<textarea\b|<form\b|localStorage|sessionStorage|fetch\(|createClient\(|supabase/i,
  );
  assert.match(combined, /PersonalAISettings\.module\.css/);
  assert.match(styles, /\.row\s*\{/);
  assert.match(styles, /@media\s*\(max-width:[^)]+\)[\s\S]*?\.row\s*\{/);
});
