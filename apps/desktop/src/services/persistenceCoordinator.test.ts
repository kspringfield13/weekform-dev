import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { AIConfig } from "../../../../packages/domain/src/models";
import {
  AI_PROVIDER_LEGACY_KEYCHAIN_ACCOUNT,
  appendAIProviderCredentialBindingToStoreState,
  aiProviderKeychainAccount,
  clearOwnedAIProviderCredentials,
  collectAIProviderCredentialBindings,
  commitAIProviderCredentialRotation,
  commitStoreValueWithRollback,
  encodeAIProviderSecretEnvelope,
  readAIProviderCredentialForBinding,
  readAIProviderSecretEnvelope,
  sanitizeAIConfigForPersistence,
  sanitizePersistedAuditEvents,
} from "./localStore";
import { createPersistenceCoordinator } from "./persistenceCoordinator";

const persistenceHookSource = readFileSync(
  new URL("../hooks/usePersistence.ts", import.meta.url),
  "utf8",
);
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const localStoreSource = readFileSync(new URL("./localStore.ts", import.meta.url), "utf8");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("provider credentials are removed before general persistence", () => {
  const config: AIConfig = {
    provider: "openai",
    connectionMode: "api_key",
    apiKey: "sk-sensitive-paid-key",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4",
  };

  const persisted = sanitizeAIConfigForPersistence(config);

  assert.equal(persisted?.apiKey, "");
  assert.equal(persisted?.provider, "openai");
  assert.equal(config.apiKey, "sk-sensitive-paid-key", "redaction must not mutate live config");
  assert.ok(!JSON.stringify(persisted).includes("sk-sensitive-paid-key"));
});

test("Keychain credentials hydrate only when their Store binding matches", () => {
  const binding = "6f986ff5-9391-4bc5-8a15-c4f616482f2f";
  const envelope = encodeAIProviderSecretEnvelope("sk-sensitive-paid-key", binding);

  assert.equal(readAIProviderSecretEnvelope(envelope, binding), "sk-sensitive-paid-key");
  assert.equal(
    readAIProviderSecretEnvelope(envelope, "6f986ff5-9391-4bc5-8a15-c4f616482f20"),
    null,
    "a crash must never bind a new Keychain key to stale provider metadata",
  );
  assert.equal(readAIProviderSecretEnvelope("not-json", binding), null);
});

function fakeCredentialKeychain(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    bridge: {
      get: async (account: string) => entries.get(account) ?? null,
      set: async (account: string, value: string) => {
        entries.set(account, value);
      },
      delete: async (account: string) => {
        entries.delete(account);
      },
    },
  };
}

test("Store failure removes the proposed binding entry and preserves the prior working credential", async () => {
  const oldBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f20";
  const newBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f21";
  let stagedState: { aiCredentialBinding: string | null } = { aiCredentialBinding: oldBinding };
  let durableState = { ...stagedState };
  let failNextSave = true;
  const store = {
    set: async (_key: string, value: unknown) => {
      stagedState = value as typeof stagedState;
    },
    delete: async () => {
      stagedState = { aiCredentialBinding: null };
    },
    save: async () => {
      if (failNextSave) {
        failNextSave = false;
        throw new Error("synthetic Store save failure");
      }
      durableState = { ...stagedState };
    },
  };
  const oldAccount = aiProviderKeychainAccount(oldBinding);
  const newAccount = aiProviderKeychainAccount(newBinding);
  const keychain = fakeCredentialKeychain({
    [oldAccount]: encodeAIProviderSecretEnvelope("sk-old-working-key", oldBinding),
  });

  await assert.rejects(
    commitAIProviderCredentialRotation({
      apiKey: "sk-new-key",
      previousBinding: oldBinding,
      createBinding: () => newBinding,
      keychain: keychain.bridge,
      commitBinding: (binding) => commitStoreValueWithRollback(
        store,
        "appState",
        { aiCredentialBinding: oldBinding },
        { aiCredentialBinding: binding },
      ),
    }),
    /synthetic Store save failure/,
  );

  assert.equal(stagedState.aiCredentialBinding, oldBinding);
  assert.equal(durableState.aiCredentialBinding, oldBinding);
  assert.equal(keychain.entries.has(newAccount), false, "the uncommitted entry is not retained");
  assert.equal(
    await readAIProviderCredentialForBinding(keychain.bridge, durableState.aiCredentialBinding),
    "sk-old-working-key",
  );
});

test("a proposed binding is durably registered before Keychain write so failed rollback remains resettable", async () => {
  const newBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f21";
  const newAccount = aiProviderKeychainAccount(newBinding);
  const keychain = fakeCredentialKeychain();
  let registeredBindings: string[] = [];
  let failCleanup = true;
  const originalDelete = keychain.bridge.delete;
  keychain.bridge.delete = async (account: string) => {
    if (account === newAccount && failCleanup) {
      throw new Error("synthetic cleanup failure");
    }
    await originalDelete(account);
  };

  await assert.rejects(
    commitAIProviderCredentialRotation({
      apiKey: "sk-new-key",
      previousBinding: null,
      createBinding: () => newBinding,
      keychain: keychain.bridge,
      registerBinding: async (binding) => {
        registeredBindings = collectAIProviderCredentialBindings(registeredBindings, binding);
      },
      commitBinding: async () => {
        throw new Error("synthetic Store pointer failure");
      },
    }),
    /could not remove the uncommitted Keychain entry/,
  );

  assert.equal(keychain.entries.has(newAccount), true);
  assert.deepEqual(registeredBindings, [newBinding]);

  failCleanup = false;
  await clearOwnedAIProviderCredentials(keychain.bridge, registeredBindings);
  assert.equal(keychain.entries.has(newAccount), false);
});

test("credential preregistration preserves the previous pointer and AI metadata while appending reset ownership", () => {
  const oldBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f20";
  const proposedBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f21";
  const previousStoreState = {
    version: 1,
    aiConfig: {
      provider: "openai",
      connectionMode: "api_key",
      apiKey: "",
      baseUrl: "https://old-provider.example/v1",
      model: "old-model",
    },
    aiCredentialBinding: oldBinding,
    aiCredentialBindings: [oldBinding],
    unrelatedState: { durable: "keep-exactly" },
  };

  const registered = appendAIProviderCredentialBindingToStoreState(
    previousStoreState,
    proposedBinding,
  );

  assert.deepEqual(registered, {
    ...previousStoreState,
    aiCredentialBindings: [oldBinding, proposedBinding],
  });
  assert.equal(registered.aiCredentialBinding, oldBinding);
  assert.equal(registered.aiConfig, previousStoreState.aiConfig);
  assert.equal(registered.unrelatedState, previousStoreState.unrelatedState);
});

test("a failed pointer commit and failed cleanup leave only the proposed registry appended to the previous Store generation", async () => {
  const oldBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f20";
  const proposedBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f21";
  const oldAccount = aiProviderKeychainAccount(oldBinding);
  const proposedAccount = aiProviderKeychainAccount(proposedBinding);
  const previousStoreState = {
    version: 1,
    aiConfig: {
      provider: "openai",
      connectionMode: "api_key",
      apiKey: "",
      baseUrl: "https://old-provider.example/v1",
      model: "old-model",
    },
    aiCredentialBinding: oldBinding,
    aiCredentialBindings: [oldBinding],
  };
  let durableStoreState = previousStoreState;
  const keychain = fakeCredentialKeychain({
    [oldAccount]: encodeAIProviderSecretEnvelope("sk-old-working-key", oldBinding),
  });
  const originalDelete = keychain.bridge.delete;
  keychain.bridge.delete = async (account: string) => {
    if (account === proposedAccount) throw new Error("synthetic cleanup failure");
    await originalDelete(account);
  };

  await assert.rejects(
    commitAIProviderCredentialRotation({
      apiKey: "sk-new-key",
      previousBinding: oldBinding,
      createBinding: () => proposedBinding,
      keychain: keychain.bridge,
      registerBinding: async (binding) => {
        durableStoreState = appendAIProviderCredentialBindingToStoreState(
          previousStoreState,
          binding,
        ) as typeof previousStoreState;
      },
      commitBinding: async () => {
        throw new Error("synthetic pointer commit failure");
      },
    }),
    /could not remove the uncommitted Keychain entry/,
  );

  assert.equal(durableStoreState.aiCredentialBinding, oldBinding);
  assert.equal(durableStoreState.aiConfig, previousStoreState.aiConfig);
  assert.deepEqual(durableStoreState.aiCredentialBindings, [oldBinding, proposedBinding]);
  assert.equal(keychain.entries.has(proposedAccount), true);
});

test("both embedded-secret and legacy-singleton migrations preregister before writing a binding-addressed Keychain entry", () => {
  const migrationSource = localStoreSource.slice(
    localStoreSource.indexOf("async function hydrateAIProviderSecret"),
    localStoreSource.indexOf("function parseGettingStartedStatus"),
  );
  const rotationCalls = [...migrationSource.matchAll(/commitAIProviderCredentialRotation\(\{([\s\S]*?)\n\s*\}\)/g)];

  assert.equal(rotationCalls.length, 2, "both legacy migration paths must remain explicit");
  for (const call of rotationCalls) {
    assert.match(call[1] ?? "", /registerBinding:\s*registerMigratedBinding/);
  }
});

test("an interrupted rotation cannot attach its uncommitted secret to the old Store pointer", async () => {
  const oldBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f20";
  const interruptedBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f21";
  const keychain = fakeCredentialKeychain({
    [aiProviderKeychainAccount(oldBinding)]: encodeAIProviderSecretEnvelope(
      "sk-old-working-key",
      oldBinding,
    ),
    [aiProviderKeychainAccount(interruptedBinding)]: encodeAIProviderSecretEnvelope(
      "sk-uncommitted-new-key",
      interruptedBinding,
    ),
  });

  assert.equal(
    await readAIProviderCredentialForBinding(keychain.bridge, oldBinding),
    "sk-old-working-key",
  );
  assert.equal(
    readAIProviderSecretEnvelope(
      keychain.entries.get(aiProviderKeychainAccount(interruptedBinding)) ?? null,
      oldBinding,
    ),
    null,
  );
});

test("an interrupted legacy migration retains the legacy credential and removes the new orphan", async () => {
  const newBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f21";
  let persistedBinding: string | null = null;
  const keychain = fakeCredentialKeychain({
    [AI_PROVIDER_LEGACY_KEYCHAIN_ACCOUNT]: "sk-legacy-key",
  });

  await assert.rejects(
    commitAIProviderCredentialRotation({
      apiKey: "sk-legacy-key",
      previousBinding: null,
      createBinding: () => newBinding,
      cleanupLegacySingleton: true,
      keychain: keychain.bridge,
      commitBinding: async () => {
        throw new Error("synthetic migration interruption");
      },
    }),
    /synthetic migration interruption/,
  );

  assert.equal(persistedBinding, null);
  assert.equal(keychain.entries.get(AI_PROVIDER_LEGACY_KEYCHAIN_ACCOUNT), "sk-legacy-key");
  assert.equal(keychain.entries.has(aiProviderKeychainAccount(newBinding)), false);
});

test("credential rotation commits the new pointer before retiring the old entry", async () => {
  const oldBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f20";
  const newBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f21";
  let persistedBinding: string | null = oldBinding;
  const oldAccount = aiProviderKeychainAccount(oldBinding);
  const newAccount = aiProviderKeychainAccount(newBinding);
  const keychain = fakeCredentialKeychain({
    [oldAccount]: encodeAIProviderSecretEnvelope("sk-old-working-key", oldBinding),
  });

  const committed = await commitAIProviderCredentialRotation({
    apiKey: "sk-new-key",
    previousBinding: oldBinding,
    createBinding: () => newBinding,
    keychain: keychain.bridge,
    commitBinding: async (binding) => {
      assert.equal(keychain.entries.has(oldAccount), true, "old secret remains until commit");
      assert.equal(keychain.entries.has(newAccount), true, "new secret exists before pointer commit");
      persistedBinding = binding;
    },
  });

  assert.equal(committed, newBinding);
  assert.equal(persistedBinding, newBinding);
  assert.equal(keychain.entries.has(oldAccount), false);
  assert.equal(await readAIProviderCredentialForBinding(keychain.bridge, newBinding), "sk-new-key");
});

test("a failed retirement remains registered so Reset can delete every owned credential", async () => {
  const oldBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f20";
  const newBinding = "6f986ff5-9391-4bc5-8a15-c4f616482f21";
  const oldAccount = aiProviderKeychainAccount(oldBinding);
  const newAccount = aiProviderKeychainAccount(newBinding);
  const keychain = fakeCredentialKeychain({
    [oldAccount]: encodeAIProviderSecretEnvelope("sk-old-working-key", oldBinding),
  });
  let failOldRetirement = true;
  const originalDelete = keychain.bridge.delete;
  keychain.bridge.delete = async (account: string) => {
    if (account === oldAccount && failOldRetirement) {
      failOldRetirement = false;
      throw new Error("synthetic old-binding delete failure");
    }
    await originalDelete(account);
  };
  let registeredBindings = [oldBinding];

  const committed = await commitAIProviderCredentialRotation({
    apiKey: "sk-new-key",
    previousBinding: oldBinding,
    createBinding: () => newBinding,
    keychain: keychain.bridge,
    commitBinding: async (binding) => {
      registeredBindings = collectAIProviderCredentialBindings(registeredBindings, binding);
    },
  });

  assert.equal(committed, newBinding);
  assert.equal(keychain.entries.has(oldAccount), true, "failed retirement leaves the old secret live");
  assert.equal(keychain.entries.has(newAccount), true);
  assert.deepEqual(registeredBindings, [oldBinding, newBinding]);

  await clearOwnedAIProviderCredentials(keychain.bridge, registeredBindings);
  assert.equal(keychain.entries.has(oldAccount), false);
  assert.equal(keychain.entries.has(newAccount), false);
});

test("legacy per-sample audit rows cannot preserve plaintext window metadata", () => {
  const sanitized = sanitizePersistedAuditEvents([{
    event_id: "legacy-sensitive-sample",
    timestamp: "2026-07-20T12:00:00.000Z",
    type: "active_window_sample",
    source: "macos_active_window",
    title: "Active-window sample captured",
    summary: "Sensitive App - Customer Alpha renewal",
    privacy_level: "local_only",
    details: {
      app_name: "Sensitive App",
      window_title: "Customer Alpha renewal",
      stored_locally: true,
    },
  }]);

  assert.deepEqual(sanitized, []);
  assert.doesNotMatch(JSON.stringify(sanitized), /Sensitive App|Customer Alpha/);
});

test("persistence coordinator serializes writes and coalesces queued snapshots", async () => {
  const firstWrite = deferred();
  const writes: number[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const coordinator = createPersistenceCoordinator<number>(async (value) => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    writes.push(value);
    if (value === 1) await firstWrite.promise;
    concurrent -= 1;
  });

  const first = coordinator.schedule(1);
  await Promise.resolve();
  const superseded = coordinator.schedule(2);
  const latest = coordinator.schedule(3);
  firstWrite.resolve();
  await Promise.all([first, superseded, latest]);

  assert.deepEqual(writes, [1, 3]);
  assert.equal(maxConcurrent, 1);
});

test("verified clear waits for in-flight writes and invalidates queued stale snapshots", async () => {
  const firstWrite = deferred();
  const events: string[] = [];
  const coordinator = createPersistenceCoordinator<string>(async (value) => {
    events.push(`write:${value}:start`);
    if (value === "old") await firstWrite.promise;
    events.push(`write:${value}:end`);
  });

  const oldWrite = coordinator.schedule("old");
  await Promise.resolve();
  const staleWrite = coordinator.schedule("stale");
  const clear = coordinator.clear(async () => {
    events.push("clear");
  });
  firstWrite.resolve();
  await Promise.all([oldWrite, staleWrite, clear]);

  assert.deepEqual(events, ["write:old:start", "write:old:end", "clear"]);

  await coordinator.schedule("fresh");
  assert.equal(events.at(-1), "write:fresh:end");
});

test("writes scheduled during an exclusive clear are discarded", async () => {
  const firstWrite = deferred();
  const clearEntered = deferred();
  const clearGate = deferred();
  const events: string[] = [];
  const coordinator = createPersistenceCoordinator<string>(async (value) => {
    events.push(`write:${value}:start`);
    if (value === "old") await firstWrite.promise;
    events.push(`write:${value}:end`);
  });

  const oldWrite = coordinator.schedule("old");
  await Promise.resolve();
  const staleWrite = coordinator.schedule("stale");
  const clear = coordinator.clear(async () => {
    events.push("clear:start");
    clearEntered.resolve();
    await clearGate.promise;
    events.push("clear:end");
  });
  firstWrite.resolve();
  await clearEntered.promise;

  const duringClear = coordinator.schedule("during-clear");
  clearGate.resolve();
  await Promise.all([oldWrite, staleWrite, duringClear, clear]);

  assert.deepEqual(events, [
    "write:old:start",
    "write:old:end",
    "clear:start",
    "clear:end",
  ]);
  await coordinator.schedule("fresh");
  assert.equal(events.at(-1), "write:fresh:end");
});

test("concurrent clears share one exclusive deletion", async () => {
  const clearEntered = deferred();
  const clearGate = deferred();
  let firstClearCount = 0;
  let secondClearCount = 0;
  const coordinator = createPersistenceCoordinator<string>(async () => undefined);

  const first = coordinator.clear(async () => {
    firstClearCount += 1;
    clearEntered.resolve();
    await clearGate.promise;
  });
  await clearEntered.promise;
  const second = coordinator.clear(async () => {
    secondClearCount += 1;
  });

  assert.equal(second, first, "concurrent callers await the same clear operation");
  clearGate.resolve();
  await Promise.all([first, second]);
  assert.equal(firstClearCount, 1);
  assert.equal(secondClearCount, 0);
});

test("a reset suspension discards stale snapshots until a known cleared snapshot resumes writes", async () => {
  const activeWrite = deferred();
  const events: string[] = [];
  const coordinator = createPersistenceCoordinator<string>(async (value) => {
    events.push(`write:${value}:start`);
    if (value === "active-before-reset") await activeWrite.promise;
    events.push(`write:${value}:end`);
  });

  const active = coordinator.schedule("active-before-reset");
  await Promise.resolve();
  const queuedBeforeReset = coordinator.schedule("queued-before-reset");
  const suspended = coordinator.suspend();

  // This models the React debounce callback firing after verified deletion but
  // before Reset has finished clearing the rest of the app's durable surfaces.
  const delayedPreResetSnapshot = coordinator.schedule("delayed-pre-reset");
  activeWrite.resolve();
  await Promise.all([active, queuedBeforeReset, delayedPreResetSnapshot, suspended]);
  await coordinator.clear(async () => {
    events.push("clear");
  });
  await coordinator.schedule("timer-fired-after-clear");

  coordinator.resume();
  await coordinator.schedule("known-cleared-state");

  assert.deepEqual(events, [
    "write:active-before-reset:start",
    "write:active-before-reset:end",
    "clear",
    "write:known-cleared-state:start",
    "write:known-cleared-state:end",
  ]);
});

test("React persistence coalesces bursts and excludes native journal samples from its trigger", () => {
  assert.match(persistenceHookSource, /PERSISTENCE_DEBOUNCE_MS\s*=\s*250/);
  assert.match(
    persistenceHookSource,
    /samplesForPersistence\s*=\s*isTauriRuntime\s*\?\s*EMPTY_NATIVE_SAMPLES\s*:\s*persistData\.activeWindowSamples/,
  );
  assert.match(persistenceHookSource, /setTimeout\([\s\S]*?PERSISTENCE_DEBOUNCE_MS/);
  assert.match(persistenceHookSource, /activeWindowSamples:\s*samplesForPersistence/);
  assert.doesNotMatch(
    persistenceHookSource.slice(persistenceHookSource.indexOf("}, [")),
    /persistData\.activeWindowSamples/,
  );
});

test("React persistence exposes an awaitable barrier for the latest rendered snapshot", () => {
  assert.match(persistenceHookSource, /latestSnapshotRef/);
  assert.match(persistenceHookSource, /const flushLatest\s*=\s*useCallback/);
  assert.match(persistenceHookSource, /await writeCoordinator\.schedule\(latestSnapshotRef\.current\)/);
  assert.match(persistenceHookSource, /suspendForReset/);
  assert.match(persistenceHookSource, /resumeAfterReset/);
  assert.match(
    persistenceHookSource,
    /return\s+useMemo\([\s\S]*?\(\)\s*=>\s*\(\{\s*flushLatest,\s*suspendForReset,\s*resumeAfterReset/,
  );
  assert.match(appSource, /const appPersistence\s*=\s*usePersistence\(/);
  assert.match(appSource, /persistLatestLocalState:\s*appPersistence\.flushLatest/);
});

test("reset fences local operations, persistence, hydration, cloud, and connectors before verified deletion", () => {
  const resetSource = appSource.slice(
    appSource.indexOf("async function resetLocalData"),
    appSource.indexOf("function importCalendarFile"),
  );

  const suspendAt = resetSource.indexOf("appPersistence.suspendForReset()");
  const localDataQuiesceAt = resetSource.indexOf("localDataOperationBoundaryRef.current!.quiesce()");
  const personalQuiesceAt = resetSource.indexOf("personalCloud.quiesceForReset()");
  const aggregateQuiesceAt = resetSource.indexOf("cloudSync.quiesceForReset()");
  const accountQuiesceAt = resetSource.indexOf("cloudAccount.quiesceForReset()");
  const calendarQuiesceAt = resetSource.indexOf("calendarSources.quiesceForReset()");
  const chatQuiesceAt = resetSource.indexOf("chatSources.quiesceForReset()");
  const clearAt = resetSource.indexOf("clearPersistedState()");
  assert.ok(suspendAt >= 0, "reset must synchronously close the persistence write lane");
  assert.ok(
    localDataQuiesceAt >= 0
      && localDataQuiesceAt < suspendAt
      && suspendAt < personalQuiesceAt
      && personalQuiesceAt < aggregateQuiesceAt
      && aggregateQuiesceAt < accountQuiesceAt
      && accountQuiesceAt < calendarQuiesceAt
      && calendarQuiesceAt < chatQuiesceAt
      && chatQuiesceAt < clearAt,
    "cloud, connector, hydration, and persistence work must be quiescent before destructive clear",
  );
  assert.match(
    resetSource,
    /const resetWriteBoundariesQuiesced\s*=\s*personalSyncQuiesced\s*&&\s*aggregateSyncQuiesced\s*&&\s*cloudAccountQuiesced\s*&&\s*calendarConnectorQuiesced\s*&&\s*chatConnectorQuiesced\s*&&\s*startupHydrationQuiesced\s*&&\s*localDataOperationsQuiesced\s*&&\s*persistenceWritesQuiesced;[\s\S]*?const persistedStateCleared\s*=\s*resetWriteBoundariesQuiesced[\s\S]*?await clearPersistedState\(\)/,
  );
  assert.match(
    resetSource,
    /const cloudCredentialsCleared\s*=\s*resetWriteBoundariesQuiesced[\s\S]*?await cloudAccount\.clearAll\(\)/,
  );
  assert.match(resetSource, /finally\s*\{[\s\S]*?appPersistence\.resumeAfterReset\(\)/);
  assert.match(resetSource, /const capturePaused\s*=/);
  assert.ok(
    resetSource.indexOf("const capturePaused") < resetSource.indexOf("clear_capture_journal"),
    "native capture must be paused before its journal is cleared",
  );
  assert.match(resetSource, /persisted_state_cleared:\s*persistedStateCleared/);
  assert.match(resetSource, /provider_api_key_cleared:\s*persistedStateCleared/);
});

test("native journal startup is bounded and retention failures are visible", () => {
  assert.match(appSource, /"read_capture_journal",\s*\{\s*limit:\s*2000\s*\}/);
  assert.match(appSource, /Could not apply the capture retention policy/);
  assert.doesNotMatch(
    appSource,
    /invoke\("prune_capture_journal"[\s\S]{0,180}\.catch\(\(\) => undefined\)/,
  );
});

test("failed hydration blocks overwrite and remains visible instead of becoming an empty workspace", () => {
  assert.doesNotMatch(
    readFileSync(new URL("./localStore.ts", import.meta.url), "utf8"),
    /export async function readPersistedState[\s\S]*?catch\s*\{\s*return null;\s*\}/,
  );
  const hydrationSource = appSource.slice(
    appSource.indexOf("// Async load persisted state"),
    appSource.indexOf("const initialBlocks"),
  );
  assert.match(hydrationSource, /Saved Weekform data could not be loaded/);
  assert.match(hydrationSource, /present_main_window/);
  assert.doesNotMatch(hydrationSource, /import_capture_journal_samples[\s\S]{0,500}\.catch\(\(\) => undefined\)/);
});
