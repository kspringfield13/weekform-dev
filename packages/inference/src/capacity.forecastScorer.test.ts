// Cross-check pinning the desktop forecast scorer to the SAME fixture outputs
// as its web mirror (apps/web/lib/forecast.ts#scoreForecastAccuracyMirror).
// The web workspace cannot import this package (different compiler settings),
// so the mirror re-implements the rules and BOTH implementations are pinned to
// this literal table — the same values live in apps/web/lib/forecast.test.ts
// (field names differ snake/camel; values must not). Update both files
// together or not at all.
// Run: npx tsx --test packages/inference/src/capacity.forecastScorer.test.ts
// (root: npm run test:cloud)

import test from "node:test";
import assert from "node:assert/strict";

import { scoreForecastAccuracy } from "./capacity";

const SCORER_CROSS_CHECK_FIXTURE = [
  { predicted: 42.4, actual: 40, predicted_pct: 42, actual_pct: 40, error_pts: 2, signed_error_pts: 2, rating: "on_target" },
  { predicted: 30, actual: 42.6, predicted_pct: 30, actual_pct: 43, error_pts: 13, signed_error_pts: -13, rating: "off" },
  { predicted: 55, actual: 43, predicted_pct: 55, actual_pct: 43, error_pts: 12, signed_error_pts: 12, rating: "close" },
  { predicted: 40.5, actual: 35.4, predicted_pct: 41, actual_pct: 35, error_pts: 5, signed_error_pts: 5, rating: "on_target" },
  { predicted: 20, actual: 20, predicted_pct: 20, actual_pct: 20, error_pts: 0, signed_error_pts: 0, rating: "on_target" },
  { predicted: 0, actual: 6, predicted_pct: 0, actual_pct: 6, error_pts: 6, signed_error_pts: -6, rating: "close" },
] as const;

test("scoreForecastAccuracy matches the web-mirror cross-check fixture outputs exactly", () => {
  for (const row of SCORER_CROSS_CHECK_FIXTURE) {
    assert.deepEqual(
      scoreForecastAccuracy(row.predicted, row.actual),
      {
        predicted_pct: row.predicted_pct,
        actual_pct: row.actual_pct,
        error_pts: row.error_pts,
        signed_error_pts: row.signed_error_pts,
        rating: row.rating,
      },
      `fixture predicted=${row.predicted} actual=${row.actual}`,
    );
  }
});
