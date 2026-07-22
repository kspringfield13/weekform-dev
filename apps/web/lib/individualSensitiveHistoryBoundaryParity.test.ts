import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveIndividualWorkspaceRoute,
  screenForIndividualWorkspaceRoute,
} from "./individualWorkspaceRoute";

const routeSource = readFileSync(
  new URL("./individualWorkspaceRoute.ts", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const historySource = readFileSync(
  new URL("../components/IndividualHistorySettings.tsx", import.meta.url),
  "utf8",
);
const sensitiveBoundarySource = readFileSync(
  new URL("../components/PersonalSensitiveBoundaryScreen.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const managerSources = [
  "../app/manager-access/page.tsx",
  "../app/teams/[teamId]/page.tsx",
].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8"));

test("the Desktop sensitive deep link resolves to the Individual History Flagged boundary and round-trips", () => {
  const expected = { destination: "history", subview: "sensitive" } as const;

  assert.deepEqual(resolveIndividualWorkspaceRoute("sensitive"), expected);
  assert.equal(
    screenForIndividualWorkspaceRoute(
      expected as unknown as Parameters<typeof screenForIndividualWorkspaceRoute>[0],
    ),
    "sensitive",
  );
  assert.match(routeSource, /history:\s*new Set\(\[[^\]]*["']sensitive["']/s);
});

test("Flagged is an addressable Individual History view without entering Manager Access", () => {
  assert.match(
    shellSource,
    /active === ["']history["'] && activeSubview === ["']sensitive["'][\s\S]*?id:\s*["']sensitive["'] as const,\s*label:\s*["']Flagged["']/,
    "Individual History must expose the privacy-safe Flagged destination only while its canonical route is active",
  );
  assert.match(
    dashboardSource,
    /data-web-view=["']history["'][\s\S]*?data-web-subview=["']sensitive["']/,
    "the authenticated Individual workspace must render an explicit sensitive subview",
  );

  for (const source of managerSources) {
    assert.doesNotMatch(source, /data-web-subview=["']sensitive["']/);
    assert.doesNotMatch(source, /IndividualSensitive(?:Boundary|History|Capture)/);
  }
});

test("the Web Flagged view announces that local-only captures are unavailable here", () => {
  assert.match(
    historySource,
    /export function IndividualSensitive(?:Boundary|History|Capture)View/,
    "the local-only boundary should be a named Individual view, not borrowed Manager UI",
  );
  assert.match(
    historySource,
    /(?:role=["']status["']|aria-live=["']polite["'])[\s\S]{0,800}(?:stay|remain)[\s\S]{0,80}(?:on|beside) your Mac/i,
    "assistive technology must receive the local-only privacy boundary",
  );
  assert.match(
    historySource,
    /(?:unavailable|cannot|does not|never)[\s\S]{0,120}(?:Web|browser)|(?:Web|browser)[\s\S]{0,120}(?:unavailable|cannot|does not|never)/i,
    "copy must say plainly that Web cannot display or manage flagged local captures",
  );
  assert.match(historySource, /<WeekformDesktopLink\b/);
  assert.doesNotMatch(historySource, /localStorage|sessionStorage/);
  assert.match(
    sensitiveBoundarySource,
    /(?:Unavailable|Local[- ]only)/i,
    "the visible summary must label the unknown local queue as unavailable or local-only",
  );
  assert.doesNotMatch(
    sensitiveBoundarySource,
    /<strong>\s*0\s*<\/strong>|No flagged captures\./i,
    "Web must not turn an unavailable private count into a false observed zero or empty queue claim",
  );
  assert.doesNotMatch(
    sensitiveBoundarySource,
    /Flagged captures available in this Web workspace/i,
    "the summary tooltip must not claim local captures are available in Web",
  );
});

test("Flagged URL navigation uses the canonical route and Back or Forward restores tab focus", () => {
  assert.match(
    shellSource,
    /const screen = screenForIndividualWorkspaceRoute\(route\)[\s\S]*?searchParams\.set\(["']screen["'],\s*screen\)[\s\S]*?history\.pushState\(/,
    "Flagged navigation must use the same canonical screen URL writer as every Individual view",
  );
  assert.match(
    shellSource,
    /handlePopState[\s\S]*?closest\(["']\.page-context-navigation["']\)[\s\S]*?resolveIndividualWorkspaceRoute\(screen\)[\s\S]*?requestAnimationFrame[\s\S]*?contextTabRefs\.current\[[^\]]+\]\?\.focus\(\)/,
    "Back and Forward must restore keyboard focus to the History tab owning the restored screen",
  );
  assert.match(shellSource, /id=\{`web-tab-\$\{view\.id\}`\}/);
  assert.match(shellSource, /aria-selected=\{activeSubview === view\.id\}/);
  assert.match(shellSource, /tabIndex=\{activeSubview === view\.id \? 0 : -1\}/);
});
