import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync(
  new URL("../components/PersonalAccelerationScreen.tsx", import.meta.url),
  "utf8",
);
const styleSource = readFileSync(
  new URL("../components/PersonalAccelerationScreen.module.css", import.meta.url),
  "utf8",
);

test("Accelerate renders distinct Desktop-shaped waiting, error, and connected states", () => {
  assert.match(componentSource, /presentation\.state === "waiting"/);
  assert.match(componentSource, /presentation\.state === "error"/);
  assert.match(componentSource, /No acceleration plays mined yet\./);
  assert.match(componentSource, /Nothing high-impact to accelerate yet\./);
  assert.match(componentSource, /Ways to reclaim your week\./);
  assert.match(componentSource, /Acceleration availability could not be checked\./);
});

test("unavailable Desktop actions become explicit Mac handoffs instead of inert controls", () => {
  assert.doesNotMatch(componentSource, /<button[\s\S]{0,300}disabled[\s\S]{0,200}Generate Skills/);
  assert.match(componentSource, /Generate Skills on Mac/);
  assert.match(componentSource, /review today on Mac/);
  assert.match(componentSource, /Get Weekform for Mac/);
  assert.doesNotMatch(componentSource, /href="\/download"[^>]*>(?:(?!<\/Link>)[\s\S])*?\b(?:Review|Generate|Finish|Open)\b/i);
  assert.doesNotMatch(componentSource, /Web matches the Desktop workspace/);
});

test("connected Accelerate preserves Desktop hierarchy without fabricating private values", () => {
  for (const phrase of [
    "est. saved / week",
    "Realized savings",
    "Acceleration plays",
    "Confidence unavailable",
    "Private evidence required",
    "Why no plays appear here",
  ]) {
    assert.match(componentSource, new RegExp(phrase));
  }
  assert.match(componentSource, /data-state=\{presentation\.state\}/);
  assert.doesNotMatch(componentSource, /fetch\(|localStorage|sessionStorage|createClient|supabase/i);
});

test("Accelerate carries the Desktop empty-state, synthesis, and play-card geometry", () => {
  for (const selector of [
    ".emptyState",
    ".emptyIcon",
    ".emptyActions",
    ".synthesis",
    ".playGrid",
    ".boundaryCard",
  ]) {
    assert.match(styleSource, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(
    styleSource,
    /\.emptyState\s*\{[\s\S]*?grid-template-columns:\s*40px minmax\(0, 1fr\)[\s\S]*?min-height:\s*144px[\s\S]*?padding:\s*24px/,
  );
  assert.match(
    styleSource,
    /\.emptyIcon\s*\{[\s\S]*?width:\s*40px[\s\S]*?height:\s*40px[\s\S]*?background:\s*var\(--background-subtle\)/,
  );
  assert.match(styleSource, /\.emptyState strong\s*\{[\s\S]*?font-size:\s*14px[\s\S]*?font-weight:\s*600/);
  assert.match(styleSource, /\.emptyState p\s*\{[\s\S]*?font-size:\s*14px[\s\S]*?line-height:\s*20px/);
  assert.match(styleSource, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(280px,\s*1fr\)\)/);
  assert.match(styleSource, /@media \(max-width: 760px\)/);
  assert.match(styleSource, /:focus-visible/);
});
