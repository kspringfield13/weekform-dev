// Tests for the per-team share policy helpers (A6).
// Run: npm run test:web   (tsx --test)

import test from "node:test";
import assert from "node:assert/strict";

import {
  TEAM_POLICY_METRIC_KEYS,
  TEAM_SHARE_LEVELS,
  buildTeamSharePolicyRecord,
  describeTeamSharePolicy,
  parseTeamSharePolicy,
} from "./teamPolicy";

// ---------------------------------------------------------------------------
// parseTeamSharePolicy: defensive, narrowing-biased
// ---------------------------------------------------------------------------

test("absent or garbage stored values mean NO policy (null), never an invented one", () => {
  for (const absent of [null, undefined, 0, "cap", [], true]) {
    assert.equal(parseTeamSharePolicy(absent), null);
  }
});

test("a valid v1 policy round-trips; missing acceptedMetrics means accept-all (null)", () => {
  assert.deepEqual(parseTeamSharePolicy({ version: 1, maxShareLevel: "categories" }), {
    version: 1,
    maxShareLevel: "categories",
    acceptedMetrics: null,
  });
});

test("unknown version or malformed level degrades to the NARROWEST level, never the widest", () => {
  assert.equal(
    parseTeamSharePolicy({ version: 7, maxShareLevel: "projects" })?.maxShareLevel,
    "summary",
  );
  assert.equal(
    parseTeamSharePolicy({ maxShareLevel: "projects" })?.maxShareLevel,
    "summary",
  );
  assert.equal(
    parseTeamSharePolicy({ version: 1, maxShareLevel: "everything" })?.maxShareLevel,
    "summary",
  );
});

test("malformed acceptedMetrics flags degrade to false (rejected), never true", () => {
  const parsed = parseTeamSharePolicy({
    version: 1,
    maxShareLevel: "projects",
    acceptedMetrics: { reliableCapacity: true, allocated: "yes", meetings: 1 },
  });
  assert.ok(parsed?.acceptedMetrics);
  assert.equal(parsed.acceptedMetrics.reliableCapacity, true);
  assert.equal(parsed.acceptedMetrics.allocated, false);
  assert.equal(parsed.acceptedMetrics.meetings, false);
  // Present-but-uninterpretable: reject every metric rather than accept all.
  const garbage = parseTeamSharePolicy({
    version: 1,
    maxShareLevel: "projects",
    acceptedMetrics: "all",
  });
  for (const key of TEAM_POLICY_METRIC_KEYS) {
    assert.equal(garbage?.acceptedMetrics?.[key], false);
  }
});

test("prototype-pollution-style keys are ignored and do not pollute", () => {
  const hostile = JSON.parse(
    '{"version":1,"maxShareLevel":"summary","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
  );
  const parsed = parseTeamSharePolicy(hostile);
  assert.deepEqual(parsed, { version: 1, maxShareLevel: "summary", acceptedMetrics: null });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.ok(!JSON.stringify(parsed).includes("polluted"));
});

test("parsing is deterministic", () => {
  const raw = { version: 1, maxShareLevel: "categories", acceptedMetrics: { meetings: true } };
  assert.deepEqual(parseTeamSharePolicy(raw), parseTeamSharePolicy(raw));
});

// ---------------------------------------------------------------------------
// buildTeamSharePolicyRecord: form input → exact stored record
// ---------------------------------------------------------------------------

test("only the three existing levels build a record; anything else is refused", () => {
  for (const level of TEAM_SHARE_LEVELS) {
    assert.deepEqual(buildTeamSharePolicyRecord(level), {
      version: 1,
      maxShareLevel: level,
      acceptedMetrics: null,
    });
  }
  for (const bad of ["everything", "metrics_only", "", "SUMMARY", "projects; drop table"]) {
    assert.equal(buildTeamSharePolicyRecord(bad), null);
  }
  // Whitespace is trimmed, not accepted as a different level.
  assert.equal(buildTeamSharePolicyRecord("  categories  ")?.maxShareLevel, "categories");
});

test("a stored record parses back to itself (write → read round trip)", () => {
  const record = buildTeamSharePolicyRecord("categories");
  assert.ok(record);
  assert.deepEqual(parseTeamSharePolicy(JSON.parse(JSON.stringify(record))), record);
});

// ---------------------------------------------------------------------------
// describeTeamSharePolicy: honest copy
// ---------------------------------------------------------------------------

test("descriptions state the no-policy case and the narrowing-only semantics", () => {
  assert.match(describeTeamSharePolicy(null), /No team share policy is set/);
  const capped = describeTeamSharePolicy({
    version: 1,
    maxShareLevel: "summary",
    acceptedMetrics: null,
  });
  assert.match(capped, /Summary metrics only/);
  assert.match(capped, /member consents to/);
  const partial = describeTeamSharePolicy(
    parseTeamSharePolicy({
      version: 1,
      maxShareLevel: "projects",
      acceptedMetrics: { reliableCapacity: true, meetings: true },
    }),
  );
  assert.match(partial, /2 of 10 metrics accepted/);
  assert.match(partial, /unconsented metrics stay unshared/);
});
