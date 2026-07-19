// Focused tests for the pure week-over-week trend module (no Supabase, no
// network, no wall clock). Run: npx tsx --test apps/web/lib/trends.test.ts
// (root: npm run test:web)

import test from "node:test";
import assert from "node:assert/strict";

import type { LatestSnapshot } from "./snapshots";
import {
  TREND_BASELINE_LABEL,
  TREND_METRIC_KEYS,
  driftWording,
  summarizeTeamTrend,
} from "./trends";

const NOW = "2026-07-19T12:00:00.000Z";

function hoursBefore(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 60 * 60 * 1000).toISOString();
}

/** Current-week snapshot, observed 2h ago (fresh) unless overridden. */
function snapshot(
  overrides: Partial<LatestSnapshot> & { userId: string },
): LatestSnapshot {
  return {
    teamId: "team-1",
    weekId: "2026-W29",
    observedAt: hoursBefore(2),
    sourceUpdatedAt: hoursBefore(3),
    shareLevel: "summary",
    reliableCapacityPct: null,
    reactivePct: null,
    meetingPct: null,
    fragmentedPct: null,
    summaryConfidence: null,
    reviewedBlocks: 0,
    eligibleBlocks: 0,
    ...overrides,
  };
}

/** Prior-week snapshot, observed 9 days ago (stale by the workload rule —
 * deliberately, to prove history is exempt from anchor-side staleness). */
function priorSnapshot(
  overrides: Partial<LatestSnapshot> & { userId: string },
): LatestSnapshot {
  return snapshot({
    weekId: "2026-W28",
    observedAt: hoursBefore(9 * 24),
    ...overrides,
  });
}

test("empty input: no-history verdict, nothing fabricated", () => {
  const result = summarizeTeamTrend([], NOW);
  assert.equal(result.verdict, "no-history");
  assert.equal(result.currentWeekId, null);
  assert.equal(result.priorWeekId, null);
  assert.deepEqual(result.members, []);
  for (const key of TREND_METRIC_KEYS) {
    assert.equal(result.medianDrift[key].value, null);
    assert.equal(result.medianDrift[key].comparedCount, 0);
  }
  assert.equal(result.baselineLabel, TREND_BASELINE_LABEL);
});

test("a single week of data: no-history, no drift invented from one week", () => {
  const result = summarizeTeamTrend(
    [
      snapshot({ userId: "a", meetingPct: 30 }),
      snapshot({ userId: "b", meetingPct: 40 }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "no-history");
  assert.equal(result.currentWeekId, "2026-W29");
  assert.equal(result.priorWeekId, null);
  for (const key of TREND_METRIC_KEYS) {
    assert.equal(result.medianDrift[key].value, null);
  }
  assert.ok(result.explanation.includes("Only one week"));
});

test("two weeks: per-member deltas and team median drift computed from shared metrics", () => {
  const result = summarizeTeamTrend(
    [
      snapshot({ userId: "a", meetingPct: 34, reactivePct: 20 }),
      snapshot({ userId: "b", meetingPct: 40, reactivePct: 50 }),
      priorSnapshot({ userId: "a", meetingPct: 30, reactivePct: 25 }),
      priorSnapshot({ userId: "b", meetingPct: 36, reactivePct: 40 }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "computed");
  assert.equal(result.currentWeekId, "2026-W29");
  assert.equal(result.priorWeekId, "2026-W28");
  const a = result.members[0];
  assert.ok(a);
  assert.equal(a.userId, "a");
  assert.deepEqual(a.deltas.meetingPct, { value: 4, reason: null });
  assert.deepEqual(a.deltas.reactivePct, { value: -5, reason: null });
  // Median of [+4, +4] and [-5, +10]; medians, never sums.
  assert.equal(result.medianDrift.meetingPct.value, 4);
  assert.equal(result.medianDrift.meetingPct.comparedCount, 2);
  assert.equal(result.medianDrift.reactivePct.value, 2.5);
});

test("missing prior week for a member: status no-history, never a zero delta", () => {
  const result = summarizeTeamTrend(
    [
      snapshot({ userId: "a", meetingPct: 34 }),
      snapshot({ userId: "b", meetingPct: 50 }), // no prior-week row
      priorSnapshot({ userId: "a", meetingPct: 30 }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "computed");
  const b = result.members.find((member) => member.userId === "b");
  assert.ok(b);
  assert.equal(b.status, "no-history");
  for (const key of TREND_METRIC_KEYS) {
    assert.deepEqual(b.deltas[key], { value: null, reason: "no-history" });
  }
  assert.equal(result.noHistoryCount, 1);
  // b's missing history does not contribute a fake 0 to the median.
  assert.equal(result.medianDrift.meetingPct.value, 4);
  assert.equal(result.medianDrift.meetingPct.comparedCount, 1);
});

test("metric null in either week: delta null with reason not-shared, never coerced to 0", () => {
  const result = summarizeTeamTrend(
    [
      // Shares meetings now but not before; shared reactive before but not now.
      snapshot({ userId: "a", meetingPct: 34, reactivePct: null }),
      snapshot({ userId: "b", meetingPct: 40, reactivePct: 10 }),
      priorSnapshot({ userId: "a", meetingPct: null, reactivePct: 25 }),
      priorSnapshot({ userId: "b", meetingPct: 36, reactivePct: 20 }),
    ],
    NOW,
  );
  const a = result.members.find((member) => member.userId === "a");
  assert.ok(a);
  assert.equal(a.status, "compared");
  assert.deepEqual(a.deltas.meetingPct, { value: null, reason: "not-shared" });
  assert.deepEqual(a.deltas.reactivePct, { value: null, reason: "not-shared" });
  // a contributes to no median for those metrics — b alone does.
  assert.equal(result.medianDrift.meetingPct.comparedCount, 1);
  assert.equal(result.medianDrift.meetingPct.value, 4);
  assert.equal(result.medianDrift.reactivePct.comparedCount, 1);
  assert.equal(result.medianDrift.reactivePct.value, -10);
});

test("share-level change: deltas flagged and member excluded from every median", () => {
  const result = summarizeTeamTrend(
    [
      snapshot({ userId: "a", shareLevel: "detailed", meetingPct: 60 }),
      snapshot({ userId: "b", meetingPct: 40 }),
      priorSnapshot({ userId: "a", shareLevel: "summary", meetingPct: 30 }),
      priorSnapshot({ userId: "b", meetingPct: 36 }),
    ],
    NOW,
  );
  const a = result.members.find((member) => member.userId === "a");
  assert.ok(a);
  assert.equal(a.shareLevelChanged, true);
  // The delta is still shown (labeled), but the pair is non-comparable...
  assert.deepEqual(a.deltas.meetingPct, { value: 30, reason: null });
  // ...so a's +30 never reaches the team median (exclusion, the stricter choice).
  assert.equal(result.medianDrift.meetingPct.value, 4);
  assert.equal(result.medianDrift.meetingPct.comparedCount, 1);
  assert.equal(result.shareLevelChangedCount, 1);
});

test("stale current-week snapshot: member excluded and counted, never silently included", () => {
  const result = summarizeTeamTrend(
    [
      // Two members synced W29 early; only a kept syncing. b's W29 row is now
      // stale by the workload.ts rule (> 7 days) and must not read as current.
      snapshot({ userId: "a", meetingPct: 34 }),
      snapshot({ userId: "b", meetingPct: 90, observedAt: hoursBefore(8 * 24) }),
      priorSnapshot({ userId: "a", meetingPct: 30 }),
      priorSnapshot({ userId: "b", meetingPct: 10 }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "computed");
  assert.equal(result.excludedStaleCount, 1);
  assert.equal(
    result.members.find((member) => member.userId === "b"),
    undefined,
  );
  assert.equal(result.medianDrift.meetingPct.value, 4);
  assert.equal(result.medianDrift.meetingPct.comparedCount, 1);
});

test("unreadable timestamps count as stale-excluded, not current", () => {
  const result = summarizeTeamTrend(
    [
      snapshot({ userId: "a", meetingPct: 34 }),
      snapshot({ userId: "b", meetingPct: 90, observedAt: "not-a-date" }),
      priorSnapshot({ userId: "a", meetingPct: 30 }),
    ],
    NOW,
  );
  assert.equal(result.excludedStaleCount, 1);
  assert.equal(result.members.length, 1);
});

test("everything stale: no-history, with the exclusions counted, not hidden", () => {
  const result = summarizeTeamTrend(
    [
      snapshot({ userId: "a", meetingPct: 34, observedAt: hoursBefore(10 * 24) }),
      priorSnapshot({ userId: "a", meetingPct: 30, observedAt: hoursBefore(17 * 24) }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "no-history");
  assert.equal(result.excludedStaleCount, 2);
  assert.ok(result.explanation.includes("stale"));
});

test("prior week may be stale-aged: history is the baseline, not a current claim", () => {
  // priorSnapshot() is observed 9 days ago — stale under the anchor rule —
  // and must still serve as the team's own baseline.
  const result = summarizeTeamTrend(
    [
      snapshot({ userId: "a", meetingPct: 34 }),
      snapshot({ userId: "b", meetingPct: 44 }),
      priorSnapshot({ userId: "a", meetingPct: 30 }),
      priorSnapshot({ userId: "b", meetingPct: 36 }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "computed");
  assert.equal(result.priorWeekId, "2026-W28");
  assert.equal(result.medianDrift.meetingPct.comparedCount, 2);
});

test("weeks with only unshared rows cannot serve as the baseline", () => {
  const result = summarizeTeamTrend(
    [
      snapshot({ userId: "a", meetingPct: 34 }),
      // W28 exists but shares nothing — comparing against it would fabricate
      // deltas from nulls.
      priorSnapshot({ userId: "a", meetingPct: null }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "no-history");
  assert.equal(result.distinctWeekCount, 2);
});

test("baseline skips an empty week to the team's most recent shared week", () => {
  const result = summarizeTeamTrend(
    [
      snapshot({ userId: "a", meetingPct: 34 }),
      priorSnapshot({ userId: "a", meetingPct: null }), // W28: nothing shared
      priorSnapshot({
        userId: "a",
        weekId: "2026-W27",
        observedAt: hoursBefore(16 * 24),
        meetingPct: 20,
      }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "computed");
  assert.equal(result.priorWeekId, "2026-W27");
  assert.equal(result.medianDrift.meetingPct.value, 14);
});

test("duplicate rows per member-week: the newest observation wins deterministically", () => {
  const result = summarizeTeamTrend(
    [
      snapshot({ userId: "a", meetingPct: 50, observedAt: hoursBefore(20) }),
      snapshot({ userId: "a", meetingPct: 34, observedAt: hoursBefore(2) }),
      priorSnapshot({ userId: "a", meetingPct: 30 }),
    ],
    NOW,
  );
  const a = result.members[0];
  assert.ok(a);
  assert.deepEqual(a.deltas.meetingPct, { value: 4, reason: null });
});

test("determinism: same input gives deepEqual output; ordering is by userId, not delta size", () => {
  const input = [
    snapshot({ userId: "c", meetingPct: 90 }), // biggest delta, still last
    snapshot({ userId: "a", meetingPct: 31 }),
    snapshot({ userId: "b", meetingPct: 45 }),
    priorSnapshot({ userId: "c", meetingPct: 10 }),
    priorSnapshot({ userId: "a", meetingPct: 30 }),
    priorSnapshot({ userId: "b", meetingPct: 40 }),
  ];
  const first = summarizeTeamTrend(input, NOW);
  const second = summarizeTeamTrend([...input], NOW);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.members.map((member) => member.userId),
    ["a", "b", "c"],
  );
});

test("the self-baseline label is always present, in both verdicts", () => {
  const empty = summarizeTeamTrend([], NOW);
  assert.equal(empty.baselineLabel, TREND_BASELINE_LABEL);
  const computed = summarizeTeamTrend(
    [
      snapshot({ userId: "a", meetingPct: 34 }),
      priorSnapshot({ userId: "a", meetingPct: 30 }),
    ],
    NOW,
  );
  assert.equal(computed.baselineLabel, TREND_BASELINE_LABEL);
  assert.ok(computed.explanation.includes(TREND_BASELINE_LABEL));
});

test("driftWording names direction and magnitude deterministically", () => {
  assert.equal(
    driftWording("meetingPct", 4),
    "median meeting load up 4 pts vs last week",
  );
  assert.equal(
    driftWording("reliableCapacityPct", -6.4),
    "median reliable capacity down 6 pts vs last week",
  );
  assert.equal(
    driftWording("reactivePct", 0.2),
    "median reactive load unchanged vs last week",
  );
  assert.equal(
    driftWording("fragmentedPct", -1),
    "median fragmented work down 1 pt vs last week",
  );
});
