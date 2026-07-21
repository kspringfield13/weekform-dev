import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createAsyncOperationEpoch,
  createAsyncOperationGate,
  isResetInProgress,
} from "../hooks/useAsyncStatus";
import { createCloudSyncOperationBarrier } from "../hooks/useCloudSync";
import { createConnectorResetBoundary } from "../hooks/connectorResetBoundary";
import {
  canChangeCapturePaused,
  shouldAcceptCaptureTimestamp,
} from "./captureDeliveryGuard";
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

test("a deferred startup journal read cannot repopulate state after reset invalidation", async () => {
  const epoch = createAsyncOperationEpoch();
  const startupToken = epoch.start();
  let resolveRead!: (samples: string[]) => void;
  const deferredRead = new Promise<string[]>((resolve) => { resolveRead = resolve; });
  const committed: string[] = [];
  const hydration = deferredRead.then((samples) => {
    if (!epoch.isCurrent(startupToken)) return;
    committed.push(...samples);
  });

  epoch.invalidate();
  resolveRead(["stale-private-sample"]);
  await hydration;
  assert.deepEqual(committed, []);
});

test("reset waits for a deferred startup credential migration before durable clear", async () => {
  let resolveMigration!: () => void;
  const migrationStarted = new Promise<void>((resolve) => { resolveMigration = resolve; });
  const durableState: string[] = [];
  const hydrationBarrier = migrationStarted.then(() => {
    durableState.push("migrated-keychain-binding");
  });
  let clearFinished = false;
  const reset = hydrationBarrier.then(() => {
    durableState.length = 0;
    clearFinished = true;
  });

  await Promise.resolve();
  assert.equal(clearFinished, false);
  resolveMigration();
  await reset;
  assert.equal(clearFinished, true);
  assert.deepEqual(durableState, []);
});

test("a deferred AI connection result cannot restore a provider secret after reset", async () => {
  const epoch = createAsyncOperationEpoch();
  const connectionToken = epoch.start();
  let resolveTest!: () => void;
  const deferredTest = new Promise<void>((resolve) => { resolveTest = resolve; });
  const persistedKeys: string[] = [];
  const testConnection = deferredTest.then(() => {
    if (!epoch.isCurrent(connectionToken)) return;
    persistedKeys.push("stale-provider-secret");
  });

  epoch.invalidate();
  resolveTest();
  await testConnection;

  assert.deepEqual(persistedKeys, []);
});

test("AI connection work cannot start while reset owns the gate", async () => {
  const gate = createAsyncOperationGate();
  gate.close();

  const duringResetToken = gate.begin();
  let requestsStarted = 0;
  if (duringResetToken !== null) {
    requestsStarted += 1;
    await Promise.resolve();
  }
  assert.equal(duringResetToken, null);
  assert.equal(requestsStarted, 0);

  gate.open();
  const afterResetToken = gate.begin();
  assert.notEqual(afterResetToken, null);
  assert.equal(gate.isCurrent(afterResetToken!), true);
});

test("capture cannot resume during Reset and queued pre-resume events stay rejected", () => {
  assert.equal(canChangeCapturePaused(true, false), false);
  assert.equal(canChangeCapturePaused(true, true), true);
  assert.equal(canChangeCapturePaused(false, false), true);

  const resumeAt = 1_000;
  const state = { accepting: true, acceptAfterMs: resumeAt };
  assert.equal(shouldAcceptCaptureTimestamp(state, resumeAt - 1), false);
  assert.equal(shouldAcceptCaptureTimestamp(state, resumeAt), false);
  assert.equal(shouldAcceptCaptureTimestamp(state, resumeAt + 1), true);
  assert.equal(shouldAcceptCaptureTimestamp({ ...state, accepting: false }, resumeAt + 1), false);
  assert.equal(shouldAcceptCaptureTimestamp(state, Number.NaN), false);
});

test("cloud account auth is quiesced, invalidated, and reopened across Reset", async () => {
  const boundary = createConnectorResetBoundary();
  const auth = boundary.begin();
  assert.ok(auth);
  let resolveAuth!: () => void;
  const provider = new Promise<void>((resolve) => { resolveAuth = resolve; });
  const committedSessions: string[] = [];
  const signIn = (async () => {
    try {
      await provider;
      if (!auth.isCurrent()) return;
      committedSessions.push("stale-session");
    } finally {
      auth.finish();
    }
  })();

  let quiesced = false;
  const reset = boundary.quiesce().then(() => { quiesced = true; });
  await Promise.resolve();
  assert.equal(quiesced, false);
  assert.equal(boundary.begin(), null, "new auth must be rejected while Reset is active");

  resolveAuth();
  await Promise.all([signIn, reset]);
  assert.equal(quiesced, true);
  assert.deepEqual(committedSessions, []);

  boundary.reopen();
  const nextAuth = boundary.begin();
  assert.ok(nextAuth, "auth must reopen after Reset completes");
  nextAuth.finish();
});

test("AI generation starts stay closed for Reset's full synchronous window", async () => {
  const resetInProgressRef = { current: false };
  const providerStarts: string[] = [];
  const tryStart = async (workflow: string) => {
    if (isResetInProgress(resetInProgressRef)) return false;
    providerStarts.push(workflow);
    await Promise.resolve();
    return true;
  };
  const workflows = [
    "classification",
    "review-copilot",
    "forecast",
    "narrative",
    "acceleration",
    "visual-context",
  ];

  resetInProgressRef.current = true;
  for (const workflow of workflows) {
    assert.equal(await tryStart(workflow), false);
  }
  await Promise.resolve();
  for (const workflow of workflows) {
    assert.equal(await tryStart(`${workflow}-late`), false);
  }
  assert.deepEqual(providerStarts, []);

  resetInProgressRef.current = false;
  assert.equal(await tryStart("forecast-after-reset"), true);
  assert.deepEqual(providerStarts, ["forecast-after-reset"]);
});

test("a deferred local file read cannot repopulate state after reset", async () => {
  const boundary = createConnectorResetBoundary();
  const operation = boundary.begin();
  assert.ok(operation);
  let resolveRead!: (content: string) => void;
  const read = new Promise<string>((resolve) => { resolveRead = resolve; });
  const committed: string[] = [];
  const importWork = read.then((content) => {
    if (!operation.isCurrent()) return;
    committed.push(content);
  }).finally(operation.finish);

  const quiescence = boundary.quiesce();
  resolveRead("stale-import-after-reset");
  await importWork;
  await quiescence;

  assert.deepEqual(committed, []);
  assert.equal(boundary.begin(), null);
});

test("a reset boundary reopens even when no enabled operation changed state", async () => {
  const boundary = createConnectorResetBoundary();
  await boundary.quiesce();
  assert.equal(boundary.begin(), null);

  boundary.reopen();
  const operation = boundary.begin();
  assert.ok(operation, "an explicit post-reset enable can start work without remounting");
  operation.finish();
});

test("aggregate-share reset waits for a deferred upload and rejects its stale completion", async () => {
  const barrier = createCloudSyncOperationBarrier();
  const operation = barrier.begin();
  assert.ok(operation);

  let resolveUpload!: () => void;
  const deferredUpload = new Promise<void>((resolve) => { resolveUpload = resolve; });
  let freshCheckPassed = false;
  let successStateWrites = 0;
  let successAudits = 0;
  let consentReceipts = 0;

  const upload = (async () => {
    try {
      freshCheckPassed = true;
      await deferredUpload;
      if (!operation.isCurrent()) return false;
      successStateWrites += 1;
      successAudits += 1;
      consentReceipts += 1;
      return true;
    } finally {
      operation.finish();
    }
  })();

  assert.equal(freshCheckPassed, true);
  let quiesced = false;
  const quiescence = barrier.quiesce().then(() => { quiesced = true; });
  await Promise.resolve();

  assert.equal(quiesced, false, "reset must wait for an upload already past its fresh check");
  assert.equal(barrier.begin(), null, "reset must synchronously reject new aggregate operations");

  resolveUpload();
  assert.equal(await upload, false);
  await quiescence;
  assert.equal(quiesced, true);
  assert.equal(successStateWrites, 0);
  assert.equal(successAudits, 0);
  assert.equal(consentReceipts, 0);

  barrier.reopen();
  const resumedOperation = barrier.begin();
  assert.ok(resumedOperation);
  resumedOperation.finish();
});

test("calendar reset waits for deferred connect and sync commands without applying late events or audits", async () => {
  const boundary = createConnectorResetBoundary();
  const connectOperation = boundary.begin();
  const syncOperation = boundary.begin();
  assert.ok(connectOperation);
  assert.ok(syncOperation);

  let resolveConnect!: () => void;
  let resolveSync!: () => void;
  const connectCommand = new Promise<void>((resolve) => { resolveConnect = resolve; });
  const syncCommand = new Promise<void>((resolve) => { resolveSync = resolve; });
  const appliedEvents: string[] = [];
  const auditEvents: string[] = [];

  const connect = (async () => {
    try {
      await connectCommand;
      if (!connectOperation.isCurrent()) return;
      appliedEvents.push("calendar-connect-events");
      auditEvents.push("calendar-connect-audit");
    } finally {
      connectOperation.finish();
    }
  })();
  const sync = (async () => {
    try {
      await syncCommand;
      if (!syncOperation.isCurrent()) return;
      appliedEvents.push("calendar-sync-events");
      auditEvents.push("calendar-sync-audit");
    } finally {
      syncOperation.finish();
    }
  })();

  let quiesced = false;
  const quiescence = boundary.quiesce().then(() => { quiesced = true; });
  await Promise.resolve();
  assert.equal(quiesced, false);
  assert.equal(boundary.begin(), null);

  resolveConnect();
  resolveSync();
  await Promise.all([connect, sync, quiescence]);
  assert.equal(quiesced, true);
  assert.deepEqual(appliedEvents, []);
  assert.deepEqual(auditEvents, []);
});

test("chat reset waits for deferred connect, transfer, configure, and sync commands without late commits", async () => {
  const boundary = createConnectorResetBoundary();
  const commandNames = ["connect", "transfer", "configure", "sync"] as const;
  const releases = new Map<string, () => void>();
  const committedState: string[] = [];
  const committedAudits: string[] = [];

  const commands = commandNames.map((commandName) => {
    const operation = boundary.begin();
    assert.ok(operation);
    const nativeCommand = new Promise<void>((resolve) => { releases.set(commandName, resolve); });
    return (async () => {
      try {
        await nativeCommand;
        if (!operation.isCurrent()) return;
        committedState.push(commandName);
        committedAudits.push(commandName);
      } finally {
        operation.finish();
      }
    })();
  });

  let quiesced = false;
  const quiescence = boundary.quiesce().then(() => { quiesced = true; });
  await Promise.resolve();
  assert.equal(quiesced, false);
  assert.equal(boundary.begin(), null);

  for (const release of releases.values()) release();
  await Promise.all([...commands, quiescence]);
  assert.equal(quiesced, true);
  assert.deepEqual(committedState, []);
  assert.deepEqual(committedAudits, []);
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

test("every AI entry and Agent action surface shares the Reset start fence", () => {
  const hooks = [
    ["useClassification.ts", "async function classifyActiveWindowSessions"],
    ["useReviewCopilot.ts", "async function generateReviewCopilotSuggestions"],
    ["useForecastAgent.ts", "async function generateForecastAgent"],
    ["useNarrativeGeneration.ts", "async function regenerateNarrative"],
    ["useAcceleration.ts", "async function generateAccelerationPlays"],
    ["useVisualContext.ts", "async function captureVisualContext"],
  ] as const;
  for (const [hook, entryMarker] of hooks) {
    const source = readFileSync(new URL(`../hooks/${hook}`, import.meta.url), "utf8");
    const entry = source.slice(source.indexOf(entryMarker), source.indexOf("const provider", source.indexOf(entryMarker)));
    assert.match(source, /resetInProgressRef: ResetInProgressRef/, hook);
    assert.match(entry, /isResetInProgress\(resetInProgressRef\)/, hook);
  }

  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  for (const hookCall of [
    "useClassification",
    "useReviewCopilot",
    "useForecastAgent",
    "useNarrativeGeneration",
    "useAcceleration",
    "useVisualContext",
  ]) {
    const callStart = app.indexOf(`${hookCall}({`);
    assert.ok(callStart >= 0, `${hookCall} must be called`);
    assert.match(app.slice(callStart, callStart + 320), /resetInProgressRef,/, hookCall);
  }
  const narrativeAutoStart = app.indexOf("setLastNarrativeAutoRunDate(todayKey)");
  const visualAutoStart = app.indexOf("setVisualContextAttemptedSessionIds((current)");
  assert.match(app.slice(narrativeAutoStart - 500, narrativeAutoStart), /resetInProgressRef\.current/);
  assert.match(app.slice(visualAutoStart - 1_200, visualAutoStart), /resetInProgressRef\.current/);

  const router = readFileSync(new URL("../components/shell/ScreenRouter.tsx", import.meta.url), "utf8");
  const agent = readFileSync(new URL("../components/agent/AgentScreen.tsx", import.meta.url), "utf8");
  assert.match(router, /const aiActionsAvailable = aiAvailable && !isResettingLocalData/);
  assert.match(router, /<AgentScreen[\s\S]*?isResettingLocalData=\{isResettingLocalData\}/);
  assert.match(agent, /isResettingLocalData: boolean/);
  assert.match(agent, /function requestAgentAction[\s\S]*?if \(isResettingLocalData\)/);
  assert.match(agent, /async function sendMessage[\s\S]*?if \([^\n]*aiActionsDisabled\) return/);
  assert.match(agent, /async function runAssistantTurn[\s\S]*?if \(aiActionsDisabled\) return/);
  assert.match(agent, /async function approvePendingAction[\s\S]*?aiActionsDisabled\) return/);
  assert.match(agent, /function retryMessage[\s\S]*?if \(isSending \|\| aiActionsDisabled\) return/);
  assert.match(agent, /disabled=\{isSending \|\| aiActionsDisabled\}/);
  assert.match(agent, /disabled=\{!input\.trim\(\) \|\| isSending \|\| aiActionsDisabled\}/);

  const daily = readFileSync(new URL("../components/review/DailyReviewScreen.tsx", import.meta.url), "utf8");
  const review = readFileSync(new URL("../components/review/ReviewCopilotPanel.tsx", import.meta.url), "utf8");
  const forecast = readFileSync(new URL("../components/capacity/ForecastAgentPanel.tsx", import.meta.url), "utf8");
  const narrative = readFileSync(new URL("../components/narrative/NarrativeScreen.tsx", import.meta.url), "utf8");
  const acceleration = readFileSync(new URL("../components/accelerate/AccelerationScreen.tsx", import.meta.url), "utf8");
  const setup = readFileSync(new URL("../components/settings/SetupScreen.tsx", import.meta.url), "utf8");
  assert.match(daily, /<ReviewCopilotPanel[\s\S]*?aiAvailable=\{aiAvailable\}/);
  assert.match(review, /onRetry=\{aiAvailable \? onGenerate : undefined\}/);
  assert.match(forecast, /onRetry=\{aiAvailable \? onGenerate : undefined\}/);
  assert.match(narrative, /onRetry=\{aiAvailable \? onRegenerate : undefined\}/);
  assert.match(acceleration, /onRetry=\{aiConfigured \? onGenerateSkills : undefined\}/);
  assert.match(setup, /disabled=\{isResettingLocalData \|\| \(!visualContextEnabled && !aiAvailable\)\}/);
  assert.match(app, /function changeVisualContextEnabled[\s\S]*?if \(resetInProgressRef\.current\) return/);
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
  assert.match(app, /const personalSyncQuiescence\s*=\s*personalCloud\.quiesceForReset\(\)/);
  assert.match(app, /const aggregateSyncQuiescence\s*=\s*cloudSync\.quiesceForReset\(\)/);
  assert.match(app, /const cloudAccountQuiescence\s*=\s*cloudAccount\.quiesceForReset\(\)/);
  assert.ok(
    app.indexOf("cloudSync.quiesceForReset()") < app.indexOf("cloudAccount.clearAll()"),
    "aggregate sync must close before cloud account deletion",
  );
  assert.ok(
    app.indexOf("cloudAccount.quiesceForReset()") < app.indexOf("cloudAccount.clearAll()"),
    "account auth and writes must close before cloud account deletion",
  );
  assert.match(app, /aggregate_sync_quiesced_before_clear:\s*aggregateSyncQuiesced/);
  assert.match(app, /cloud_account_quiesced_before_clear:\s*cloudAccountQuiesced/);
  assert.match(router, /resetGeneration=\{agentResetGeneration\}/);
  assert.match(agent, /resetGeneration: number/);
  assert.match(agent, /agentOperationEpochRef\.current \+= 1/);
  assert.match(agent, /abortControllerRef\.current\?\.abort\(\)/);
  assert.match(agent, /clearAgentSessionStorage\(\)/);
  assert.match(app, /finally\s*\{[\s\S]*?personalCloud\.resumeAfterReset\(\)/);
  assert.match(app, /finally\s*\{[\s\S]*?cloudAccount\.resumeAfterReset\(\)/);
});

test("cloud account hook and settings UI reject auth and persistence while Reset is active", () => {
  const account = readFileSync(new URL("../hooks/useCloudAccount.ts", import.meta.url), "utf8");
  const panel = readFileSync(
    new URL("../components/settings/CloudAccountPanel.tsx", import.meta.url),
    "utf8",
  );
  const setup = readFileSync(
    new URL("../components/settings/SetupScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(account, /accountResetClosedRef\.current\s*=\s*true[\s\S]*?accountOperationBoundary\.quiesce\(\)/);
  assert.match(account, /const signIn\s*=\s*useCallback\([\s\S]*?accountOperationBoundary\.begin\(\)/);
  assert.match(account, /const signInWithOAuthProvider\s*=\s*useCallback\([\s\S]*?accountOperationBoundary\.begin\(\)/);
  assert.match(account, /if \(!operation\.isCurrent\(\) \|\| epoch !== accountEpochRef\.current\) return false/);
  assert.match(account, /if \(isDemoMode \|\| !configured \|\| !hydrated \|\| accountResetClosedRef\.current\) return/);
  assert.match(panel, /<fieldset[\s\S]*?disabled=\{disabled\}[\s\S]*?aria-busy=\{disabled\}/);
  assert.match(setup, /<CloudAccountPanel\s+cloud=\{cloud\}\s+disabled=\{isResettingLocalData\}/);
});

test("aggregate manual and automatic uploads are owned by the reset barrier", () => {
  const source = readFileSync(new URL("../hooks/useCloudSync.ts", import.meta.url), "utf8");
  const manual = source.slice(source.indexOf("const syncNow"), source.indexOf("const deleteMySnapshots"));
  const automatic = source.slice(source.indexOf("const runAutoAttempt"), source.indexOf("// Re-plan on every change"));

  assert.match(source, /quiesceForReset:\s*\(\)\s*=>\s*Promise<void>/);
  assert.match(manual, /const operation\s*=\s*cloudOperationBarrier\.begin\(\)/);
  assert.match(automatic, /const operation\s*=\s*cloudOperationBarrier\.begin\(\)/);
  assert.match(manual, /await runAfterDurableSharedSnapshotReservation[\s\S]*?if \(!operation\.isCurrent\(\)\) return false/);
  assert.match(automatic, /await runAfterDurableSharedSnapshotReservation[\s\S]*?if \(!operation\.isCurrent\(\)\) return/);
  assert.match(manual, /if \(!operation\.isCurrent\(\)\) return Promise\.resolve\(RESET_INTERRUPTED_UPLOAD\)/);
  assert.match(automatic, /if \(!operation\.isCurrent\(\)\) return Promise\.resolve\(RESET_INTERRUPTED_UPLOAD\)/);
  assert.match(manual, /finally\s*\{[\s\S]*?operation\.finish\(\)/);
  assert.match(automatic, /finally\s*\{[\s\S]*?operation\.finish\(\)/);
});

test("calendar and chat controllers fence native work before Reset clears connector storage", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const calendar = readFileSync(new URL("../hooks/useCalendarSources.ts", import.meta.url), "utf8");
  const chat = readFileSync(new URL("../hooks/useChatSources.ts", import.meta.url), "utf8");
  const reset = app.slice(
    app.indexOf("async function resetLocalData"),
    app.indexOf("function importCalendarFile"),
  );

  for (const source of [calendar, chat]) {
    assert.match(source, /quiesceForReset:\s*\(\)\s*=>\s*Promise<void>/);
    assert.match(source, /clearNativeStateForReset:\s*\(\)\s*=>\s*Promise<boolean>/);
    assert.match(source, /resumeAfterReset:\s*\(\)\s*=>\s*void/);
    assert.match(source, /const operation\s*=\s*\w+OperationBoundary\.begin\(\)/);
    assert.match(source, /if \(!operation\.isCurrent\(\)\) return/);
    assert.match(source, /operation\.finish\(\)/);
  }

  assert.match(reset, /const calendarConnectorQuiescence\s*=\s*calendarSources\.quiesceForReset\(\)/);
  assert.match(reset, /const chatConnectorQuiescence\s*=\s*chatSources\.quiesceForReset\(\)/);
  assert.ok(
    reset.indexOf("calendarSources.quiesceForReset()")
      < reset.indexOf("calendarSources.clearNativeStateForReset()"),
    "calendar work must quiesce before native credential deletion",
  );
  assert.ok(
    reset.indexOf("chatSources.quiesceForReset()")
      < reset.indexOf("chatSources.clearNativeStateForReset()"),
    "chat work must quiesce before native credential/cursor deletion",
  );
  assert.match(reset, /finally\s*\{[\s\S]*?calendarSources\.resumeAfterReset\(\)/);
  assert.match(reset, /finally\s*\{[\s\S]*?chatSources\.resumeAfterReset\(\)/);
});

test("Reset closes file-import and backup operations before clearing durable state", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const setup = readFileSync(new URL("../components/settings/SetupScreen.tsx", import.meta.url), "utf8");
  const calendarPanel = readFileSync(new URL("../components/settings/CalendarSourcesPanel.tsx", import.meta.url), "utf8");
  const chatPanel = readFileSync(new URL("../components/settings/ChatSourcesPanel.tsx", import.meta.url), "utf8");
  const reset = app.slice(
    app.indexOf("async function resetLocalData"),
    app.indexOf("function readResetFencedTextFile"),
  );
  const reader = app.slice(
    app.indexOf("function readResetFencedTextFile"),
    app.indexOf("function importCalendarFile"),
  );
  const backup = app.slice(
    app.indexOf("async function exportFullBackup"),
    app.indexOf("async function resetLocalData"),
  );

  assert.match(reset, /localDataOperationBoundaryRef\.current!\.quiesce\(\)/);
  assert.match(reset, /reader\.readyState === FileReader\.LOADING[\s\S]*?reader\.abort\(\)/);
  assert.ok(
    reset.indexOf("await localDataOperationQuiescence") < reset.indexOf("clearPersistedState()"),
  );
  assert.match(reset, /finally\s*\{[\s\S]*?localDataOperationBoundaryRef\.current!\.reopen\(\)/);
  assert.match(reader, /const operation\s*=\s*localDataOperationBoundaryRef\.current!\.begin\(\)/);
  assert.match(reader, /reader\.onload[\s\S]*?if \(operation\.isCurrent\(\)\) onLoad/);
  assert.match(reader, /reader\.onerror[\s\S]*?if \(operation\.isCurrent\(\)\) onReadError/);
  assert.match(backup, /export_full_backup_with_journal[\s\S]*?if \(!operation\.isCurrent\(\)\) return/);
  assert.match(setup, /confirmDisabled=\{isExportingBackup \|\| isResettingLocalData\}/);
  assert.match(setup, /accept="\.csv,text\/csv"[\s\S]*?disabled=\{isResettingLocalData\}/);
  assert.match(calendarPanel, /accept="\.ics,text\/calendar"[\s\S]*?disabled=\{disabled \|\| !normalizedRange\}/);
  assert.match(chatPanel, /accept="\.json,application\/json"[\s\S]*?disabled=\{disabled\}/);
});

test("Reset cancels every native OAuth callback wait before awaiting connector quiescence", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const native = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const calendar = readFileSync(
    new URL("../../src-tauri/src/calendar_sources.rs", import.meta.url),
    "utf8",
  );
  const chat = readFileSync(
    new URL("../../src-tauri/src/chat_sources.rs", import.meta.url),
    "utf8",
  );
  const reset = app.slice(
    app.indexOf("async function resetLocalData"),
    app.indexOf("function importCalendarFile"),
  );

  assert.match(calendar, /static OAUTH_CALLBACK_GENERATION:\s*AtomicU64/);
  assert.match(calendar, /fn wait_for_callback\([\s\S]*?callback_generation:\s*u64/);
  assert.match(calendar, /if !oauth_callback_is_current\(callback_generation\)[\s\S]*?cancelled by Reset Local Data/);
  assert.match(calendar, /let callback_generation\s*=\s*current_oauth_callback_generation\(\)/);
  assert.match(calendar, /wait_for_callback\(listener, &state_for_wait, callback_generation\)/);

  assert.match(chat, /static OAUTH_CALLBACK_GENERATION:\s*AtomicU64/);
  assert.match(chat, /fn wait_for_callback\([\s\S]*?callback_generation:\s*u64/);
  assert.match(chat, /if !oauth_callback_is_current\(callback_generation\)[\s\S]*?cancelled by Reset Local Data/);
  assert.match(chat, /let callback_generation\s*=\s*current_oauth_callback_generation\(\)/);
  assert.match(chat, /wait_for_callback\([\s\S]*?callback_generation/);

  assert.match(native, /static CLOUD_OAUTH_CALLBACK_GENERATION:\s*AtomicU64/);
  assert.match(native, /wait_for_cloud_oauth_callback\([\s\S]*?callback_generation:\s*u64/);
  assert.match(native, /if !cloud_oauth_callback_is_current\(callback_generation\)[\s\S]*?cancelled by Reset Local Data/);
  assert.match(native, /fn cancel_pending_oauth_callbacks_for_reset\(\)[\s\S]*?calendar_sources::cancel_pending_oauth_callback\(\)[\s\S]*?chat_sources::cancel_pending_oauth_callback\(\)[\s\S]*?cancel_pending_cloud_oauth_callback\(\)/);
  assert.match(native, /cancel_pending_oauth_callbacks_for_reset,[\s\S]*?start_cloud_oauth,/);

  const cancelAt = reset.indexOf('invoke("cancel_pending_oauth_callbacks_for_reset")');
  const calendarWaitAt = reset.indexOf("await calendarConnectorQuiescence");
  const chatWaitAt = reset.indexOf("await chatConnectorQuiescence");
  assert.ok(cancelAt >= 0, "Reset must invoke the native OAuth callback cancellation command");
  assert.ok(cancelAt < calendarWaitAt, "calendar callback cancellation must precede quiescence wait");
  assert.ok(cancelAt < chatWaitAt, "chat callback cancellation must precede quiescence wait");
  assert.match(reset, /oauth_callbacks_cancelled_before_quiescence:\s*oauthCallbacksCancelled/);
});

test("calendar provider HTTP work uses bounded connect and total timeouts", () => {
  const calendar = readFileSync(
    new URL("../../src-tauri/src/calendar_sources.rs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(calendar, /reqwest::Client::new\(\)/);
  assert.match(calendar, /fn calendar_http_client\(\)[\s\S]*?\.connect_timeout\(CALENDAR_HTTP_CONNECT_TIMEOUT\)[\s\S]*?\.timeout\(CALENDAR_HTTP_TOTAL_TIMEOUT\)/);
  assert.match(calendar, /async fn refresh_access_token[\s\S]*?calendar_http_client\(\)\?/);
  assert.match(calendar, /async fn fetch_google[\s\S]*?calendar_http_client\(\)\?/);
  assert.match(calendar, /async fn fetch_outlook[\s\S]*?calendar_http_client\(\)\?/);
});

test("pause and reset close the renderer capture gate before native work can finish", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../hooks/useActiveWindow.ts", import.meta.url), "utf8");
  const reset = app.slice(
    app.indexOf("async function resetLocalData"),
    app.indexOf("function importCalendarFile"),
  );

  assert.match(app, /useActiveWindow\(\{\s*captureAcceptingRef,/);
  assert.match(hook, /captureAcceptingRef:\s*React\.MutableRefObject<boolean>/);
  assert.match(hook, /captureAcceptAfterMsRef:\s*React\.MutableRefObject<number>/);
  assert.match(hook, /if \(!captureAcceptingRef\.current\) return;/);
  assert.match(hook, /shouldAcceptCaptureTimestamp\(/);
  assert.match(app, /if \(!canChangeCapturePaused\(resetInProgressRef\.current, nextPaused\)\) return false/);
  assert.match(app, /requestCapturePaused\(!pausedRef\.current\)/);
  assert.match(app, /if \(!requestCapturePaused\(false\)\) return/);
  assert.equal((app.match(/setPaused=\{requestCapturePaused\}/g) ?? []).length, 2);
  assert.match(app, /onEnableTracking=\{\(\) => \{\s*requestCapturePaused\(false\)/);
  assert.ok(
    reset.indexOf("requestCapturePaused(true)") <
      reset.indexOf('invoke("set_activity_capture_paused"'),
    "queued renderer events must be rejected before reset awaits the native pause barrier",
  );
});

test("startup Store and native-journal hydration share the reset epoch fence", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const hydration = app.slice(
    app.indexOf("// Async load persisted state"),
    app.indexOf("const initialBlocks"),
  );
  const reset = app.slice(
    app.indexOf("async function resetLocalData"),
    app.indexOf("function importCalendarFile"),
  );

  assert.match(hydration, /const hydrationToken\s*=\s*startupHydrationEpochRef\.current!\.start\(\)/);
  assert.match(hydration, /read_capture_journal[\s\S]*?isCurrent\(hydrationToken\)[\s\S]*?setActiveWindowSamples/);
  assert.match(hydration, /read_capture_journal_sessions[\s\S]*?isCurrent\(hydrationToken\)[\s\S]*?setJournalSessionWindow/);
  assert.match(reset, /startupHydrationEpochRef\.current!\.invalidate\(\)/);
  assert.match(hydration, /startupHydrationBarrierRef\.current\s*=\s*hydration/);
  assert.ok(
    reset.indexOf("await startupHydrationQuiescence") < reset.indexOf("clearPersistedState()"),
    "durable hydration migrations must settle before Reset clears Store and Keychain state",
  );
});

test("reset unconditionally asks native Codex storage to disconnect", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const setup = readFileSync(new URL("../components/settings/SetupScreen.tsx", import.meta.url), "utf8");
  const reset = app.slice(
    app.indexOf("async function resetLocalData"),
    app.indexOf("function importCalendarFile"),
  );

  assert.match(reset, /const codexCredentialsCleared\s*=\s*!isTauriRuntime\s*\|\|\s*await invoke\("disconnect_codex"\)/);
  assert.doesNotMatch(reset, /!isCodexConnection\(aiConfig\)/);
  assert.match(reset, /aiConnectionGateRef\.current!\.close\(\)/);
  assert.match(reset, /aiConnectionGateRef\.current!\.open\(\)/);
  assert.match(app, /connectViaCodexPlanFromWizard[\s\S]*?isCurrent\(connectionToken\)[\s\S]*?setAiConfig/);
  assert.match(setup, /testConnection[\s\S]*?isCurrent\(connectionToken\)[\s\S]*?setAiConfig/);
  assert.match(setup, /connectCodexPlan[\s\S]*?isCurrent\(connectionToken\)[\s\S]*?setAiConfig/);
  assert.match(setup, /testConnection[\s\S]*?if \(isResettingLocalData\) return/);
  assert.match(setup, /connectCodexPlan[\s\S]*?if \(isResettingLocalData\) return/);
});
