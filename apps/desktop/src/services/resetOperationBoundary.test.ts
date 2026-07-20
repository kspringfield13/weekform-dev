import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createAsyncOperationEpoch } from "../hooks/useAsyncStatus";
import {
  AGENT_CHAT_STORAGE_KEY,
  AGENT_DRAFT_STORAGE_KEY,
  clearAgentSessionStorage,
} from "./agentSessionStorage";

test("reset invalidates every operation token captured before it", () => {
  const epoch = createAsyncOperationEpoch();
  const first = epoch.start();
  assert.equal(epoch.isCurrent(first), true);

  epoch.invalidate();
  assert.equal(epoch.isCurrent(first), false);

  const second = epoch.start();
  assert.equal(epoch.isCurrent(second), true);
  assert.equal(epoch.isCurrent(first), false);
});

test("every persisted AI workflow checks its reset epoch after provider await", () => {
  const hooks = [
    "useNarrativeGeneration.ts",
    "useForecastAgent.ts",
    "useClassification.ts",
    "useReviewCopilot.ts",
    "useVisualContext.ts",
    "useAcceleration.ts",
  ];
  for (const hook of hooks) {
    const source = readFileSync(new URL(`../hooks/${hook}`, import.meta.url), "utf8");
    assert.match(source, /const operationEpoch\s*=\s*\w+Async\.start\(/, hook);
    assert.match(source, /\.isCurrent\(operationEpoch\)/, hook);
    assert.doesNotMatch(source, /reset\w+:\s*\w+Async\.reset/, hook);
  }
});

test("Reset Local Data clears both independently persisted Agent surfaces", () => {
  const removed: string[] = [];
  clearAgentSessionStorage({ removeItem: (key) => removed.push(key) });
  assert.deepEqual(removed, [AGENT_CHAT_STORAGE_KEY, AGENT_DRAFT_STORAGE_KEY]);
});

test("Agent storage clearing reports failure but still attempts every key", () => {
  const attempted: string[] = [];
  const cleared = clearAgentSessionStorage({
    removeItem: (key) => {
      attempted.push(key);
      if (key === AGENT_CHAT_STORAGE_KEY) throw new Error("storage unavailable");
    },
  });
  assert.equal(cleared, false);
  assert.deepEqual(attempted, [AGENT_CHAT_STORAGE_KEY, AGENT_DRAFT_STORAGE_KEY]);
});

test("confirmed reset invalidates and clears the conversational Agent boundary", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const agent = readFileSync(
    new URL("../components/agent/AgentScreen.tsx", import.meta.url),
    "utf8",
  );
  const router = readFileSync(
    new URL("../components/shell/ScreenRouter.tsx", import.meta.url),
    "utf8",
  );

  assert.match(app, /const resetInProgressRef\s*=\s*useRef\(false\)/);
  assert.match(app, /if \(resetInProgressRef\.current\) return/);
  assert.match(app, /setAgentResetGeneration\(\(current\) => current \+ 1\)/);
  assert.match(app, /clearAgentSessionStorage\(\)/);
  assert.match(app, /agent_session_storage_cleared: agentSessionStorageCleared/);
  assert.match(app, /await personalCloud\.quiesceForReset\(\)/);
  assert.ok(
    app.indexOf("await personalCloud.quiesceForReset()") < app.indexOf("cloudAccount.clearAll()"),
    "personal sync must quiesce before cloud account deletion",
  );
  assert.match(router, /resetGeneration=\{agentResetGeneration\}/);
  assert.match(agent, /resetGeneration: number/);
  assert.match(agent, /agentOperationEpochRef\.current \+= 1/);
  assert.match(agent, /abortControllerRef\.current\?\.abort\(\)/);
  assert.match(agent, /clearAgentSessionStorage\(\)/);
});
