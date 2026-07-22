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

function rule(selector: string): string {
  for (const match of stylesSource.matchAll(/(?:^|})\s*([^{}]+)\{([^{}]*)\}/gm)) {
    const selectors = (match[1] ?? "").split(",").map((value) => value.trim());
    if (selectors.includes(selector)) return match[2] ?? "";
  }
  assert.fail(`missing CSS rule for ${selector}`);
}

test("Activity keeps the Desktop compact-header silhouette instead of adding a Web-only score card", () => {
  const headerStart = componentSource.indexOf("<header");
  const headerEnd = componentSource.indexOf("</header>", headerStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart, "History must expose a semantic screen header");
  const headerSource = componentSource.slice(headerStart, headerEnd);

  assert.match(
    headerSource,
    /aria-label="Search review-safe activity"/,
    "the Activity search belongs in the compact header, matching Desktop LedgerScreen",
  );
  assert.doesNotMatch(
    headerSource,
    /Safe blocks/,
    "Desktop Activity has no summary-score card; Web must not change the header silhouette",
  );
  assert.match(
    headerSource,
    /Web receipts/,
    "Audit retains the Desktop summary-score position for its review-safe receipt count",
  );
});

test("History keeps Desktop's dense, viewport-owned Activity and Audit streams", () => {
  const history = rule(".historyScreen");
  const ledger = rule(".ledgerList");
  const audit = rule(".auditList");
  const activityCard = rule(".blockCard");
  const auditSummary = rule(".auditRow summary");

  assert.match(history, /display:\s*flex\s*;/);
  assert.match(history, /flex-direction:\s*column\s*;/);
  assert.match(history, /gap:\s*12px\s*;/);
  assert.match(history, /min-height:\s*0\s*;/);

  for (const [name, list] of [["Activity", ledger], ["Audit", audit]] as const) {
    assert.match(list, /flex:\s*1\s+1\s+auto\s*;/, `${name} list should own the remaining screen height`);
    assert.match(list, /min-height:\s*0\s*;/, `${name} list must be allowed to shrink inside the screen`);
    assert.match(list, /overflow-y:\s*auto\s*;/, `${name} list should scroll without moving the full workspace`);
    assert.match(list, /padding-right:\s*4px\s*;/, `${name} list should preserve Desktop's scrollbar breathing room`);
  }

  assert.match(activityCard, /padding:\s*14px\s+16px\s*;/);
  assert.match(auditSummary, /grid-template-columns:\s*minmax\(260px,\s*0\.36fr\)\s+minmax\(0,\s*1fr\)\s*;/);
  assert.match(auditSummary, /align-items:\s*center\s*;/);
  assert.match(auditSummary, /padding:\s*12px\s+14px\s*;/);
});

test("Activity separates the current block from a compact earlier-block register", () => {
  assert.match(componentSource, /query\.trim\(\)\s*\?\s*visibleActivity\s*:\s*visibleActivity\.slice\(1\)/);
  assert.match(componentSource, /Search results[\s\S]*Earlier blocks/);
  assert.match(componentSource, /formatHistoryDuration\(row\.durationMinutes\)/);

  const currentBlock = rule(".currentBlock");
  const ledgerHeading = rule(".ledgerHeading");
  assert.match(currentBlock, /padding:\s*14px\s+16px\s*;/);
  assert.match(ledgerHeading, /display:\s*flex\s*;/);
  assert.match(stylesSource, /\.blockMain\s*\{[^}]*margin-top:\s*0\s*;/s);
});

test("History filters and search expose explicit keyboard and screen-reader contracts", () => {
  assert.match(componentSource, /aria-label="Search review-safe activity"/);
  assert.match(componentSource, /aria-label="Search sync receipts"/);
  assert.match(
    componentSource,
    /className=\{styles\.auditFilters\}\s+role="group"\s+aria-label="Audit scope"/,
    "an aria-label on a plain div does not name a recognizable control group",
  );
  assert.match(componentSource, /aria-pressed=\{auditFilter === "receipts"\}/);
  assert.match(componentSource, /aria-pressed=\{auditFilter === "local"\}/);
  assert.ok(
    (componentSource.match(/event\.key === "Escape"/g) ?? []).length >= 2,
    "both Activity and Audit search must clear from Escape",
  );

  const filterButton = rule(".auditFilters button");
  assert.match(filterButton, /min-height:\s*32px\s*;/, "filter targets must match Desktop density and remain operable");
});

test("clear-search controls restore focus to their Activity and Audit inputs", () => {
  assert.match(componentSource, /const activitySearchInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(componentSource, /const auditSearchInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(componentSource, /ref=\{activitySearchInputRef\}/);
  assert.match(componentSource, /ref=\{auditSearchInputRef\}/);
  assert.match(
    componentSource,
    /setQuery\(""\);\s*activitySearchInputRef\.current\?\.focus\(\)/,
    "clearing Activity search should retain the keyboard user's place",
  );
  assert.match(
    componentSource,
    /setAuditQuery\(""\);\s*auditSearchInputRef\.current\?\.focus\(\)/,
    "clearing Audit search should retain the keyboard user's place",
  );
});

test("Audit load failure cannot masquerade as a successful zero-receipt result", () => {
  assert.match(
    componentSource,
    /title=\{error\s*\?\s*["']Web receipt count unavailable["']\s*:\s*["']Successful derived replica syncs available in Web["']\}/,
    "the Audit score tooltip must describe the unavailable state truthfully",
  );
  assert.match(
    componentSource,
    /<strong>\{error\s*\?\s*["']—["']\s*:\s*auditEntries\.length\}<\/strong>/,
    "the Audit score must become unavailable when History failed to load",
  );
  assert.match(
    componentSource,
    /<span className=\{styles\.srOnly\}>\{error\s*\?\s*["']Web receipt count unavailable["']\s*:\s*["']Successful derived replica syncs["']\}<\/span>/,
    "assistive technology must not announce a successful receipt count after load failure",
  );
  assert.match(componentSource, /History could not be loaded/);
});

test("Web History remains a truthful review-safe projection with an explicit local-only handoff", () => {
  assert.match(componentSource, /Raw activity stays on your Mac/);
  assert.match(componentSource, /Local audit history stays on your Mac/);
  assert.match(componentSource, /Web shows completed derived syncs only/);
  assert.match(componentSource, /Web never receives the capture, screenshot, or sensitive summary/);
  assert.match(componentSource, /<WeekformDesktopLink\b/);
  assert.doesNotMatch(componentSource, /localStorage|sessionStorage|fetch\(|createClient\(/);
});

test("History stacks dense headers and rows without horizontal clipping on narrow screens", () => {
  assert.match(
    stylesSource,
    /@media\s*\(max-width:\s*(?:600|720)px\)[\s\S]*?\.screenHeader,[\s\S]*?\.auditToolbar\s*\{[^}]*flex-direction:\s*column\s*;/,
  );
  assert.match(
    stylesSource,
    /@media\s*\(max-width:\s*(?:600|720)px\)[\s\S]*?\.auditRow summary\s*\{[^}]*grid-template-columns:\s*1fr\s*;/,
  );
  assert.match(
    stylesSource,
    /@media\s*\(max-width:\s*(?:600|720)px\)[\s\S]*?\.flaggedBoundary\s*\{[^}]*grid-template-columns:\s*1fr\s*;/,
  );
});
