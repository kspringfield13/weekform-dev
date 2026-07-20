import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopSource = readFileSync(
  new URL(
    "../../desktop/src/components/narrative/NarrativeScreen.tsx",
    import.meta.url,
  ),
  "utf8",
);

const webSource = readFileSync(
  new URL("../components/PersonalSummaryScreen.tsx", import.meta.url),
  "utf8",
);
const webStyles = readFileSync(
  new URL("../components/PersonalWeekIntelligence.module.css", import.meta.url),
  "utf8",
);

test("Individual Web Summary short-circuits to a focused waiting state when no review-safe readout exists", () => {
  assert.match(
    desktopSource,
    /if\s*\(\s*!hasNarrativeEvidence\s*\)\s*\{[\s\S]*?<EmptyState\b/,
    "Desktop Summary establishes the no-evidence state before rendering its narrative result",
  );

  const waitingBranchIndex = webSource.search(/if\s*\(\s*!readout\s*\)\s*\{/);
  const resultShellIndex = webSource.indexOf(
    '<div className={styles.result}>',
  );

  assert.notEqual(
    waitingBranchIndex,
    -1,
    "Web Summary must explicitly branch on a missing readout instead of presenting empty Analyst and Manager result panels",
  );
  assert.ok(
    resultShellIndex > waitingBranchIndex,
    "the review-safe waiting branch must return before the populated narrative result shell",
  );

  const waitingBranch = webSource.slice(waitingBranchIndex, resultShellIndex);
  assert.match(waitingBranch, /return\s*\(/);
  assert.match(waitingBranch, /empty-state/);
  assert.match(waitingBranch, /Waiting for Mac|Narrative generation is waiting/i);
  assert.doesNotMatch(
    waitingBranch,
    /narrative-layout|Analyst view|Manager-ready version/,
    "a missing replica is a waiting state, not a populated two-panel narrative result",
  );
});

test("Individual Web Summary fails loudly before rendering either waiting or connected content", () => {
  const errorBranchIndex = webSource.search(/if\s*\(\s*error\s*\)\s*\{/);
  const waitingBranchIndex = webSource.search(/if\s*\(\s*!readout\s*\)\s*\{/);
  const resultShellIndex = webSource.indexOf('<div className={styles.result}>');

  assert.ok(errorBranchIndex > -1 && errorBranchIndex < waitingBranchIndex);
  assert.ok(waitingBranchIndex < resultShellIndex);

  const errorBranch = webSource.slice(errorBranchIndex, waitingBranchIndex);
  assert.match(errorBranch, /role=["']alert["']/);
  assert.match(errorBranch, /Reload this page or resync from Weekform for Mac/i);
  assert.doesNotMatch(errorBranch, /narrative-layout|Analyst view|Manager-ready version|readout\.headline/);
});

test("connected Web Summary matches Desktop result geometry without inventing narrative controls or browser state", () => {
  for (const seam of [
    "narrative-hero",
    "narrative-layout",
    "narrative-panel",
    "analyst-narrative",
    "Manager-ready version",
    "role=\"note\"",
  ]) {
    assert.match(webSource, new RegExp(seam));
  }

  assert.doesNotMatch(webSource, /<textarea\b|fetch\(|localStorage|sessionStorage|createClient\(|supabase/i);
  assert.doesNotMatch(webSource, /Generate Narrative|Regenerate Narrative|Copy as Markdown|Download \.txt/i);
  assert.match(webStyles, /\.summaryScreen\s*\{[\s\S]*?width:\s*min\(100%,\s*1200px\)[\s\S]*?padding:\s*24px 32px 32px/);
  assert.match(webStyles, /\.layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*0\.92fr\) minmax\(0,\s*1\.08fr\)[\s\S]*?gap:\s*12px/);
  assert.match(webStyles, /\.panelHeader\s*\{[\s\S]*?padding:\s*18px 20px 16px/);
  assert.match(webStyles, /\.managerPlaceholder\s*\{[\s\S]*?min-height:\s*190px/);
  assert.match(webStyles, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.layout\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});
