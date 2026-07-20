import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/PersonalAIUsageScreen.tsx", import.meta.url),
  "utf8",
);

test("Web AI Usage follows the Desktop empty-state hierarchy when local measurements are unavailable", () => {
  assert.match(
    source,
    /usage-screen-header[\s\S]*Weekly AI usage[\s\S]*See how AI supports your work\.[\s\S]*usage-empty-state[\s\S]*empty-state-icon[\s\S]*Review AI usage in Weekform for Mac\.[\s\S]*empty-state-actions/,
  );
  assert.match(source, /className=[^\n]*empty-state/);
  assert.match(source, /className=[^\n]*secondary-action/);
  assert.match(source, /Open Settings/);
  assert.match(source, /href=["']\/app\?screen=setup&settings_tab=ai-usage["']/);
  assert.doesNotMatch(source, /role=["']status["']/);
  assert.doesNotMatch(source, /href=["']\/download["']/);
  assert.doesNotMatch(source, /Get Weekform for Mac/);
});

test("Web AI Usage does not turn privacy-boundary copy into synthetic usage metrics", () => {
  assert.doesNotMatch(source, /LOCAL_USAGE_BOUNDARIES|\.map\s*\(/);
  assert.doesNotMatch(source, /usage-metrics|Positive allowlist only|Browser state|Ephemeral/);
  assert.doesNotMatch(source, /Measured tokens|Measured prompts|Estimated cost|Model mix/i);
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|fetch\(|createClient\(|supabase/i,
  );
});

test("Web AI Usage carries the Desktop empty-state geometry and responsive focus treatment", () => {
  const styles = readFileSync(
    new URL("../components/PersonalWeekIntelligence.module.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /\.usageScreen\s*\{[\s\S]*?display:\s*block[\s\S]*?width:\s*min\(100%,\s*1200px\)/);
  assert.match(styles, /\.usageEmptyState\s*\{[\s\S]*?grid-template-columns:\s*40px\s+minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.usageEmptyStateActions\s*\{[\s\S]*?grid-column:\s*2/);
  assert.match(styles, /\.usageSecondaryAction\s*\{[\s\S]*?border:\s*1px solid var\(--border\)[\s\S]*?border-radius:\s*var\(--radius\)[\s\S]*?font-size:\s*14px[\s\S]*?font-weight:\s*500/);
  assert.match(styles, /\.usageSecondaryAction:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--focus-ring\)/);
  assert.doesNotMatch(styles, /\.usageSecondaryAction:focus-visible\s*\{[\s\S]*?var\(--info\)/);
  assert.match(styles, /\.usageEmptyState p\s*\{[\s\S]*?color:\s*var\(--text-muted\)/);
  assert.match(styles, /\.usageIntro\s*\{[\s\S]*?max-width:\s*680px/);
  assert.match(styles, /\.usageSecondaryAction:hover\s*\{[\s\S]*?border-color:[\s\S]*?background:/);
  assert.match(styles, /\.usageSecondaryAction:active\s*\{[\s\S]*?transform:\s*scale\(0\.99\)/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.usageSecondaryAction:active\s*\{[\s\S]*?transform:\s*none/);
  assert.match(
    styles,
    /@media\s*\(max-width:\s*900px\)[\s\S]*?\.usageEmptyState\s*\{[\s\S]*?grid-template-columns:\s*1fr[\s\S]*?\.usageEmptyStateActions\s*\{[\s\S]*?grid-column:\s*1/,
  );
});
