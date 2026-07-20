import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const globalsSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const badgeUrl = new URL("../components/WebEditionBadge.tsx", import.meta.url);
const lockupSources = [
  "../components/SiteHeader.tsx",
  "../components/SiteFooter.tsx",
  "../components/IndividualWorkspaceShell.tsx",
  "../components/IndividualDashboardBoundaryShell.tsx",
  "../components/WebCompactWorkspace.tsx",
  "../components/WebCompactWindowHandoff.tsx",
].map((path) => ({ path, source: readFileSync(new URL(path, import.meta.url), "utf8") }));

test("every Web-owned Weekform lockup uses the shared WEB edition badge", () => {
  assert.equal(existsSync(badgeUrl), true, "the WEB treatment must have one shared component");

  for (const lockup of lockupSources) {
    assert.match(
      lockup.source,
      /<WebEditionBadge\b/,
      `${lockup.path} must identify the Web edition with the shared badge`,
    );
  }
});

test("the WEB edition reads as a distinct label at compact sizes", () => {
  assert.match(
    globalsSource,
    /\.web-edition-badge\s*\{[^}]*min-height:\s*20px;[^}]*font-size:\s*10px;[^}]*font-weight:\s*700;[^}]*letter-spacing:\s*0\.12em;[^}]*text-transform:\s*uppercase;/s,
  );
  assert.match(globalsSource, /\.web-compact-brand\s+\.web-edition-badge\s*\{[^}]*min-height:\s*18px;/s);
});
