import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/PersonalAgentWorkspace.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../components/PersonalAgentWorkspace.module.css", import.meta.url),
  "utf8",
);

test("Web Ask exposes Desktop-shaped controls for its page-temporary conversation", () => {
  assert.match(source, /aria-label=["']Clear temporary chat["']/i);
  assert.match(source, /setTurns\(\[\]\)/);
  assert.match(source, /aria-label=\{copiedTurnIndex === index \? ["']Copied["'] : ["']Copy response["']\}/);
  assert.match(source, /navigator\.clipboard\.writeText\(turn\.answer\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("a failed Web Ask can retry the same question without implying an action ran", () => {
  assert.match(source, /setFailedQuestion\(cleanQuestion\)/);
  assert.match(source, /void ask\(failedQuestion\)/);
  assert.match(source, /Nothing was applied/);
});

test("consequential requests use a Mac approval card with no Web execute control", () => {
  assert.match(source, /Mac approval required/);
  assert.match(source, /no action run/i);
  assert.match(
    source,
    /turn\.mode === ["']mac_handoff["'] \? <div className=\{styles\.macActionCard\} role=["']group["'] aria-label=["']Mac approval required["']/,
  );
  assert.match(source, /className=\{styles\.macActionCard\}[\s\S]{0,600}href=["']\/download["']/);
  assert.match(styles, /\.macActionCard\s*\{/);
  assert.doesNotMatch(source, /(?:execute|confirm|approve)(?:Action|Request)?\s*\(/);
});
