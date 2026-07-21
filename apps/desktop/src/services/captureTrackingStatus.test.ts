import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_CONFIRMATION_MAX_AGE_MS,
  isCaptureTrackingConfirmed,
} from "./captureTrackingStatus";

const NOW = Date.parse("2026-07-21T17:45:00.000Z");

test("tracking is confirmed only by a fresh successful native capture", () => {
  assert.equal(isCaptureTrackingConfirmed({
    trackingEnabled: true,
    captureError: null,
    lastSuccessfulCaptureAtMs: NOW - CAPTURE_CONFIRMATION_MAX_AGE_MS,
    nowMs: NOW,
  }), true);
});

test("enabled, errored, missing, and stale collectors never report confirmed tracking", () => {
  assert.equal(isCaptureTrackingConfirmed({
    trackingEnabled: false,
    captureError: null,
    lastSuccessfulCaptureAtMs: NOW - 1_000,
    nowMs: NOW,
  }), false);
  assert.equal(isCaptureTrackingConfirmed({
    trackingEnabled: true,
    captureError: "Screen Recording permission is unavailable",
    lastSuccessfulCaptureAtMs: NOW - 1_000,
    nowMs: NOW,
  }), false);
  assert.equal(isCaptureTrackingConfirmed({
    trackingEnabled: true,
    captureError: null,
    lastSuccessfulCaptureAtMs: null,
    nowMs: NOW,
  }), false);
  assert.equal(isCaptureTrackingConfirmed({
    trackingEnabled: true,
    captureError: null,
    lastSuccessfulCaptureAtMs: NOW - CAPTURE_CONFIRMATION_MAX_AGE_MS - 1,
    nowMs: NOW,
  }), false);
});
