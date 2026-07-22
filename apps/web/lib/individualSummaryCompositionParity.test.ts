import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentUrl = new URL(
  "../components/PersonalSummaryScreen.tsx",
  import.meta.url,
);
const stylesUrl = new URL(
  "../components/PersonalWeekIntelligence.module.css",
  import.meta.url,
);

test("Individual Web Summary preserves the Desktop narrative result hierarchy", () => {
  const source = readFileSync(componentUrl, "utf8");

  assert.match(source, /className=\{styles\.result\}/);
  assert.match(source, /className=\{styles\.heroCopy\}/);
  assert.match(source, /className=\{styles\.heroFooter\}/);
  assert.match(source, /className=\{styles\.statusGroup\}/);
  assert.match(source, /Synced <time dateTime=/);
  assert.match(source, /Derived replica/);
});

test("Individual Web Summary exposes Desktop-shaped evidence and manager panels without inventing private data", () => {
  const source = readFileSync(componentUrl, "utf8");

  assert.match(source, /Evidence considered/);
  assert.match(source, /signal\{readout\.signals\.length === 1 \? "" : "s"\}/);
  assert.match(source, /className=\{styles\.signalList\}/);
  assert.match(source, /className=\{styles\.managerToolbar\}/);
  assert.match(source, /Private local draft/);
  assert.match(source, /<WeekformDesktopLink\b/);
  assert.doesNotMatch(source, /fetch\(|createClient\(|localStorage|sessionStorage/);
});

test("Individual Web Summary CSS carries the Desktop two-panel geometry and responsive collapse", () => {
  const source = readFileSync(stylesUrl, "utf8");

  assert.match(source, /\.result\s*\{/);
  assert.match(source, /\.heroFooter\s*\{/);
  assert.match(source, /grid-template-columns:\s*minmax\(0, 0\.92fr\) minmax\(0, 1\.08fr\)/);
  assert.match(source, /\.signalList\s*\{/);
  assert.match(source, /\.managerToolbar\s*\{/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*\.layout\s*\{[\s\S]*grid-template-columns:\s*1fr/);
});
