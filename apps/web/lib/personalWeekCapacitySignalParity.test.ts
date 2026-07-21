import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const overviewSource = readFileSync(
  new URL("../components/PersonalWeekOverview.tsx", import.meta.url),
  "utf8",
);
const graphicUrl = new URL(
  "../components/capacity/CapacitySignalGraphic.tsx",
  import.meta.url,
);
const sceneUrl = new URL(
  "../components/capacity/capacitySignalScene.ts",
  import.meta.url,
);
const graphicSource = existsSync(graphicUrl) ? readFileSync(graphicUrl, "utf8") : "";
const sceneSource = existsSync(sceneUrl) ? readFileSync(sceneUrl, "utf8") : "";
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("the Web Week hero renders the capacity-linked signal in the Desktop position", () => {
  assert.match(overviewSource, /import\s*\{\s*CapacitySignalGraphic\s*\}/);
  assert.match(
    overviewSource,
    /<CapacitySignalGraphic\s+available=\{available\}\s+committed=\{displayCapacity\.committedUtilizationPct\}\s*\/>/,
  );
  assert.doesNotMatch(overviewSource, /className="personal-week-signal"/);
});

test("the Web signal retains the Desktop progressive-rendering contract", () => {
  assert.match(graphicSource, /import\("\.\/capacitySignalScene"\)/);
  assert.match(graphicSource, /className="capacity-signal-fallback"/);
  assert.match(graphicSource, /className="capacity-signal-canvas"/);
  assert.match(graphicSource, /data-renderer=\{status\}/);
  assert.match(graphicSource, /matchMedia\("\(min-width: 971px\)"\)/);
  assert.match(graphicSource, /sceneRef\.current\?\.setMetrics\(\{ available, committed \}\)/);
});

test("the WebGL scene keeps capacity semantics and conservative lifecycle controls", () => {
  assert.match(sceneSource, /WebGLRenderer/);
  assert.match(sceneSource, /powerPreference:\s*"low-power"/);
  assert.match(sceneSource, /availableEnd\s*=\s*Math\.min\(1, committedEnd \+ clampPct\(metrics\.available\) \/ 100\)/);
  assert.match(sceneSource, /new ResizeObserver\(resize\)/);
  assert.match(sceneSource, /new IntersectionObserver/);
  assert.match(sceneSource, /prefers-reduced-motion:\s*reduce/);
  assert.match(sceneSource, /webglcontextlost/);
  assert.match(sceneSource, /renderer\.forceContextLoss\(\)/);
});

test("the Web signal swaps fallback and canvas without disturbing compact layouts", () => {
  assert.match(stylesSource, /\.capacity-signal-graphic\s*\{[^}]*height:\s*154px\s*;/s);
  assert.match(stylesSource, /\.capacity-signal-graphic\.is-ready\s+\.capacity-signal-canvas\s*\{[^}]*opacity:\s*1\s*;/s);
  assert.match(stylesSource, /@media\s*\(max-width:\s*970px\)[\s\S]*?\.capacity-signal-graphic\s*\{[^}]*display:\s*none\s*;/);
  assert.match(stylesSource, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.capacity-signal-canvas/);
});
