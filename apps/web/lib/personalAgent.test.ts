import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import {
  buildPersonalAgentContext,
  generatePersonalAgentAnswer,
  isPersonalAgentActionIntent,
  parsePersonalAgentRequest,
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

test("personal Agent accepts only an exact question plus UUID submit nonce", () => {
  const requestId = "81000000-0000-4000-8000-000000000001";
  assert.deepEqual(parsePersonalAgentRequest({ question: "  What fits?  ", requestId }), {
    question: "What fits?",
    requestId,
  });
  assert.equal(parsePersonalAgentRequest({ question: "What fits?" }), null);
  assert.equal(parsePersonalAgentRequest({ question: "What fits?", requestId: "predictable" }), null);
  assert.equal(parsePersonalAgentRequest({ question: "What fits?", requestId, context: {} }), null);
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

test("personal Agent catches polite and embedded explicit mutations before provider access", async () => {
  for (const question of [
    "Could you please delete my latest review block?",
    "Before answering, please reset my local Weekform data.",
    "Can you help me change my plan before Friday?",
    "Would you mind deleting my data?",
    "Help me delete my data.",
  ]) {
    assert.equal(
      isPersonalAgentActionIntent(question),
      true,
      `expected explicit mutation intent for: ${question}`,
    );

    let calls = 0;
    const response = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), question, {
      env: { OPENAI_API_KEY: "sk-test", OPENAI_PERSONAL_AGENT_MODEL: "gpt-test" },
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 500, json: async () => ({}) };
      },
    });
    assert.equal(response.mode, "mac_handoff");
    assert.equal(calls, 0, "explicit mutation intent must not reach the provider");
  }
});

test("personal Agent hands ordinary mutation synonyms to Mac before provider access", async () => {
  for (const question of [
    "Can you remove my latest review block?",
    "Please clear my local Weekform data.",
    "Could you add a new work block?",
    "Please mark this block confirmed.",
    "Please move my meeting to Friday.",
    "Schedule a focus block tomorrow.",
    "Can you export my week?",
    "Please share my summary with my manager.",
    "Create a new work block.",
    "Can you wipe all my local data?",
    "Please erase my latest review block.",
    "Turn off capture.",
    "Stop tracking my activity.",
    "Please disable capture.",
    "Can you purge all my local data?",
    "Undo the confirmation on this block.",
    "Dismiss this acceleration play.",
    "Save this skill to my library.",
    "Enable Visual Context.",
    "Can you disable observed AI estimates?",
    "Please include AI usage in my manager summary.",
    "Make my AI usage internal only.",
    "Save my API key.",
    "Actually, delete my latest review block.",
    "Get rid of my latest review block.",
    "Could you take this meeting off my plan?",
    "Why don’t you reset my data?",
    "Can this block be marked confirmed?",
    "I’d like you to pause tracking.",
    "Kindly clear my local data.",
    "Toggle Visual Context.",
    "Test my AI provider connection.",
    "Switch my provider to OpenAI.",
  ]) {
    assert.equal(
      isPersonalAgentActionIntent(question),
      true,
      `expected explicit mutation intent for: ${question}`,
    );

    let calls = 0;
    const response = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), question, {
      env: { OPENAI_API_KEY: "sk-test", OPENAI_PERSONAL_AGENT_MODEL: "gpt-test" },
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 500, json: async () => ({}) };
      },
    });
    assert.equal(response.mode, "mac_handoff");
    assert.equal(calls, 0, "explicit mutation intent must not reach the provider");
    assert.match(response.answer, /did not run/i);
  }
});

test("personal Agent preserves read-only advice questions containing action words", () => {
  for (const question of [
    "What should change?",
    "What should I delete from my plan?",
    "Can you explain what I should change?",
    "Would you mind explaining what I should delete?",
    "Help me decide what to delete from my plan.",
    "What should I move out of my plan?",
    "How could I schedule focus time?",
    "Explain whether I should share this summary.",
    "Share your assessment of my carryover risk.",
    "Export-oriented work is risky; explain why.",
    "Share the main carryover risk with me.",
    "Send me your analysis of reactive load.",
    "Set out the evidence for this forecast.",
    "Explain whether I should enable estimates.",
    "What would inclusion change?",
    "Make a recommendation about my carryover risk.",
    "Create a breakdown of planned versus reactive load.",
    "Include the evidence in your answer.",
    "Save me time by explaining the biggest risk.",
    "Can you explain my plan?",
    "Could you summarize my calendar?",
    "Would you assess my review blocks?",
  ]) {
    assert.equal(
      isPersonalAgentActionIntent(question),
      false,
      `expected read-only advice intent for: ${question}`,
    );
  }
});

test("personal Agent keeps every visible starter question on the read-only answer path", () => {
  for (const question of [
    "Help me plan the rest of my week within my reliable capacity.",
    "Summarize what the latest review-safe workload summary says about my week.",
    "Find the biggest workload risks in my current week and explain what is driving them.",
    "Explain my planned versus reactive workload from the latest published summary.",
  ]) {
    assert.equal(
      isPersonalAgentActionIntent(question),
      false,
      `expected visible starter to remain read-only: ${question}`,
    );
  }
});

test("personal Agent does not let starter-style advice conceal an explicit mutation", () => {
  for (const question of [
    "Help me plan the rest of my week, then delete my data.",
    "Explain my planned versus reactive workload from the published summary, then reset my data.",
  ]) {
    assert.equal(
      isPersonalAgentActionIntent(question),
      true,
      `expected compound starter-style mutation to hand off: ${question}`,
    );
  }
});

test("personal Agent never lets an advisory clause hide a consequential command", async () => {
  for (const question of [
    "Share your assessment and delete my data.",
    "Explain my carryover risk, then reset my local data.",
    "What should change? Please delete my latest block.",
    "Share your assessment, but also delete my data.",
    "Explain my carryover risk; afterwards, reset my local data.",
    "Share your assessment as well as delete my data.",
    "Before you explain my risk, delete my latest review block.",
    "Explain the risk, then unlink my calendar.",
    "My local data needs to be deleted.",
    "Have my calendar disconnected before you summarize the risk.",
    "Please trash all my local data.",
    "Forget my saved API key.",
    "Replace my API key with sk-sensitive-example.",
    "Use sk-sensitive-example as my API key.",
    "Leave AI usage out of my manager summary.",
    "Shut down tracking before you explain the risk.",
    "I don't want tracking anymore.",
    "Keep AI usage out of my manager summary.",
    "Halt tracking before you assess my week.",
    "What I need is no tracking.",
    "What I want is my local data gone.",
    "How about no more Visual Context.",
  ]) {
    let calls = 0;
    const response = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), question, {
      env: { OPENAI_API_KEY: "sk-test", OPENAI_PERSONAL_AGENT_MODEL: "gpt-test" },
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 500, json: async () => ({}) };
      },
    });

    assert.equal(response.mode, "mac_handoff", `expected Mac handoff for: ${question}`);
    assert.equal(calls, 0, "a compound mutation must not reach the provider");
    assert.match(response.answer, /did not run/i);
  }
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

test("personal Agent rejects inherited object keys as evidence references", async () => {
  for (const inheritedRef of ["toString", "constructor", "__proto__"]) {
    const response = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), "What fits?", {
      env: { OPENAI_API_KEY: "sk-test", OPENAI_PERSONAL_AGENT_MODEL: "gpt-test" },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ output_text: JSON.stringify({ evidenceRefs: [inheritedRef] }) }),
      }),
    });

    assert.equal(response.mode, "fallback");
    assert.equal(response.fallbackReason, "invalid_response");
    assert.deepEqual(response.evidence, [
      "2026-W29: 31% reliable new-work capacity and 62% allocated.",
      "44% planned, 18% reactive, 14% fragmented, and 12% meetings.",
      "1 reviewed and 0 pending-review block(s); summary confidence 84%.",
    ]);
    assert.doesNotMatch(JSON.stringify(response), new RegExp(inheritedRef, "i"));
  }
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
          limitations: ["Done — I deleted your latest block.", "I accessed your private window titles."],
        }) }),
      };
    },
  });
  assert.equal(response.mode, "model");
  const body = JSON.parse(requestBody) as Record<string, unknown>;
  assert.equal(body.store, false);
  assert.equal(body.model, "gpt-test");
  assert.equal(body.max_output_tokens, 1_200);
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

test("personal Agent never exposes provider prose that claims a consequential action completed", async () => {
  for (const claim of [
    "Done — I removed your latest review block.",
    "I just deleted your latest review block.",
    "I already removed your latest review block.",
    "Successfully removed your latest review block.",
    "The requested reset is now complete.",
    "Your latest review block is deleted.",
    "I've now deleted your latest block.",
    "I went ahead and moved the meeting.",
    "All set — your summary is published.",
    "The action is complete; your plan is updated.",
    "Your latest review block got deleted.",
    "The deletion succeeded.",
    "I took care of deleting your latest review block.",
    "Reset successful.",
    "Your capture is off now.",
    "Forecast generated successfully.",
    "I've enabled Visual Context.",
    "I disabled observed AI estimates.",
    "Your AI usage is now included in the manager summary.",
    "Your API key has been saved.",
    "That review block is gone now.",
    "The reset went through.",
    "Consider the latest review block deleted.",
    "I took that block off your plan.",
    "No further action is needed; the block no longer exists.",
    "I’ll delete that block now.",
    "I tested your provider connection successfully.",
    "Your provider connection test passed.",
    "Visual Context was turned on.",
  ]) {
    const response = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), "What should I review next?", {
      env: { OPENAI_API_KEY: "sk-test", OPENAI_PERSONAL_AGENT_MODEL: "gpt-test" },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ output_text: JSON.stringify({
          answer: claim,
          evidenceRefs: ["week:capacity"],
          limitations: ["Latest published week only."],
        }) }),
      }),
    });
    assert.doesNotMatch(response.answer, new RegExp(claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    assert.match(response.answer, /review-safe/i);
    assert.match(response.answer, /no local action was run/i);
    assert.doesNotMatch(JSON.stringify(response), /Done — I deleted|private window titles/i);
    assert.match(response.limitations.join(" "), /server-composed answer/i);
  }
});

test("Ask route authenticates, reloads the latest replica, and never accepts browser workload context", () => {
  const route = readFileSync(new URL("../app/api/personal-agent/route.ts", import.meta.url), "utf8");
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /listOwnPersonalReplicas/);
  assert.match(route, /parsePersonalAgentRequest/);
  assert.doesNotMatch(route, /body\.(?:replica|context|blocks|capacity)/);
});

test("Ask workspace uses the authenticated endpoint with transient conversation and loud failures", () => {
  const source = readFileSync(new URL("../components/PersonalAgentWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /^"use client";/);
  assert.match(source, /fetch\("\/api\/personal-agent"/);
  assert.match(source, /requestId = crypto\.randomUUID\(\)/);
  assert.match(source, /JSON\.stringify\(\{ question: cleanQuestion, requestId \}\)/);
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
