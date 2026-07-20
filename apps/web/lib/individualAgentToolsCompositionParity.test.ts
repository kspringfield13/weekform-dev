import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);

function readOptionalComponent(relativePath: string): string {
  const url = new URL(relativePath, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

const accelerationSource = readOptionalComponent(
  "../components/PersonalAccelerationScreen.tsx",
);
const skillsSource = readOptionalComponent(
  "../components/PersonalSkillsLibraryScreen.tsx",
);
const askSource = readOptionalComponent(
  "../components/PersonalAgentWorkspace.tsx",
);

test("Ask preserves the Desktop Agent hierarchy with authenticated review-safe questions", () => {
  for (const phrase of [
    "Ask Agent",
    "Weekform Agent",
    "Common questions",
    "Ask about your capacity",
  ]) {
    assert.match(askSource, new RegExp(phrase));
  }
  assert.match(askSource, /personal-agent-briefing/);
  assert.match(askSource, /personal-agent-starter-grid/);
  assert.match(askSource, /personal-agent-composer/);
  assert.match(askSource, /fetch\("\/api\/personal-agent"/);
  assert.match(askSource, /aria-label="Send question"/);
  assert.match(askSource, /review-safe workload summary/);
  assert.doesNotMatch(askSource, /localStorage|sessionStorage|createClient|supabase/i);
});

test("Agent Accelerate and Skills use dedicated Desktop-shaped Web screens", () => {
  assert.match(dashboardSource, /import \{ PersonalAccelerationScreen \}/);
  assert.match(dashboardSource, /import \{ PersonalSkillsLibraryScreen \}/);
  assert.match(
    dashboardSource,
    /data-web-subview="accelerate"[\s\S]*?<PersonalAccelerationScreen\s+replica=\{currentReplica\?\.payload \?\? null\}/,
  );
  assert.match(
    dashboardSource,
    /data-web-subview="skills"[\s\S]*?<PersonalSkillsLibraryScreen/,
  );
  assert.doesNotMatch(
    dashboardSource,
    /data-web-subview="(?:accelerate|skills)"[\s\S]{0,180}<MacOnlyParityScreen/,
  );
});

test("Acceleration preserves the Desktop decision hierarchy without inventing private plays", () => {
  for (const phrase of [
    "Acceleration",
    "est. saved / week",
    "Generate Skills",
    "Realized savings",
    "Acceleration plays",
    "Get Weekform for Mac",
  ]) {
    assert.match(accelerationSource, new RegExp(phrase));
  }
  assert.match(accelerationSource, /role=\{presentation\.state === "error" \? "alert" : "status"\}/);
  assert.match(accelerationSource, /review-safe|private evidence/i);
});

test("Skills mirrors the Desktop empty-library hierarchy and routes back to Accelerate", () => {
  for (const phrase of [
    "Skills library",
    "No saved skills",
    "Your skills library is empty",
    "Browse acceleration plays",
    "Get Weekform for Mac",
  ]) {
    assert.match(skillsSource, new RegExp(phrase));
  }
  assert.match(skillsSource, /weekform:web-navigate/);
  assert.match(skillsSource, /destination:\s*["']agent["']/);
  assert.match(skillsSource, /subview:\s*["']accelerate["']/);
});

test("Agent tools keep omitted evidence and browser storage outside the Web boundary", () => {
  const source = accelerationSource + skillsSource;
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|createClient|supabase/i);
  assert.match(source, /does not (?:receive|upload)|not (?:uploaded|available)/i);
  assert.match(source, /no workload cache|does not cache/i);
});
