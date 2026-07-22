import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync(
  new URL("../components/PersonalSkillsLibraryScreen.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../components/PersonalSkillsLibraryScreen.module.css", import.meta.url),
  "utf8",
);

test("Skills uses the Desktop empty-library composition and primary return path", () => {
  assert.match(componentSource, /No saved skills yet\./);
  assert.match(componentSource, /Your skills library is empty\./);
  assert.match(componentSource, /className=\{styles\.emptyState\}/);
  assert.match(componentSource, /className=\{styles\.emptyIcon\}/);
  assert.match(componentSource, /<SkillsIcon name="library" size=\{20\} \/>/);
  assert.match(componentSource, /className=\{styles\.emptyCopy\}[\s\S]*?<strong[\s\S]*?<p>/);
  assert.match(componentSource, /className=\{styles\.emptyActions\}/);
  assert.match(componentSource, /button button-primary/);
  assert.match(componentSource, /Browse acceleration plays/);

  assert.doesNotMatch(componentSource, /from ["']lucide-react["']/);
  assert.match(componentSource, /function SkillsIcon/);
  assert.match(componentSource, /viewBox="0 0 24 24"/);
  assert.match(componentSource, /focusable="false"/);
  assert.match(componentSource, /<SkillsIcon name="(?:library|lock)" size=\{\d+\} aria-hidden="true"/);
  assert.match(stylesSource, /\.emptyState\s*\{[\s\S]*grid-template-columns:\s*42px minmax\(0, 1fr\)[\s\S]*min-height:\s*148px[\s\S]*padding:\s*18px/);
  assert.match(stylesSource, /\.emptyIcon\s*\{[\s\S]*width:\s*42px[\s\S]*height:\s*42px/);
  assert.match(stylesSource, /\.emptyState strong\s*\{[\s\S]*display:\s*block[\s\S]*margin-bottom:\s*7px[\s\S]*font-size:\s*15px[\s\S]*font-weight:\s*650/);
  assert.match(stylesSource, /\.emptyCopy p\s*\{[\s\S]*font-size:\s*14px[\s\S]*line-height:\s*1\.55/);
  assert.match(stylesSource, /\.emptyActions\s*\{[\s\S]*grid-column:\s*2/);
});

test("Skills reserves the Desktop saved-card footprint without inventing browser recipes", () => {
  assert.match(componentSource, /data-local-library-boundary/);
  assert.match(componentSource, /className=\{styles\.boundaryCard\}/);
  assert.match(componentSource, /Not included in replica/);
  assert.match(componentSource, /Recipe content is not uploaded/);
  assert.match(componentSource, /<WeekformDesktopLink\b/);

  assert.match(stylesSource, /\.boundaryCard\s*\{[\s\S]*flex-direction:\s*column[\s\S]*border-radius:\s*14px/);
  assert.match(stylesSource, /\.recipeBoundary\s*\{[\s\S]*white-space:\s*pre-wrap/);
  assert.doesNotMatch(componentSource, /fetch\(|localStorage|sessionStorage|createClient|supabase/i);
});

test("Skills remains responsive and honors reduced motion", () => {
  assert.match(stylesSource, /@media\s*\(max-width:\s*700px\)/);
  assert.match(stylesSource, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
