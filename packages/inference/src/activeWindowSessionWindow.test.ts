import assert from "node:assert/strict";
import test from "node:test";

import type { ActivitySession } from "../../domain/src/models";
import { mergeActivitySessionWindows } from "./sessionizer/activeWindow";

function session(overrides: Partial<ActivitySession>): ActivitySession {
  return {
    session_id: "session-default",
    start_time: "2026-07-20T13:00:00.000Z",
    end_time: "2026-07-20T13:01:00.000Z",
    app_name: "Code",
    window_title: "Weekform",
    duration_minutes: 1,
    sample_count: 12,
    evidence: [],
    ...overrides,
  };
}

test("native history and post-cutoff samples merge across one session boundary", () => {
  const historical = session({
    session_id: "session-historical",
    start_time: "2026-07-20T13:00:00.000Z",
    end_time: "2026-07-20T13:01:00.000Z",
    sample_count: 13,
  });
  const live = session({
    session_id: "session-live",
    start_time: "2026-07-20T13:01:05.000Z",
    end_time: "2026-07-20T13:02:00.000Z",
    sample_count: 12,
  });

  const merged = mergeActivitySessionWindows([historical], [live]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].session_id, "session-historical");
  assert.equal(merged[0].start_time, historical.start_time);
  assert.equal(merged[0].end_time, live.end_time);
  assert.equal(merged[0].sample_count, 25);
  assert.equal(merged[0].duration_minutes, 2);
  assert.match(merged[0].evidence.at(-1) ?? "", /25 active-window samples/);
});

test("different contexts and gaps over 90 seconds remain distinct newest-first", () => {
  const historical = session({ session_id: "old" });
  const differentApp = session({
    session_id: "new-app",
    start_time: "2026-07-20T13:01:05.000Z",
    end_time: "2026-07-20T13:02:00.000Z",
    app_name: "Browser",
  });
  const later = session({
    session_id: "later",
    start_time: "2026-07-20T13:04:00.000Z",
    end_time: "2026-07-20T13:05:00.000Z",
  });

  const merged = mergeActivitySessionWindows([historical], [differentApp, later]);
  assert.deepEqual(merged.map((entry) => entry.session_id), ["later", "new-app", "old"]);
});
