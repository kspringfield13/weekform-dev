import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/PersonalAgentWorkspace.tsx", import.meta.url), "utf8");

test("Individual Web Agent mirrors the desktop grounded Ask hierarchy", () => {
  assert.match(source, /Grounded in this week/);
  assert.match(source, /Reliable capacity/);
  assert.match(source, /Planned/);
  assert.match(source, /Reactive/);
});

test("unsupported Agent actions fail loudly and hand off to the Mac app", () => {
  assert.match(source, /Agent stays with your private evidence on Mac/);
  assert.match(source, /Open Weekform for Mac/);
  assert.match(source, /aria-disabled="true"/);
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|supabase/i);
});

test("unsupported Agent controls are natively disabled, not only described as unavailable", () => {
  assert.match(
    source,
    /<button(?=[^>]*\sdisabled(?:\s|=|>))[^>]*>Ask about this week<\/button>/s,
  );
  assert.match(
    source,
    /<button(?=[^>]*\sdisabled(?:\s|=|>))(?=[^>]*aria-label="Send question")[^>]*>/s,
  );
});

test("Agent privacy copy names the browser boundary precisely", () => {
  assert.match(source, /does not receive raw activity,\s+prompts, notes, or AI credentials/);
  assert.match(source, /review-safe workload summary/);
});
