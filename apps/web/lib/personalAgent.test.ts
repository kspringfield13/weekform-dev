import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import {
  buildPersonalAgentContext,
  generatePersonalAgentAnswer,
  parsePersonalAgentQuestion,
} from "./personalAgent";

const replica: PersonalWorkloadReplicaV1 = {
  schemaVersion: 1,
  replicaId: "personal-2026-W29",
  weekId: "2026-W29",
  generatedAt: "2026-07-20T12:00:00.000Z",
  sourceUpdatedAt: "2026-07-20T11:55:00.000Z",
  blocks: [{
    blockId: "review-safe-1",
    weekId: "2026-W29",
    startTime: "2026-07-20T09:00:00.000Z",
    endTime: "2026-07-20T10:00:00.000Z",
    estimatedCapacityPct: 12,
    category: "Planned analysis / project work",
    mode: "Deep work",
    plannedStatus: "planned",
    confidence: 0.9,
    userVerified: true,
    blockerFlag: false,
    revision: "0123456789abcdef",
  }],
  capacity: {
    allocatedPct: 62,
    deepWorkPct: 36,
    fragmentedWorkPct: 14,
    meetingPct: 12,
    reactivePct: 18,
    plannedPct: 44,
    blockedPct: 0,
    reliableNewWorkCapacityPct: 31,
    committedUtilizationPct: 69,
    carryoverRiskPct: 22,
    wipLoadScore: 28,
    contextSwitchScore: 19,
    summaryConfidence: 0.84,
  },
};

test("personal Agent accepts a bounded question and rejects malformed input", () => {
  assert.equal(parsePersonalAgentQuestion({ question: "  What fits next?  " }), "What fits next?");
  assert.equal(parsePersonalAgentQuestion({ question: "" }), null);
  assert.equal(parsePersonalAgentQuestion({ question: "x".repeat(601) }), null);
  assert.equal(parsePersonalAgentQuestion({ question: "ok", rawEvidence: "never" }), null);
});

test("personal Agent context contains only review-safe replica aggregates", () => {
  const context = buildPersonalAgentContext(replica);
  assert.equal(context.weekId, "2026-W29");
  assert.equal(context.reliableCapacityPct, 31);
  assert.equal(context.reviewedBlockCount, 1);
  assert.deepEqual(context.modeCounts, { "Deep work": 1 });
  const serialized = JSON.stringify(context);
  for (const rawValue of ["review-safe-1", "0123456789abcdef", "2026-07-20T09:00:00.000Z", "2026-07-20T10:00:00.000Z"]) {
    assert.ok(!serialized.includes(rawValue), `context must omit raw block value ${rawValue}`);
  }
});

test("personal Agent fails over visibly to a deterministic review-safe answer", async () => {
  const response = await generatePersonalAgentAnswer(
    buildPersonalAgentContext(replica),
    "What fits next?",
    { env: {}, fetchImpl: async () => { throw new Error("must not call"); } },
  );
  assert.equal(response.mode, "fallback");
  assert.equal(response.fallbackReason, "not_configured");
  assert.match(response.answer, /31% reliable capacity/);
  assert.match(response.answer, /review-safe/i);
});

test("manager briefing configuration cannot activate Individual Ask processing", async () => {
  let calls = 0;
  const response = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), "What fits next?", {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_TEAM_BRIEFING_MODEL: "manager-only-model" },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not call");
    },
  });
  assert.equal(response.mode, "fallback");
  assert.equal(response.fallbackReason, "not_configured");
  assert.equal(calls, 0);
});

test("personal Agent distinguishes advice from explicit state-changing commands", async () => {
  let calls = 0;
  const options = {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_PERSONAL_AGENT_MODEL: "gpt-test" },
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 500, json: async () => ({}) };
    },
  };
  const advice = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), "What should change in my plan?", options);
  assert.equal(advice.mode, "fallback");
  assert.equal(calls, 1, "advisory questions may use the read-only model path");
  const command = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), "Please change my plan.", options);
  assert.equal(command.mode, "mac_handoff");
  assert.equal(calls, 1, "explicit action intent must not call a model or mutate state");
  assert.match(command.answer, /did not run/i);
});

test("personal Agent drops unknown model evidence references", async () => {
  const response = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), "What fits?", {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_PERSONAL_AGENT_MODEL: "gpt-test" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output_text: JSON.stringify({
        answer: "Use the published capacity as a bound.",
        evidenceRefs: ["week:capacity", "invented:raw-title"],
        limitations: ["Latest published week only."],
      }) }),
    }),
  });
  assert.equal(response.mode, "model");
  assert.equal(response.evidence.length, 1);
  assert.match(response.evidence[0] ?? "", /31% reliable/);
  assert.doesNotMatch(JSON.stringify(response), /invented:raw-title/);
});

test("personal Agent request is no-store and contains only the minimized catalog", async () => {
  let requestBody = "";
  let authorization = "";
  const response = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), "What fits?", {
    env: { OPENAI_API_KEY: "sk-private-test", OPENAI_PERSONAL_AGENT_MODEL: "gpt-test" },
    fetchImpl: async (_input, init) => {
      requestBody = init.body;
      authorization = init.headers.Authorization ?? "";
      assert.ok(init.signal instanceof AbortSignal);
      return {
        ok: true,
        status: 200,
        json: async () => ({ output_text: JSON.stringify({
          answer: "Use the published capacity as a planning bound.",
          evidenceRefs: ["week:capacity"],
          limitations: ["Latest published week only."],
        }) }),
      };
    },
  });
  assert.equal(response.mode, "model");
  const body = JSON.parse(requestBody) as Record<string, unknown>;
  assert.equal(body.store, false);
  assert.equal(body.model, "gpt-test");
  assert.equal(authorization, "Bearer sk-private-test");
  for (const forbidden of ["sk-private-test", "review-safe-1", "0123456789abcdef", "2026-07-20T09:00:00.000Z"]) {
    assert.ok(!requestBody.includes(forbidden), `request body must omit ${forbidden}`);
  }
});

test("personal Agent labels an aborted provider request as a timeout fallback", async () => {
  const response = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), "What fits?", {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_PERSONAL_AGENT_MODEL: "gpt-test" },
    fetchImpl: async (_input, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      const error = new Error("timed out");
      error.name = "AbortError";
      throw error;
    },
  });
  assert.equal(response.mode, "fallback");
  assert.equal(response.fallbackReason, "timeout");
});

test("personal Agent rejects a model answer grounded only in invented evidence", async () => {
  const response = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), "What fits?", {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_PERSONAL_AGENT_MODEL: "gpt-test" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output_text: JSON.stringify({
        answer: "Trust an unavailable private title.",
        evidenceRefs: ["invented:raw-title"],
        limitations: [],
      }) }),
    }),
  });
  assert.equal(response.mode, "fallback");
  assert.equal(response.fallbackReason, "invalid_response");
  assert.match(response.answer, /review-safe/i);
});

test("Ask route authenticates, reloads the latest replica, and never accepts browser workload context", () => {
  const route = readFileSync(new URL("../app/api/personal-agent/route.ts", import.meta.url), "utf8");
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /listOwnPersonalReplicas/);
  assert.match(route, /parsePersonalAgentQuestion/);
  assert.doesNotMatch(route, /body\.(?:replica|context|blocks|capacity)/);
});

test("Ask workspace uses the authenticated endpoint with transient conversation and loud failures", () => {
  const source = readFileSync(new URL("../components/PersonalAgentWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /^"use client";/);
  assert.match(source, /fetch\("\/api\/personal-agent"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-live="polite"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("Individual Ask model configuration is documented as server-only and independent", () => {
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(example, /OPENAI_PERSONAL_AGENT_MODEL=/);
  assert.match(example, /SERVER-ONLY/);
  assert.match(example, /independently from Team Briefing/);
  assert.doesNotMatch(example, /NEXT_PUBLIC_OPENAI_PERSONAL_AGENT_MODEL/);
});
