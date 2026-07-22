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
  assert.match(source, /className=\{styles\.macActionCard\}[\s\S]{0,1200}<WeekformDesktopLink\b/);
  assert.match(styles, /\.macActionCard\s*\{/);
  assert.doesNotMatch(source, /(?:execute|confirm|approve)(?:Action|Request)?\s*\(/);
});

test("the current-week briefing exposes the same two grounded shortcuts as Desktop", () => {
  assert.match(source, /className=\{styles\.briefingActions\}/);
  assert.match(source, />Explain forecast\s*<span[^>]*aria-hidden=["']true["'][^>]*>→<\/span><\/button>/);
  assert.match(source, /ask\(["']Explain why my reliable capacity is at its current level\.["']\)/);
  assert.match(source, />Plan my week\s*<span[^>]*aria-hidden=["']true["'][^>]*>→<\/span><\/button>/);
  assert.match(source, /ask\(["']Help me plan my week around my current reliable capacity\.["']\)/);
});

test("empty and populated chat geometry follows the Desktop Agent contract", () => {
  assert.match(source, /turns\.length === 0 && !isSending \? styles\.emptyChat : styles\.hasConversation/);
  assert.doesNotMatch(source, /Ask this published week/);
  assert.match(styles, /\.emptyChat\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?min-height:\s*0;[\s\S]*?border:\s*0;/);
  assert.match(styles, /\.hasConversation\s*\{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(styles, /\.messages\s*\{[\s\S]*?gap:\s*14px;/);
  assert.match(styles, /\.turn\s*\{[\s\S]*?gap:\s*10px;/);
  assert.match(styles, /\.messageMeta\s*\{[\s\S]*?opacity:\s*0;/);
  assert.match(styles, /\.agentMessage:hover\s+\.messageMeta,\s*\.agentMessage:focus-within\s+\.messageMeta\s*\{\s*opacity:\s*1;/);
  assert.match(styles, /\.followups\s*\{[\s\S]*?gap:\s*6px;[\s\S]*?margin-top:\s*10px;/);
  assert.match(styles, /\.followups button\s*\{[\s\S]*?padding:\s*6px 11px;[\s\S]*?font-size:\s*11px;/);
});

test("the composer keeps Desktop Enter and multiline keyboard behavior", () => {
  assert.match(source, /function handleComposerKeyDown\(event: KeyboardEvent<HTMLTextAreaElement>\)/);
  assert.match(source, /event\.key === ["']Enter["'] && \(!event\.shiftKey \|\| event\.metaKey \|\| event\.ctrlKey\)/);
  assert.match(source, /event\.preventDefault\(\);\s*void ask\(question\);/);
  assert.match(source, /onKeyDown=\{handleComposerKeyDown\}/);
});

test("sending and Mac handoff states retain the Desktop card footprints without Web execution", () => {
  assert.match(source, /className=\{styles\.progress\} role=["']status["']/);
  assert.match(source, /Working through your workload/);
  assert.match(source, /Reading review-safe context/);
  assert.match(styles, /\.progress\s*\{[\s\S]*?width:\s*min\(100%, 570px\);[\s\S]*?margin-left:\s*38px;/);
  assert.match(styles, /\.macActionCard\s*\{[\s\S]*?grid-template-columns:\s*32px minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.macActionCard\s*\{[\s\S]*?margin-left:\s*38px;/);
  assert.match(styles, /\.macLink\s*\{[\s\S]*?min-height:\s*30px;[\s\S]*?border-radius:\s*999px;/);
  assert.doesNotMatch(source, /className=\{styles\.agentMessage\}[\s\S]{0,250}turn\.mode === ["']mac_handoff["']/);
  assert.doesNotMatch(source, /(?:execute|confirm|approve)(?:Action|Request)?\s*\(/);
});
