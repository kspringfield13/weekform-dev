import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/PersonalAgentWorkspace.tsx", import.meta.url), "utf8");

test("Individual Web Agent mirrors the desktop grounded Ask hierarchy", () => {
  assert.match(source, /Grounded only in the review-safe summary/);
  assert.match(source, /Reliable capacity/);
  assert.match(source, /Planned/);
  assert.match(source, /Reactive/);
});

test("operational Ask uses the authenticated endpoint while consequential actions hand off to Mac", () => {
  assert.match(source, /fetch\("\/api\/personal-agent"/);
  assert.match(source, /Open Weekform for Mac/);
  assert.match(source, /mac_handoff/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|supabase/i);
});

test("Agent controls are enabled only with a published signal and conversation stays bounded", () => {
  assert.match(source, /disabled=\{!hasSignal \|\| isSending/);
  assert.match(source, /aria-label="Send question"/);
  assert.match(source, /\.slice\(-24\)/);
});

test("Agent privacy copy names the browser boundary precisely", () => {
  assert.match(source, /does not receive raw activity, titles, notes, screenshots, or AI credentials/);
  assert.match(source, /Questions go to Weekform&apos;s authenticated server/);
  assert.match(source, /review-safe workload summary/);
});
