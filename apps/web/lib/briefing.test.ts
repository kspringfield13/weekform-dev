// Focused tests for the Team Briefing Agent helpers: input allowlist
// building, the deterministic fallback, prompt construction, schema
// validation of untrusted model output, and the fallback-mode orchestration
// in generateTeamBriefing. No live network/API calls are made — the model
// path is only ever exercised with an injected fetchImpl fixture.
// Run: npx tsx --test apps/web/lib/briefing.test.ts  (root: npm run test:web)

import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_DISCLOSURE,
  buildBriefingInput,
  buildBriefingPrompt,
  deterministicFallbackBriefing,
  generateTeamBriefing,
  getBriefingModelConfig,
  validateBriefingResult,
  type BriefingInput,
} from "./briefing";
import { summarizeTeamWorkload, type MemberWorkloadInput } from "./workload";

const NOW = "2026-07-19T12:00:00.000Z";

function hoursBefore(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 60 * 60 * 1000).toISOString();
}

function snapshot(
  overrides: Partial<MemberWorkloadInput> & { userId: string },
): MemberWorkloadInput {
  return {
    weekId: "2026-W29",
    observedAt: hoursBefore(2),
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

function buildInput(
  roster: Array<{ userId: string; displayName: string | null }>,
  snapshots: MemberWorkloadInput[],
): BriefingInput {
  const snapshotsByUser = new Map(
    snapshots.map((snap) => [snap.userId, { ...snap, freshnessLabelText: "Synced within the last day" }]),
  );
  const aggregates = summarizeTeamWorkload(roster.length, snapshots, NOW);
  return buildBriefingInput({
    teamName: "Northstar Analytics",
    nowIso: NOW,
    memberCount: roster.length,
    roster,
    snapshotsByUser,
    aggregates,
  });
}

test("buildBriefingInput never includes raw userId, only neutral refs and display names", () => {
  const input = buildInput(
    [
      { userId: "user-aaaaaaaa", displayName: "Alex Kim" },
      { userId: "user-bbbbbbbb", displayName: null },
    ],
    [
      snapshot({ userId: "user-aaaaaaaa", reliableCapacityPct: 40, reactivePct: 55 }),
      snapshot({ userId: "user-bbbbbbbb", reliableCapacityPct: 8 }),
    ],
  );

  assert.equal(input.members.length, 2);
  assert.equal(input.members[0]?.ref, "member:1");
  assert.equal(input.members[0]?.displayName, "Alex Kim");
  assert.equal(input.members[1]?.displayName, "Member 2");

  const serialized = JSON.stringify(input);
  assert.ok(!serialized.includes("user-aaaaaaaa"), "raw userId must never appear in briefing input");
  assert.ok(!serialized.includes("user-bbbbbbbb"), "raw userId must never appear in briefing input");
});

test("buildBriefingInput marks unshared metrics as absent, never zero", () => {
  const input = buildInput(
    [{ userId: "u1", displayName: "Sam" }],
    [snapshot({ userId: "u1", reliableCapacityPct: null, reactivePct: 20 })],
  );
  const member = input.members[0];
  assert.ok(member);
  assert.equal(member.reliableCapacityPct, null);
  assert.equal(member.reactivePct, 20);
  assert.match(input.evidenceCatalog["member:1"] ?? "", /did not share reliable capacity/);
});

test("buildBriefingInput records a member with no snapshot as not sharing, not as a risk", () => {
  const input = buildInput(
    [{ userId: "u1", displayName: "Sam" }, { userId: "u2", displayName: "Robin" }],
    [snapshot({ userId: "u1", reliableCapacityPct: 60 })],
  );
  const robin = input.members.find((m) => m.displayName === "Robin");
  assert.ok(robin);
  assert.equal(robin.shareLevel, "none");
  assert.deepEqual(robin.riskFlags, []);
});

test("buildBriefingInput surfaces deterministic risk flags per member with evidence entries", () => {
  const input = buildInput(
    [{ userId: "u1", displayName: "Sam" }],
    [snapshot({ userId: "u1", reliableCapacityPct: 5, reactivePct: 90 })],
  );
  const member = input.members[0];
  assert.ok(member);
  const flagIds = member.riskFlags.map((flag) => flag.id).sort();
  assert.deepEqual(flagIds, ["high-reactive", "low-headroom"]);
  assert.ok("member:1:risk:low-headroom" in input.evidenceCatalog);
  assert.ok("member:1:risk:high-reactive" in input.evidenceCatalog);
});

test("deterministicFallbackBriefing with no sharing members is honest about absence, not zero", () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], []);
  const result = deterministicFallbackBriefing(input);
  assert.match(result.headline, /No shared workload data/);
  assert.deepEqual(result.risks, []);
  assert.equal(
    result.sharedEvidenceCoverage,
    "Evidence comes from 0 of 1 teammates' approved snapshots.",
  );
});

test("deterministicFallbackBriefing groups repeated risk flags and cites evidence refs that exist in the catalog", () => {
  const input = buildInput(
    [
      { userId: "u1", displayName: "Sam" },
      { userId: "u2", displayName: "Robin" },
    ],
    [
      snapshot({ userId: "u1", reactivePct: 90 }),
      snapshot({ userId: "u2", reactivePct: 85 }),
    ],
  );
  const result = deterministicFallbackBriefing(input);
  const reactiveRisk = result.risks.find((risk) => risk.title === "High reactive load");
  assert.ok(reactiveRisk);
  assert.equal(reactiveRisk.evidenceRefs.length, 2);
  for (const ref of reactiveRisk.evidenceRefs) {
    assert.ok(ref in input.evidenceCatalog, `evidence ref ${ref} must exist in the catalog`);
  }
  const opportunity = result.coordinationOpportunities.find((o) => o.title === "Batch reactive work");
  assert.ok(opportunity, "high reactive load should suggest batching reactive work");
});

test("deterministicFallbackBriefing never emits ranking, scoring, HR, or medical language", () => {
  const input = buildInput(
    [
      { userId: "u1", displayName: "Sam" },
      { userId: "u2", displayName: "Robin" },
    ],
    [
      snapshot({ userId: "u1", reliableCapacityPct: 5, reactivePct: 90, meetingPct: 70, fragmentedPct: 60 }),
      snapshot({ userId: "u2", reliableCapacityPct: 4 }),
    ],
  );
  const result = deterministicFallbackBriefing(input);
  const text = JSON.stringify(result).toLowerCase();
  // Note: the fallback's own disclaimers legitimately say things like "not a
  // ... score" or "never ranks" (matching the dashboard's existing copy), so
  // this checks for the banned CONCEPTS appearing outside a negation.
  for (const banned of ["burnout", "discipline", "terminat", "diagnos", "fire "]) {
    assert.ok(!text.includes(banned), `fallback output must not contain "${banned}"`);
  }
  assert.ok(
    !/\branked\b|\branking\b/.test(text),
    "fallback output must not rank members against each other",
  );
});

test("deterministicFallbackBriefing always includes the required limitations", () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  const result = deterministicFallbackBriefing(input);
  assert.ok(result.limitations.length > 0);
  assert.ok(result.limitations.some((line) => line.includes("planning aid")));
});

test("buildBriefingPrompt only contains catalog facts, forbids raw evidence framing, and includes grounding rules", () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  const prompt = buildBriefingPrompt(input);
  assert.match(prompt.system, /Never rank/);
  assert.match(prompt.system, /burnout/i);
  assert.match(prompt.system, /evidenceRefs/);
  assert.ok(prompt.user.includes("member:1"));
  assert.ok(prompt.user.includes(input.teamName));
});

test("validateBriefingResult rejects non-object and missing-field payloads", () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  assert.equal(validateBriefingResult(null, input).ok, false);
  assert.equal(validateBriefingResult("not json", input).ok, false);
  assert.equal(validateBriefingResult({}, input).ok, false);
  assert.equal(
    validateBriefingResult(
      { headline: "H", summary: "S", sharedEvidenceCoverage: "C", risks: [], coordinationOpportunities: [], questionsForTheTeam: [], limitations: "not-an-array" },
      input,
    ).ok,
    false,
  );
});

test("validateBriefingResult strips evidenceRefs not present in the catalog instead of trusting them", () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 5 })]);
  const candidate = {
    headline: "Headline",
    summary: "Summary",
    sharedEvidenceCoverage: "Coverage",
    risks: [
      {
        title: "Low headroom",
        explanation: "Explained",
        evidenceRefs: ["member:1:risk:low-headroom", "member:99:invented-fact"],
      },
    ],
    coordinationOpportunities: [],
    questionsForTheTeam: ["Q1"],
    limitations: ["L1"],
  };
  const validated = validateBriefingResult(candidate, input);
  assert.ok(validated.ok);
  if (!validated.ok) {
    return;
  }
  const risk = validated.result.risks[0];
  assert.ok(risk);
  assert.deepEqual(risk.evidenceRefs, ["member:1:risk:low-headroom"]);
});

test("validateBriefingResult strips prototype-key evidenceRefs like toString and __proto__", () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 5 })]);
  const candidate = {
    headline: "Headline",
    summary: "Summary",
    sharedEvidenceCoverage: "Coverage",
    risks: [
      {
        title: "Low headroom",
        explanation: "Explained",
        evidenceRefs: ["toString", "__proto__", "member:1:risk:low-headroom"],
      },
    ],
    coordinationOpportunities: [],
    questionsForTheTeam: ["Q1"],
    limitations: ["L1"],
  };
  const validated = validateBriefingResult(candidate, input);
  assert.ok(validated.ok);
  if (!validated.ok) {
    return;
  }
  const risk = validated.result.risks[0];
  assert.ok(risk);
  assert.deepEqual(risk.evidenceRefs, ["member:1:risk:low-headroom"]);
});

test("validateBriefingResult accepts a well-formed payload and truncates oversized text", () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  const longText = "x".repeat(5000);
  const validated = validateBriefingResult(
    {
      headline: longText,
      summary: "Summary",
      sharedEvidenceCoverage: "Coverage",
      risks: [],
      coordinationOpportunities: [],
      questionsForTheTeam: [],
      limitations: [],
    },
    input,
  );
  assert.ok(validated.ok);
  if (!validated.ok) {
    return;
  }
  assert.ok(validated.result.headline.length <= 160);
});

test("getBriefingModelConfig returns null unless BOTH env vars are set, never guesses a model id", () => {
  assert.equal(getBriefingModelConfig({}), null);
  assert.equal(getBriefingModelConfig({ OPENAI_API_KEY: "sk-test" }), null);
  assert.equal(getBriefingModelConfig({ OPENAI_TEAM_BRIEFING_MODEL: "gpt-5.6" }), null);
  const config = getBriefingModelConfig({
    OPENAI_API_KEY: "sk-test",
    OPENAI_TEAM_BRIEFING_MODEL: "gpt-5.6",
  });
  assert.deepEqual(config, { apiKey: "sk-test", model: "gpt-5.6" });
});

test("generateTeamBriefing runs in deterministic-fallback mode with no env configured and makes no network call", async () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  let called = false;
  const response = await generateTeamBriefing(input, {
    env: {},
    fetchImpl: (async () => {
      called = true;
      throw new Error("must not be called");
    }) as never,
  });
  assert.equal(response.mode, "fallback");
  assert.equal(response.fallbackReason, "not_configured");
  assert.equal(called, false);
  assert.deepEqual(response.result, deterministicFallbackBriefing(input));
});

test("generateTeamBriefing falls back with no_data when nobody has shared, without calling the model", async () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], []);
  let called = false;
  const response = await generateTeamBriefing(input, {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_TEAM_BRIEFING_MODEL: "gpt-5.6" },
    fetchImpl: (async () => {
      called = true;
      throw new Error("must not be called");
    }) as never,
  });
  assert.equal(response.mode, "fallback");
  assert.equal(response.fallbackReason, "no_data");
  assert.equal(called, false);
});

test("generateTeamBriefing falls back to schema_error on a malformed model response", async () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  const response = await generateTeamBriefing(input, {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_TEAM_BRIEFING_MODEL: "gpt-5.6" },
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output_text: "not valid json" }),
    })) as never,
  });
  assert.equal(response.mode, "fallback");
  assert.equal(response.fallbackReason, "schema_error");
});

test("generateTeamBriefing falls back to model_error on a non-OK HTTP response", async () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  const response = await generateTeamBriefing(input, {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_TEAM_BRIEFING_MODEL: "gpt-5.6" },
    fetchImpl: (async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as never,
  });
  assert.equal(response.mode, "fallback");
  assert.equal(response.fallbackReason, "model_error");
});

test("generateTeamBriefing succeeds and returns mode=model with store:false in the request body", async () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  let capturedBody: string | null = null;
  const validPayload = {
    headline: "Headline",
    summary: "Summary",
    sharedEvidenceCoverage: "Coverage",
    risks: [],
    coordinationOpportunities: [],
    questionsForTheTeam: [],
    limitations: ["This is a planning aid."],
  };
  const response = await generateTeamBriefing(input, {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_TEAM_BRIEFING_MODEL: "gpt-5.6" },
    fetchImpl: (async (_url: string, init: { body: string }) => {
      capturedBody = init.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({ output_text: JSON.stringify(validPayload) }),
      };
    }) as never,
  });
  assert.equal(response.mode, "model");
  assert.equal(response.model, "gpt-5.6");
  assert.equal(response.result.headline, "Headline");
  assert.equal(
    response.result.sharedEvidenceCoverage,
    "Evidence comes from 1 of 1 teammates' approved snapshots.",
  );
  assert.ok(capturedBody);
  const parsedBody = JSON.parse(capturedBody as unknown as string) as Record<string, unknown>;
  assert.equal(parsedBody.store, false);
  assert.equal(parsedBody.model, "gpt-5.6");
  assert.equal(parsedBody.max_output_tokens, 2_000);
});

test("generateTeamBriefing aborts via its real timer and reports fallbackReason=timeout", async () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  // This fetch fixture never resolves on its own — it only rejects when the
  // AbortSignal passed by generateTeamBriefing actually fires. If the signal
  // were not wired to the timeout timer, this test would fail fast below.
  const response = await generateTeamBriefing(input, {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_TEAM_BRIEFING_MODEL: "gpt-5.6" },
    timeoutMs: 20,
    fetchImpl: ((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        if (!init.signal) {
          reject(new Error("fetch was called without an AbortSignal"));
          return;
        }
        init.signal.addEventListener("abort", () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
      })) as never,
  });
  assert.equal(response.mode, "fallback");
  assert.equal(response.fallbackReason, "timeout");
  assert.equal(response.model, "gpt-5.6");
  assert.deepEqual(response.result, deterministicFallbackBriefing(input));
});

test("generateTeamBriefing falls back to model_error when fetch rejects with a network failure", async () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  const response = await generateTeamBriefing(input, {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_TEAM_BRIEFING_MODEL: "gpt-5.6" },
    fetchImpl: (async () => {
      throw new TypeError("fetch failed");
    }) as never,
  });
  assert.equal(response.mode, "fallback");
  assert.equal(response.fallbackReason, "model_error");
  assert.deepEqual(response.result, deterministicFallbackBriefing(input));
});

test("generateTeamBriefing extracts text from a Responses API output[] payload without output_text", async () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  const validPayload = {
    headline: "From output array",
    summary: "Summary",
    sharedEvidenceCoverage: "Coverage",
    risks: [],
    coordinationOpportunities: [],
    questionsForTheTeam: [],
    limitations: ["This is a planning aid."],
  };
  const response = await generateTeamBriefing(input, {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_TEAM_BRIEFING_MODEL: "gpt-5.6" },
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          { type: "reasoning", content: [] },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(validPayload) }] },
        ],
      }),
    })) as never,
  });
  assert.equal(response.mode, "model");
  assert.equal(response.result.headline, "From output array");
});

test("generateTeamBriefing never leaks the API key into any response, including failures", async () => {
  const input = buildInput([{ userId: "u1", displayName: "Sam" }], [snapshot({ userId: "u1", reliableCapacityPct: 60 })]);
  const env = { OPENAI_API_KEY: "sk-secret-never-leaks", OPENAI_TEAM_BRIEFING_MODEL: "gpt-5.6" };
  const failure = await generateTeamBriefing(input, {
    env,
    fetchImpl: (async () => {
      throw new Error("sk-secret-never-leaks rejected"); // hostile error message
    }) as never,
  });
  assert.ok(!JSON.stringify(failure).includes("sk-secret-never-leaks"));
  const success = await generateTeamBriefing(input, {
    env,
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        output_text: JSON.stringify({
          headline: "H",
          summary: "S",
          sharedEvidenceCoverage: "C",
          risks: [],
          coordinationOpportunities: [],
          questionsForTheTeam: [],
          limitations: [],
        }),
      }),
    })) as never,
  });
  assert.ok(!JSON.stringify(success).includes("sk-secret-never-leaks"));
});

test("AI_DISCLOSURE names the source of the briefing and that it is a planning aid", () => {
  assert.match(AI_DISCLOSURE, /AI-generated/);
  assert.match(AI_DISCLOSURE, /planning aid/);
});
