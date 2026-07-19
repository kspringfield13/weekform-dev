// Tests for the single-source cloud retention statement (roadmap A3).
// Run: npm run test:web   (tsx --test)

import test from "node:test";
import assert from "node:assert/strict";

import { CLOUD_RETENTION_WINDOW_DAYS, describeCloudRetention } from "./retention";

test("the configured policy is honestly null: no automatic expiry exists", () => {
  // Until a real server-side expiry job exists, this constant MUST stay null —
  // null is "no automatic deletion", never zero and never an invented window.
  assert.equal(CLOUD_RETENTION_WINDOW_DAYS, null);
});

test("null window derives the no-expiry statement with no fabricated number", () => {
  const statement = describeCloudRetention(null);
  assert.ok(statement.includes("no automatic expiry"));
  assert.ok(statement.includes("Delete my cloud history"));
  // Null is never rendered as a number of days.
  assert.ok(!/\d/.test(statement));
});

test("the default derivation uses the config constant (UI text sources the constant, not prose)", () => {
  assert.equal(describeCloudRetention(), describeCloudRetention(CLOUD_RETENTION_WINDOW_DAYS));
});

test("a positive integer window derives the exact day count, singular and plural", () => {
  assert.ok(describeCloudRetention(30).includes("30 days"));
  assert.ok(describeCloudRetention(1).includes("1 day "));
  assert.ok(!describeCloudRetention(30).includes("no automatic expiry"));
  assert.ok(describeCloudRetention(30).includes("Delete my cloud history"));
});

test("a malformed window throws instead of rounding into a plausible claim", () => {
  for (const bad of [0, -7, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => describeCloudRetention(bad), RangeError);
  }
});

test("deterministic: same window, same statement", () => {
  assert.equal(describeCloudRetention(null), describeCloudRetention(null));
  assert.equal(describeCloudRetention(14), describeCloudRetention(14));
});
