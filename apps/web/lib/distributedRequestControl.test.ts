import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  acquireAiRequestControl,
  acquireWebexRequestControl,
  completeAiRequestControl,
  completeWebexRequestControl,
  deriveRequestIdempotencyKey,
  deriveSecretKeyedRequestHash,
  requestControlFailure,
  resolveServerRequestControlEnvironment,
  type RequestControlRpcClient,
} from "./distributedRequestControl";

const RECEIPT_ID = "81000000-0000-4000-8000-000000000001";
const LEASE_TOKEN = "82000000-0000-4000-8000-000000000001";
const SERVER_CLAIM = "synthetic-server-claim-that-is-long-enough";

function rpcClient(
  reply: { data: unknown; error: { message: string } | null },
): { client: RequestControlRpcClient; calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    client: {
      async rpc(name, args) {
        calls.push({ name, args });
        return reply;
      },
    },
    calls,
  };
}

test("authenticated AI acquisition accepts only a complete bounded lease receipt", async () => {
  const { client, calls } = rpcClient({
    data: [{
      decision: "acquired",
      receipt_id: RECEIPT_ID,
      lease_token: LEASE_TOKEN,
      retry_after_seconds: 0,
      daily_remaining: 29,
      token_budget_remaining: 36_864,
    }],
    error: null,
  });
  const idempotencyKey = deriveRequestIdempotencyKey([
    "personal_agent",
    "synthetic-user",
    "synthetic-replica-revision",
    "What fits next?",
  ]);

  const result = await acquireAiRequestControl(client, "personal_agent", {
    ipSubjectHash: "b".repeat(64),
    idempotencyKey,
    reservedTokenUnits: 4_096,
    serverClaim: SERVER_CLAIM,
  });

  assert.deepEqual(result, {
    decision: "acquired",
    receiptId: RECEIPT_ID,
    leaseToken: LEASE_TOKEN,
    retryAfterSeconds: 0,
    dailyRemaining: 29,
    tokenBudgetRemaining: 36_864,
  });
  assert.deepEqual(calls, [{
    name: "acquire_ai_request_control",
    args: {
      p_scope: "personal_agent",
      p_ip_subject_hash: "b".repeat(64),
      p_idempotency_key: idempotencyKey,
      p_reserved_token_units: 4_096,
      p_server_claim: SERVER_CLAIM,
    },
  }]);
  assert.equal(JSON.stringify(calls).includes("What fits next?"), false);
});

test("control acquisition fails closed on RPC errors and malformed database responses", async () => {
  for (const reply of [
    { data: null, error: { message: "function unavailable" } },
    { data: [], error: null },
    { data: [{ decision: "acquired", receipt_id: RECEIPT_ID }], error: null },
    { data: [{ decision: "unexpected", retry_after_seconds: 0, daily_remaining: 0 }], error: null },
  ]) {
    const { client } = rpcClient(reply);
    assert.deepEqual(
      await acquireAiRequestControl(client, "team_briefing", {
        ipSubjectHash: "b".repeat(64),
        idempotencyKey: "a".repeat(64),
        reservedTokenUnits: 8_192,
        serverClaim: SERVER_CLAIM,
      }),
      {
        decision: "unavailable",
        retryAfterSeconds: 0,
        dailyRemaining: 0,
        tokenBudgetRemaining: 0,
      },
    );
  }
});

test("completion records only a generic outcome against the opaque receipt and lease", async () => {
  const { client, calls } = rpcClient({ data: true, error: null });

  assert.equal(await completeAiRequestControl(client, {
    receiptId: RECEIPT_ID,
    leaseToken: LEASE_TOKEN,
    serverClaim: SERVER_CLAIM,
  }, "provider_timeout"), true);

  assert.deepEqual(calls, [{
    name: "complete_ai_request_control",
    args: {
      p_receipt_id: RECEIPT_ID,
      p_lease_token: LEASE_TOKEN,
      p_outcome_code: "provider_timeout",
      p_server_claim: SERVER_CLAIM,
    },
  }]);
});

test("Webex controls send only keyed subjects, keyed request ids, and the protected server claim", async () => {
  const { client, calls } = rpcClient({
    data: [{
      decision: "acquired",
      receipt_id: RECEIPT_ID,
      lease_token: LEASE_TOKEN,
      retry_after_seconds: 0,
      daily_remaining: 19,
      token_budget_remaining: 0,
    }],
    error: null,
  });
  const subjectHash = "b".repeat(64);
  const idempotencyKey = "c".repeat(64);

  const acquired = await acquireWebexRequestControl(client, {
    subjectHash,
    idempotencyKey,
    serverClaim: SERVER_CLAIM,
  });
  assert.equal(acquired.decision, "acquired");
  assert.deepEqual(calls[0], {
    name: "acquire_webex_request_control",
    args: {
      p_subject_hash: subjectHash,
      p_idempotency_key: idempotencyKey,
      p_server_claim: SERVER_CLAIM,
    },
  });

  const completion = rpcClient({ data: true, error: null });
  assert.equal(await completeWebexRequestControl(completion.client, {
    receiptId: RECEIPT_ID,
    leaseToken: LEASE_TOKEN,
    subjectHash,
    serverClaim: SERVER_CLAIM,
  }, "ok"), true);
  assert.deepEqual(completion.calls[0], {
    name: "complete_webex_request_control",
    args: {
      p_receipt_id: RECEIPT_ID,
      p_lease_token: LEASE_TOKEN,
      p_subject_hash: subjectHash,
      p_server_claim: SERVER_CLAIM,
      p_outcome_code: "ok",
    },
  });
});

test("derived request identifiers are stable one-way digests and keyed subjects rotate with the secret", () => {
  const plain = deriveRequestIdempotencyKey(["personal_agent", "question: private context"]);
  const keyedA = deriveSecretKeyedRequestHash("a".repeat(32), ["203.0.113.8"]);
  const keyedB = deriveSecretKeyedRequestHash("b".repeat(32), ["203.0.113.8"]);

  assert.match(plain, /^[a-f0-9]{64}$/);
  assert.match(keyedA, /^[a-f0-9]{64}$/);
  assert.equal(plain.includes("private context"), false);
  assert.notEqual(keyedA, keyedB);
  assert.equal(keyedA, deriveSecretKeyedRequestHash("a".repeat(32), ["203.0.113.8"]));
  assert.throws(() => deriveSecretKeyedRequestHash("too-short", ["203.0.113.8"]));
});

test("trusted IP controls activate only on the explicitly configured Vercel proxy", () => {
  const base = {
    REQUEST_CONTROL_SERVER_CLAIM: SERVER_CLAIM,
    REQUEST_CONTROL_IP_HASH_SECRET: "i".repeat(32),
    REQUEST_CONTROL_TRUSTED_IP_HEADER: "x-forwarded-for",
    REQUEST_CONTROL_TRUSTED_PROXY: "vercel",
  };
  assert.deepEqual(resolveServerRequestControlEnvironment({ ...base, VERCEL: "1" }), {
    serverClaim: SERVER_CLAIM,
    ipHashSecret: "i".repeat(32),
    trustedIpHeader: "x-forwarded-for",
    trustedProxy: "vercel",
  });
  assert.equal(resolveServerRequestControlEnvironment(base), null);
  assert.equal(resolveServerRequestControlEnvironment({ ...base, VERCEL: "0" }), null);
  assert.equal(resolveServerRequestControlEnvironment({
    ...base,
    VERCEL: "1",
    REQUEST_CONTROL_TRUSTED_PROXY: "generic",
  }), null);
});

test("control decisions map to bounded retry-safe public failures", () => {
  assert.deepEqual(requestControlFailure({
    decision: "budget_exhausted",
    retryAfterSeconds: 3_600,
    dailyRemaining: 0,
    tokenBudgetRemaining: 0,
  }), {
    status: 429,
    message: "This request budget is exhausted. Try again after the UTC budget resets.",
    retryAfterSeconds: 3_600,
  });
  assert.equal(requestControlFailure({
    decision: "in_progress",
    retryAfterSeconds: 12,
    dailyRemaining: 8,
    tokenBudgetRemaining: 16_384,
  }).status, 409);
  assert.equal(requestControlFailure({
    decision: "replay_succeeded",
    retryAfterSeconds: 0,
    dailyRemaining: 8,
    tokenBudgetRemaining: 16_384,
  }).status, 409);
  assert.equal(requestControlFailure({
    decision: "unavailable",
    retryAfterSeconds: 0,
    dailyRemaining: 0,
    tokenBudgetRemaining: 0,
  }).status, 503);
});

test("AI and Webex entry points acquire before provider I/O and complete redacted receipts", () => {
  const personalRoute = readFileSync(
    new URL("../app/api/personal-agent/route.ts", import.meta.url),
    "utf8",
  );
  const briefingAction = readFileSync(
    new URL("../app/teams/[teamId]/briefing/actions.ts", import.meta.url),
    "utf8",
  );
  const webexRoute = readFileSync(
    new URL("../app/api/oauth/webex/token/route.ts", import.meta.url),
    "utf8",
  );
  const briefingPanel = readFileSync(
    new URL("../app/teams/[teamId]/briefing/BriefingPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(personalRoute.indexOf("auth.getUser()") < personalRoute.indexOf("await acquireAiRequestControl"));
  assert.ok(personalRoute.indexOf("await acquireAiRequestControl") < personalRoute.lastIndexOf("await generatePersonalAgentAnswer"));
  assert.match(personalRoute, /completeAiRequestControl/);
  assert.ok(briefingAction.indexOf("isManagerRole") < briefingAction.indexOf("await acquireAiRequestControl"));
  assert.ok(briefingAction.indexOf("await acquireAiRequestControl") < briefingAction.lastIndexOf("await generateTeamBriefing"));
  assert.match(briefingAction, /completeAiRequestControl/);
  assert.match(briefingAction, /formData\.get\("request_id"\)/);
  assert.match(briefingPanel, /name="request_id"/);
  assert.match(briefingPanel, /crypto\.randomUUID\(\)/);
  assert.ok(webexRoute.indexOf("await acquireWebexRequestControl") < webexRoute.indexOf("fetch(exchange.endpoint"));
  assert.match(webexRoute, /completeWebexRequestControl/);
  for (const source of [personalRoute, briefingAction, webexRoute]) {
    assert.doesNotMatch(source, /console\.|logger\.|requestBody|rawIp|prompt\s*:/i);
  }
});

test("migration keeps monitoring metadata private and grants only the intended RPC roles", () => {
  const migration = readFileSync(
    new URL("../../../supabase/migrations/202607200006_distributed_request_controls.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /create table if not exists private\.request_control_receipts/i);
  assert.match(migration, /request_control_one_active_lease_idx/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /grant execute on function public\.acquire_ai_request_control\(text,text,text,integer,text\)\s+to authenticated/i);
  assert.match(migration, /grant execute on function public\.acquire_webex_request_control\(text,text,text\)\s+to anon/i);
  assert.match(migration, /current_setting\(\s*'app\.settings\.request_control_server_claim_sha256'/i);
  assert.doesNotMatch(migration, /\b(?:prompt|request_body|raw_ip|access_token|refresh_token)\s+(?:text|jsonb)/i);
});
