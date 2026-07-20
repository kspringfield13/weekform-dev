import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/PersonalForecastScreen.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("Web Forecast follows the Desktop header, Agent panel, and trajectory sequence", () => {
  assert.match(
    source,
    /className="web-desktop-screen screen forecast-screen personal-forecast-screen"/,
  );
  assert.match(source, /className="screen-header"/);
  assert.match(source, /className="eyebrow">Weekly forecast/);
  assert.match(source, /className="screen-intro"/);
  assert.match(
    source,
    /screen-header[\s\S]*capacity-section forecast-panel[\s\S]*PersonalForecastTrajectory/,
  );
});

test("Web Forecast uses the Desktop result hierarchy without inventing an AI estimate", () => {
  for (const contract of [
    /Forecast Agent/,
    /className="section-title"/,
    /className="forecast-result"/,
    /className="forecast-summary"/,
    /className="forecast-grid"/,
    /Conservative/,
    /Likely/,
    /Optimistic/,
    /Risk flags/,
    /Assumptions/,
  ]) {
    assert.match(source, contract);
  }

  assert.doesNotMatch(source, /AI reliable estimate/);
  assert.doesNotMatch(source, /Predicted\s*<strong/);
  assert.doesNotMatch(source, /personal-forecast-scenarios/);
});

test("Web Forecast keeps local capabilities explicit and the header free of a persistent Mac CTA", () => {
  const header = source.match(/<header className="screen-header">([\s\S]*?)<\/header>/)?.[1] ?? "";
  assert.doesNotMatch(header, /Get Weekform for Mac/);
  assert.match(source, /AI forecast generation stays on your Mac/);
  assert.match(source, /Not included in the review-safe replica/);
  assert.match(source, /href="\/download"/);
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|supabase/i);
});

test("Web Forecast scopes Desktop density and responsive geometry to the Individual route", () => {
  assert.match(
    styles,
    /\.personal-forecast-screen\.forecast-screen\s*\{[^}]*overflow-y:\s*auto;/s,
  );
  assert.match(
    styles,
    /\.personal-forecast-screen \.screen-header\s*\{[^}]*margin-bottom:\s*12px;/s,
  );
  assert.match(
    styles,
    /\.personal-forecast-screen \.capacity-section\s*\{[^}]*padding:\s*12px 14px;[^}]*margin-bottom:\s*10px;/s,
  );
  assert.match(
    styles,
    /\.personal-forecast-screen \.forecast-summary\s*\{[^}]*repeat\(auto-fit, minmax\(min\(170px, 100%\), 1fr\)\);[^}]*gap:\s*10px;/s,
  );
  assert.match(
    styles,
    /\.personal-forecast-screen \.forecast-summary > div\s*\{[^}]*padding:\s*12px;/s,
  );
  assert.match(
    styles,
    /\.personal-forecast-screen \.forecast-summary strong\s*\{[^}]*font-size:\s*28px;/s,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*760px\)[\s\S]*\.personal-forecast-screen \.forecast-grid\s*\{[^}]*grid-template-columns:\s*1fr;/s,
  );
});
