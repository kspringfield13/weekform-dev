import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const desktopUsageSource = readFileSync(
  new URL("../../desktop/src/components/usage/UsageScreen.tsx", import.meta.url),
  "utf8",
);
const desktopSummarySource = readFileSync(
  new URL("../../desktop/src/components/narrative/NarrativeScreen.tsx", import.meta.url),
  "utf8",
);
const webUsageUrl = new URL(
  "../components/PersonalAIUsageScreen.tsx",
  import.meta.url,
);
const webSummaryUrl = new URL(
  "../components/PersonalSummaryScreen.tsx",
  import.meta.url,
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const stylesUrl = new URL(
  "../components/PersonalWeekIntelligence.module.css",
  import.meta.url,
);

function sourceIfPresent(url: URL): string {
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

test("AI Usage and Summary mount dedicated Desktop-shaped Web screens", () => {
  assert.equal(
    existsSync(webUsageUrl),
    true,
    "PersonalAIUsageScreen must own Week → AI Usage instead of the generic Mac-only panel",
  );
  assert.equal(
    existsSync(webSummaryUrl),
    true,
    "PersonalSummaryScreen must own Week → Summary instead of the generic Mac-only panel",
  );

  assert.match(dashboardSource, /<PersonalAIUsageScreen\b/);
  assert.match(dashboardSource, /<PersonalSummaryScreen\b/);
  assert.match(
    dashboardSource,
    /data-web-subview=["']usage["'][\s\S]*?<PersonalAIUsageScreen\b/,
  );
  assert.match(
    dashboardSource,
    /data-web-subview=["']summary["'][\s\S]*?<PersonalSummaryScreen\b/,
  );
});

test("review-safe AI Usage preserves the Desktop screen hierarchy without reconstructing local measurements", () => {
  const webSource = sourceIfPresent(webUsageUrl);

  for (const landmark of [
    "usage-screen",
    "usage-screen-header",
  ]) {
    assert.match(desktopUsageSource, new RegExp(landmark));
    assert.match(
      webSource,
      new RegExp(landmark),
      `Web AI Usage must preserve Desktop's ${landmark} composition seam`,
    );
  }

  assert.match(webSource, /Weekly AI usage/i);
  assert.match(webSource, /review-safe|not part of the Web replica|not uploaded/i);
  assert.match(webSource, /role=["']status["']/);
  assert.match(webSource, /href=["']\/download["']/);
  assert.doesNotMatch(webSource, /Measured tokens|Measured prompts|Estimated cost|Model mix/i);
});

test("review-safe Summary preserves the Desktop composition as a deterministic replica readout", () => {
  const webSource = sourceIfPresent(webSummaryUrl);

  for (const landmark of [
    "narrative-screen",
    "screen-header",
    "narrative-layout",
    "narrative-panel",
    "analyst-narrative",
    "manager",
  ]) {
    assert.match(desktopSummarySource, new RegExp(landmark));
    assert.match(
      webSource,
      new RegExp(landmark),
      `Web Summary must preserve Desktop's ${landmark} composition seam`,
    );
  }

  assert.match(webSource, /Weekly summary/i);
  assert.match(webSource, /replica|review-safe/i);
  assert.match(webSource, /replicas:\s*PersonalReplicaView\[\]/);
  assert.match(webSource, /error:\s*string\s*\|\s*null/);
  assert.match(webSource, /role=["']alert["']/);
  assert.match(webSource, /role=["']status["']/);
  assert.match(webSource, /href=["']\/download["']/);
  assert.doesNotMatch(webSource, /<textarea\b/);
  assert.doesNotMatch(
    webSource,
    /generatedNarrative|hasNarrativeEvidence|onRegenerate|onManagerSummaryChange|Generate Narrative|Regenerate Narrative|Copy as Markdown|Download \.txt|Editable draft|navigator\.clipboard|downloadTextFile|AuditEvent|onComplete/i,
  );
});

test("AI Usage and Summary keep the existing Web data boundary and responsive Desktop styling", () => {
  const usageSource = sourceIfPresent(webUsageUrl);
  const summarySource = sourceIfPresent(webSummaryUrl);
  const combinedSource = `${usageSource}\n${summarySource}`;
  const stylesSource = sourceIfPresent(stylesUrl);

  assert.doesNotMatch(
    combinedSource,
    /localStorage|sessionStorage|fetch\(|createClient\(|supabase/i,
  );
  assert.match(usageSource, /PersonalWeekIntelligence\.module\.css/);
  assert.match(summarySource, /PersonalWeekIntelligence\.module\.css/);
  assert.match(stylesSource, /\.metrics\s*\{/);
  assert.match(stylesSource, /\.layout\s*\{/);
  assert.match(
    stylesSource,
    /@media\s*\(max-width:[^)]+\)[\s\S]*?\.(?:metrics|layout)\s*\{/,
    "AI Usage or Summary must adapt its Desktop composition at the Web narrow breakpoint",
  );
});
