import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/PersonalForecastScreen.tsx", import.meta.url), "utf8");

test("Web Forecast preserves the desktop scenario and evidence hierarchy", () => {
  for (const label of ["Conservative", "Likely", "Optimistic", "Risk flags", "Planning guidance", "Assumptions"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /Weekly forecast/);
  assert.match(source, /Forecast basis/);
});

test("Web Forecast does not claim browser AI generation or add a write boundary", () => {
  assert.match(source, /Derived planning baseline/);
  assert.match(source, /Get Weekform for Mac/);
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|supabase/i);
});
