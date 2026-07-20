import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const trajectorySource = readFileSync(
  new URL("../components/PersonalForecastTrajectory.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("Web Forecast trajectory mirrors Desktop keyboard and pointer series isolation", () => {
  assert.match(trajectorySource, /^"use client";/m);
  assert.match(trajectorySource, /useState<string \| null>/);
  assert.match(trajectorySource, /tabIndex=\{0\}/);
  assert.match(trajectorySource, /onFocus=\{\(\) => setActiveSeries\(series\.key\)\}/);
  assert.match(trajectorySource, /onBlur=\{\(\) => setActiveSeries\(null\)\}/);
  assert.match(trajectorySource, /onMouseEnter=\{\(\) => setActiveSeries\(series\.key\)\}/);
  assert.match(trajectorySource, /onMouseLeave=\{\(\) => setActiveSeries\(null\)\}/);
  assert.match(trajectorySource, /activeSeries && activeSeries !== series\.key \? 0\.3 : 1/);
});

test("Web Forecast trajectory legend carries the Desktop current-value and window-delta context", () => {
  assert.match(trajectorySource, /series\.current/);
  assert.match(trajectorySource, /series\.delta/);
  assert.match(trajectorySource, /"point" : "points"/);
  assert.match(trajectorySource, /"higher" : "lower"/);
  assert.match(trajectorySource, /over the window/);
  assert.match(trajectorySource, /No change over the window/);
  assert.match(trajectorySource, /aria-label="Trajectory series"/);
});

test("Web Forecast trajectory exposes a visible keyboard focus contract with a defined theme token", () => {
  assert.match(globalStyles, /--focus-ring:\s*[^;]+;/);
  assert.match(globalStyles, /\.personal-forecast-trajectory-legend > span:focus-visible[^}]*var\(--focus-ring\)/s);
  assert.doesNotMatch(globalStyles, /var\(--focus\)/);
});

test("Web Forecast keeps its observed-baseline and no-accuracy boundary after extraction", () => {
  const screenSource = readFileSync(
    new URL("../components/PersonalForecastScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(screenSource, /<PersonalForecastTrajectory trajectory=\{forecast\.trajectory\}/);
  assert.match(trajectorySource, /Observed review-safe baselines · not forecast accuracy/);
  assert.match(trajectorySource, /cannot claim predicted-versus-actual accuracy/);
  assert.doesNotMatch(trajectorySource, /localStorage|sessionStorage|fetch\(|supabase/i);
});
