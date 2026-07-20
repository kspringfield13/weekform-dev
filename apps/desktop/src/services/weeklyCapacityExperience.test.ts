import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TimeSpentDonut } from "../components/capacity/WeeklyCapacityScreen";

const capacityScreenSource = readFileSync(
  new URL("../components/capacity/WeeklyCapacityScreen.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const tauriConfig = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as { app: { windows: Array<{ minWidth?: number; minHeight?: number }> } };

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.ok(startIndex >= 0, `Expected source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Expected source marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("work-mode chart exposes one read-only data list without duplicate keyboard stops", () => {
  const donutSource = sourceBetween(
    capacityScreenSource,
    "function TimeSpentDonut",
    "export function WeeklyCapacityScreen",
  );

  assert.match(donutSource, /<svg[\s\S]*?aria-hidden="true"[\s\S]*?focusable="false"/);
  assert.doesNotMatch(donutSource, /role="img"|tabIndex=\{0\}|<button/);
  assert.match(
    donutSource,
    /<ul className="week-dashboard-time-legend" aria-label="Tracked time by work mode">/,
  );
  assert.match(donutSource, /className="sr-only">\{MODE_DESCRIPTIONS\[item\.label\]\}/);

  const markup = renderToStaticMarkup(createElement(TimeSpentDonut, {
    items: [
      { label: "Deep work", value: 35 },
      { label: "Reactive", value: 15 },
    ],
  }));

  assert.match(markup, /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
  assert.match(markup, /<ul class="week-dashboard-time-legend" aria-label="Tracked time by work mode">/);
  assert.equal(markup.match(/<li>/g)?.length, 2);
  assert.match(markup, /Longer focus blocks with fewer interruptions\./);
  assert.match(markup, /Unplanned support and requests handled as they arrived\./);
  assert.doesNotMatch(markup, /<button|tabindex=|role="img"|role="group"/);
});

test("browser demo reflows the full desktop shell before the native minimum width", () => {
  const narrowShellSource = sourceBetween(
    stylesSource,
    "/* Browser demo narrow-shell contract",
    "/* End browser demo narrow-shell contract */",
  );

  assert.match(narrowShellSource, /@media \(max-width: 1023px\)/);
  assert.match(narrowShellSource, /html\[data-runtime="web"\]/);
  assert.match(
    narrowShellSource,
    /\.app:not\(\.is-compact-widget\)[\s\S]*?\.app\.sidebar-collapsed:not\(\.is-compact-widget\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.match(
    narrowShellSource,
    /\.app:not\(\.is-compact-widget\)\s*>\s*\.main-panel[\s\S]*?\.app\.sidebar-collapsed:not\(\.is-compact-widget\)\s*>\s*\.main-panel[\s\S]*?grid-column:\s*1/,
  );
  assert.match(
    narrowShellSource,
    /\.app:not\(\.is-compact-widget\) \.sidebar-intelligence[\s\S]*?display:\s*none/,
  );
  assert.match(narrowShellSource, /grid-template-columns:\s*repeat\(5, minmax\(96px, 1fr\)\)/);
  assert.match(narrowShellSource, /\.nav-item\.nav-item-settings[\s\S]*?display:\s*grid/);
  assert.doesNotMatch(narrowShellSource, /\.is-compact-widget\s*\{/);

  assert.equal(tauriConfig.app.windows[0]?.minWidth, 1024);
  assert.equal(tauriConfig.app.windows[0]?.minHeight, 720);
});

test("commitment and category readouts do not imitate interactive controls", () => {
  const coverageSource = sourceBetween(
    capacityScreenSource,
    'className="week-dashboard-coverage-visual"',
    '<p className="week-dashboard-coverage-note">',
  );
  const categorySource = sourceBetween(
    capacityScreenSource,
    '<ul className="week-dashboard-category-list"',
    '</ul>\n          </div>',
  );

  assert.match(coverageSource, /role="img"/);
  assert.doesNotMatch(coverageSource, /tabIndex=|onFocus=|onKeyDown=|WeekVisualTooltip/);
  assert.doesNotMatch(categorySource, /role="img"|tabIndex=|onFocus=|onKeyDown=|WeekVisualTooltip/);
  assert.doesNotMatch(capacityScreenSource, /tabIndex=\{0\}/);
});

test("capacity dashboard removes decorative motion when reduced motion is requested", () => {
  const reducedMotionSource = sourceBetween(
    stylesSource,
    "/* Capacity reduced-motion contract",
    "/* End capacity reduced-motion contract */",
  );

  assert.match(reducedMotionSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(reducedMotionSource, /animation:\s*none\s*!important/);
  assert.match(reducedMotionSource, /transition-duration:\s*0\.01ms\s*!important/);
});

test("estimate explainer uses an accessible visual hierarchy instead of repeated prose", () => {
  const explainerSource = sourceBetween(
    capacityScreenSource,
    '<details className="week-dashboard-explainability">',
    "</details>",
  );

  assert.match(explainerSource, /className="week-dashboard-commitment-visual"/);
  assert.match(explainerSource, /role="img"/);
  assert.match(explainerSource, /aria-label=\{committedCompositionLabel\}/);
  assert.match(explainerSource, /className="week-dashboard-detail-group week-dashboard-risk-group"/);
  assert.match(explainerSource, /className="week-dashboard-interruption-insights"/);
  assert.doesNotMatch(explainerSource, /Reactive work counts at/);
});

test("estimate explainer gives delivery-risk signals more room and aligned rows", () => {
  const explainerStyles = sourceBetween(
    stylesSource,
    ".week-dashboard-explainability {",
    "/* Capacity reduced-motion contract",
  );

  assert.match(
    explainerStyles,
    /\.week-dashboard-detail-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 0\.9fr\) minmax\(0, 1\.1fr\)/,
  );
  assert.match(
    explainerStyles,
    /\.week-dashboard-risk-group \.risk-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(124px, 0\.9fr\) minmax\(96px, 1\.1fr\) 48px/,
  );
  assert.match(explainerStyles, /\.week-dashboard-risk-group \.risk-caption/);
});
