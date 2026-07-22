import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/PersonalAgentWorkspace.tsx", import.meta.url),
  "utf8",
);

test("Web Ask exposes Desktop-shaped transient conversation controls", () => {
  assert.match(source, /aria-label="Clear temporary chat"/);
  assert.match(source, /setTurns\(\[\]\)/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /aria-label=\{copiedTurnIndex === index \? "Copied" : "Copy response"\}/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("failed Web Ask requests can retry the exact transient question", () => {
  assert.match(source, /setFailedQuestion\(cleanQuestion\)/);
  assert.match(source, /onClick=\{\(\) => void ask\(failedQuestion\)\}/);
  assert.match(source, /requestId = crypto\.randomUUID\(\)/);
  assert.match(source, />Retry</);
});

test("the latest answer offers supported follow-ups while actions remain Mac-only", () => {
  assert.match(source, /aria-label="Suggested follow-up questions"/);
  assert.match(source, /Explain the evidence behind that answer\./);
  assert.match(source, /What is the safest commitment I can make next\?/);
  assert.match(source, /Mac approval required · no action run/);
  assert.match(source, /turn\.mode === "mac_handoff"/);
  assert.match(source, /<WeekformDesktopLink\b/);
});
