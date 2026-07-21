import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync(
  new URL("../components/IndividualHistorySettings.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../components/PersonalHistoryScreen.module.css", import.meta.url),
  "utf8",
);

test("Activity uses the Desktop compact-header search while Audit owns the event score", () => {
  assert.match(
    componentSource,
    /tab === ["']activity["']\s*\?\s*\([\s\S]*?aria-label=["']Search review-safe activity["'][\s\S]*?\)\s*:\s*\([\s\S]*?className=\{styles\.summaryScore\}/,
  );
  assert.doesNotMatch(componentSource, /className=\{`audit-toolbar \$\{styles\.activityToolbar\}`\}/);
});

test("History keeps Desktop-density reviewed cards and receipt rows", () => {
  assert.match(
    componentSource,
    /className=\{`\$\{styles\.blockCard\} \$\{row\.reviewStatus === ["']Reviewed["'] \? styles\.reviewedCard : ["']["']\}`\}/,
  );
  assert.match(stylesSource, /\.ledgerList,[\s\S]*?align-content:\s*start;/);
  assert.match(stylesSource, /\.reviewedCard\s*\{[^}]*border-color:[^}]*box-shadow:/s);
  assert.match(stylesSource, /\.auditRow summary\s*\{[^}]*grid-template-columns:\s*minmax\(260px,\s*0\.36fr\)\s+minmax\(0,\s*1fr\);/s);
});

test("History controls expose visible focus and collapse cleanly on narrow screens", () => {
  assert.match(stylesSource, /\.searchBox\s*\{[^}]*flex:\s*0\s+0\s+auto;/s);
  assert.match(stylesSource, /\.searchBox button:focus-visible,[\s\S]*?\.auditFilters button:focus-visible\s*\{/);
  assert.match(stylesSource, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.searchBox\s*\{[^}]*width:\s*100%;/s);
  assert.match(stylesSource, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.blockDuration\s*\{[^}]*min-width:\s*70px;/s);
});
