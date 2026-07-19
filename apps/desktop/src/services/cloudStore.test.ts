// Focused tests for the cloud-state persistence wrapper's localStorage fallback path
// (the branch every non-Tauri build takes) plus its "no storage at all" degradation.
// Run: npm run test:desktop-cloud   (tsx --test)
//
// The Tauri Store branch requires `window.__TAURI_INTERNALS__` and the live plugin
// IPC, so it is exercised only in the real app; here `window` is stubbed with a
// plain-object localStorage so the serialize → parse round-trip and the defensive
// read paths are covered deterministically.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultCloudState,
  parsePersistedCloudState,
  type PersistedCloudStateV1
} from "./cloudPolicy";
import {
  clearPersistedCloudState,
  readPersistedCloudState,
  writePersistedCloudState
} from "./cloudStore";

const CLOUD_STORAGE_KEY = "clear-capacity:cloud:v1"; // must match cloudStore.ts

interface FakeLocalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function makeFakeStorage(backing: Map<string, string>): FakeLocalStorage {
  return {
    getItem: (key) => (backing.has(key) ? (backing.get(key) as string) : null),
    setItem: (key, value) => {
      backing.set(key, String(value));
    },
    removeItem: (key) => {
      backing.delete(key);
    }
  };
}

/** Install a browser-less `window` (no __TAURI_INTERNALS__) for the duration of `run`. */
async function withWindow(
  localStorage: FakeLocalStorage,
  run: () => Promise<void>
): Promise<void> {
  const hadWindow = "window" in globalThis;
  const original = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = { localStorage };
  try {
    await run();
  } finally {
    if (hadWindow) {
      (globalThis as Record<string, unknown>).window = original;
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }
  }
}

function makeSignedInState(): PersistedCloudStateV1 {
  const state = createDefaultCloudState();
  return {
    ...state,
    session: {
      accessToken: "at-round-trip",
      refreshToken: "rt-round-trip",
      expiresAt: 1_800_000_000_000,
      userId: "user-1",
      email: "member@example.test",
      displayName: "Casey Vo",
      signedInAt: "2026-07-19T10:00:00.000Z"
    },
    policy: {
      ...state.policy,
      enabled: true,
      teamId: "team-1",
      consentedAt: "2026-07-19T10:00:00.000Z"
    },
    pendingSnapshot: { fingerprint: "fp-1", clientSnapshotId: "uuid-1" }
  };
}

// ---------------------------------------------------------------------------
// localStorage fallback: write → read round-trip
// ---------------------------------------------------------------------------

test("write → read round-trips a full signed-in state through the fallback store", async () => {
  const backing = new Map<string, string>();
  await withWindow(makeFakeStorage(backing), async () => {
    const state = makeSignedInState();
    await writePersistedCloudState(state);
    // Stored under the versioned key, as JSON that the parser accepts unchanged.
    assert.deepEqual([...backing.keys()], [CLOUD_STORAGE_KEY]);
    const read = await readPersistedCloudState();
    assert.deepEqual(read, state);
    // The round-trip goes through the defensive parser, not a blind JSON.parse.
    assert.deepEqual(read, parsePersistedCloudState(JSON.parse(backing.get(CLOUD_STORAGE_KEY) as string)));
  });
});

test("read returns null when nothing was ever stored", async () => {
  await withWindow(makeFakeStorage(new Map()), async () => {
    assert.equal(await readPersistedCloudState(), null);
  });
});

test("clear removes the stored state; a later read is null and write works again", async () => {
  const backing = new Map<string, string>();
  await withWindow(makeFakeStorage(backing), async () => {
    await writePersistedCloudState(makeSignedInState());
    assert.equal(backing.size, 1);
    await clearPersistedCloudState();
    assert.equal(backing.size, 0);
    assert.equal(await readPersistedCloudState(), null);
    await writePersistedCloudState(createDefaultCloudState());
    assert.equal((await readPersistedCloudState())?.session, null);
  });
});

// ---------------------------------------------------------------------------
// Defensive reads: corrupt JSON, garbage envelopes, hostile session blobs
// ---------------------------------------------------------------------------

test("corrupt (non-JSON) stored data reads as null, never a throw", async () => {
  const backing = new Map<string, string>([[CLOUD_STORAGE_KEY, "{not valid json"]]);
  await withWindow(makeFakeStorage(backing), async () => {
    assert.equal(await readPersistedCloudState(), null);
  });
});

test("a valid-JSON garbage envelope degrades to safe defaults (signed out, sharing off)", async () => {
  for (const garbage of ['"a string"', "[1,2,3]", '{"version":99,"session":{"accessToken":"x"}}']) {
    const backing = new Map<string, string>([[CLOUD_STORAGE_KEY, garbage]]);
    await withWindow(makeFakeStorage(backing), async () => {
      const read = await readPersistedCloudState();
      assert.ok(read);
      assert.equal(read?.session, null);
      assert.equal(read?.policy.enabled, false);
      assert.equal(read?.pendingSnapshot, null);
    });
  }
});

test("a v1 envelope with an incomplete session reads back signed out but keeps the policy", async () => {
  const stored = JSON.stringify({
    version: 1,
    session: { accessToken: "at-only" }, // missing refreshToken/userId/email → dropped
    policy: { ...createDefaultCloudState().policy, enabled: true, teamId: "team-1" },
    syncState: {},
    pendingSnapshot: null
  });
  const backing = new Map<string, string>([[CLOUD_STORAGE_KEY, stored]]);
  await withWindow(makeFakeStorage(backing), async () => {
    const read = await readPersistedCloudState();
    assert.ok(read);
    assert.equal(read?.session, null);
    assert.equal(read?.policy.teamId, "team-1");
  });
});

test("a throwing localStorage degrades every operation gracefully", async () => {
  const hostile: FakeLocalStorage = {
    getItem: () => {
      throw new Error("quota");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("quota");
    }
  };
  await withWindow(hostile, async () => {
    assert.equal(await readPersistedCloudState(), null);
    await assert.doesNotReject(writePersistedCloudState(createDefaultCloudState()));
    await assert.doesNotReject(clearPersistedCloudState());
  });
});

// ---------------------------------------------------------------------------
// No `window` at all (bare node): everything is a safe no-op
// ---------------------------------------------------------------------------

test("with no window object, read is null and write/clear never throw", async () => {
  assert.equal("window" in globalThis, false); // precondition of this environment
  assert.equal(await readPersistedCloudState(), null);
  await assert.doesNotReject(writePersistedCloudState(createDefaultCloudState()));
  await assert.doesNotReject(clearPersistedCloudState());
});
