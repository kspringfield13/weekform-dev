// Contract tests for the session storage adapter seam (sessionStorage.ts,
// expansion roadmap A4). Everything here is pure and dependency-injected —
// in-memory fake adapters and a fake keychain bridge, no Tauri, no real
// localStorage, no real Keychain (which is env-blocked until a packaged build
// exists; these tests prove the SEAM, they do not and cannot prove live
// Keychain storage).
// Run: npm run test:desktop-cloud   (tsx --test)

import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultCloudState,
  type PersistedCloudStateV1
} from "./cloudPolicy";
import {
  deleteCloudStateThrough,
  browserFallbackAllowed,
  createRevocationGuardedAdapter,
  createSerializedSessionStorageAdapter,
  keychainAvailable,
  keychainSessionStorageAdapter,
  readCloudStateThrough,
  resolveSessionStorageAdapter,
  writeCloudStateThrough,
  type KeychainBridge,
  type SessionStorageAdapter
} from "./sessionStorage";
import {
  clearPersistedCloudState,
  readPersistedCloudState,
  writePersistedCloudState
} from "./cloudStore";

// ---------------------------------------------------------------------------
// Fakes — in-memory adapter and keychain bridge, with call accounting so the
// "tokens never touch the fallback" claims are proven, not assumed.
// ---------------------------------------------------------------------------

interface FakeAdapter extends SessionStorageAdapter {
  stored: unknown;
  writes: number;
  deletes: number;
  reads: number;
}

function makeFakeAdapter(initial: unknown = null): FakeAdapter {
  const fake: FakeAdapter = {
    stored: initial,
    writes: 0,
    deletes: 0,
    reads: 0,
    async read() {
      fake.reads += 1;
      return fake.stored;
    },
    async write(state: PersistedCloudStateV1) {
      fake.writes += 1;
      // Store a structural clone (JSON round-trip) like a real serializer would.
      fake.stored = JSON.parse(JSON.stringify(state)) as unknown;
    },
    async delete() {
      fake.deletes += 1;
      fake.stored = null;
    }
  };
  return fake;
}

function makeSignedInState(): PersistedCloudStateV1 {
  const state = createDefaultCloudState();
  return {
    ...state,
    session: {
      accessToken: "at-adapter-contract",
      refreshToken: "rt-adapter-contract",
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
    pendingSnapshot: {
      fingerprint: "fp-1",
      clientSnapshotId: "11111111-2222-4333-8444-555555555555"
    }
  };
}

/** Install a browser-less `window` for the duration of `run` (mirrors cloudStore.test.ts). */
async function withWindow(
  windowValue: Record<string, unknown>,
  run: () => Promise<void>
): Promise<void> {
  const hadWindow = "window" in globalThis;
  const original = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = windowValue;
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

// ---------------------------------------------------------------------------
// Round-trip through the seam with a fake adapter
// ---------------------------------------------------------------------------

test("write → read round-trips a full signed-in state through a fake adapter", async () => {
  const adapter = makeFakeAdapter();
  const state = makeSignedInState();
  await writeCloudStateThrough(adapter, state);
  assert.equal(adapter.writes, 1);
  const read = await readCloudStateThrough(adapter);
  assert.deepEqual(read, state);
});

test("read through an empty adapter is null, never a throw", async () => {
  assert.equal(await readCloudStateThrough(makeFakeAdapter()), null);
});

// ---------------------------------------------------------------------------
// Corrupt-envelope degradation still works through the seam
// ---------------------------------------------------------------------------

test("garbage envelopes from any adapter degrade to safe defaults (signed out, sharing off)", async () => {
  for (const garbage of ["a string", [1, 2, 3], { version: 99, session: { accessToken: "x" } }]) {
    const read = await readCloudStateThrough(makeFakeAdapter(garbage));
    assert.ok(read);
    assert.equal(read?.session, null);
    assert.equal(read?.policy.enabled, false);
    assert.equal(read?.pendingSnapshot, null);
  }
});

test("a throwing adapter degrades every operation gracefully", async () => {
  const hostile: SessionStorageAdapter = {
    read: async () => {
      throw new Error("backend down");
    },
    write: async () => {
      throw new Error("backend down");
    },
    delete: async () => {
      throw new Error("backend down");
    }
  };
  assert.equal(await readCloudStateThrough(hostile), null);
  await assert.doesNotReject(writeCloudStateThrough(hostile, createDefaultCloudState()));
  assert.equal(await deleteCloudStateThrough(hostile), false);
});

// ---------------------------------------------------------------------------
// Capability check → adapter selection
// ---------------------------------------------------------------------------

test("keychainAvailable() is honestly false in this environment (no bridge exists)", () => {
  // Env-blocked: no packaged build ships __WEEKFORM_KEYCHAIN__, so the probe
  // must say so. If this ever flips green without a real native bridge, that
  // is a bug, not progress.
  assert.equal(keychainAvailable(), false);
});

test("capability absent → the fallback adapter is selected", () => {
  const keychain = makeFakeAdapter();
  const fallback = makeFakeAdapter();
  const selected = resolveSessionStorageAdapter({
    keychainAvailable: () => false,
    keychain,
    fallback
  });
  assert.equal(selected, fallback);
});

test("browser fallback is forbidden inside a native Tauri runtime", () => {
  assert.equal(browserFallbackAllowed({ __TAURI_INTERNALS__: {} }), false);
  assert.equal(browserFallbackAllowed({}), true);
});

test("a revocation tombstone blocks stale credentials when primary deletion fails", async () => {
  const primary = makeFakeAdapter(makeSignedInState());
  primary.delete = async () => {
    primary.deletes += 1;
    throw new Error("store temporarily unavailable");
  };
  let revoked = false;
  const guarded = createRevocationGuardedAdapter(primary, {
    isSet: async () => revoked,
    set: async () => {
      revoked = true;
    },
    clear: async () => {
      revoked = false;
    }
  });

  await guarded.delete();
  assert.equal(revoked, true);
  assert.equal(await readCloudStateThrough(guarded), null, "restart read must fail closed");

  const replacement = makeSignedInState();
  replacement.session = { ...replacement.session!, userId: "user-2" };
  await guarded.write(replacement);
  assert.equal(revoked, false, "only a successful replacement clears revocation");
  assert.deepEqual(await readCloudStateThrough(guarded), replacement);
});

test("serialized storage prevents an older in-flight credential write from winning after delete", async () => {
  const primary = makeFakeAdapter();
  let releaseWrite!: () => void;
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const originalWrite = primary.write;
  primary.write = async (state) => {
    await writeGate;
    await originalWrite(state);
  };
  const serialized = createSerializedSessionStorageAdapter(primary);

  const staleWrite = serialized.write(makeSignedInState());
  const laterDelete = serialized.delete();
  releaseWrite();
  await Promise.all([staleWrite, laterDelete]);

  assert.equal(await serialized.read(), null);
  assert.equal(primary.writes, 1);
  assert.equal(primary.deletes, 1);
});

test("a throwing capability probe falls back instead of stranding session access", () => {
  const fallback = makeFakeAdapter();
  const selected = resolveSessionStorageAdapter({
    keychainAvailable: () => {
      throw new Error("probe exploded");
    },
    keychain: makeFakeAdapter(),
    fallback
  });
  assert.equal(selected, fallback);
});

test("capability present (faked) → keychain adapter is used exclusively; tokens never touch the fallback", async () => {
  const keychain = makeFakeAdapter();
  const fallback = makeFakeAdapter();
  const options = { keychainAvailable: () => true, keychain, fallback };
  const state = makeSignedInState();

  await writeCloudStateThrough(resolveSessionStorageAdapter(options), state);
  const read = await readCloudStateThrough(resolveSessionStorageAdapter(options));
  assert.deepEqual(read, state);

  assert.equal(keychain.writes, 1);
  assert.equal(keychain.reads, 1);
  // The fallback saw ZERO traffic — no write, no read, no stored token material.
  assert.equal(fallback.writes, 0);
  assert.equal(fallback.reads, 0);
  assert.equal(fallback.stored, null);
  assert.equal(JSON.stringify(fallback.stored ?? {}).includes("at-adapter-contract"), false);
});

// ---------------------------------------------------------------------------
// Delete / disconnect clears via the ACTIVE adapter
// ---------------------------------------------------------------------------

test("delete clears via the active adapter and a later read is null", async () => {
  const keychain = makeFakeAdapter();
  const fallback = makeFakeAdapter();
  const options = { keychainAvailable: () => true, keychain, fallback };

  await writeCloudStateThrough(resolveSessionStorageAdapter(options), makeSignedInState());
  await deleteCloudStateThrough(resolveSessionStorageAdapter(options));

  assert.equal(keychain.deletes, 1);
  assert.equal(keychain.stored, null);
  assert.equal(fallback.deletes, 0);
  assert.equal(await readCloudStateThrough(resolveSessionStorageAdapter(options)), null);
});

// ---------------------------------------------------------------------------
// The native adapter never fakes success without its Tauri command boundary
// ---------------------------------------------------------------------------

test("the keychain adapter throws without a native bridge — it never pretends tokens were stored", async () => {
  await withWindow({}, async () => {
    await assert.rejects(keychainSessionStorageAdapter.read());
    await assert.rejects(keychainSessionStorageAdapter.write(createDefaultCloudState()));
    await assert.rejects(keychainSessionStorageAdapter.delete());
  });
});

// ---------------------------------------------------------------------------
// End-to-end through cloudStore's public API with a fake window bridge:
// when a bridge appears, the real resolver picks the keychain adapter and
// localStorage stays untouched.
// ---------------------------------------------------------------------------

test("cloudStore routes through a (faked) window keychain bridge and never writes localStorage", async () => {
  const secrets = new Map<string, string>();
  const bridge: KeychainBridge = {
    getSecret: async (key) => (secrets.has(key) ? (secrets.get(key) as string) : null),
    setSecret: async (key, value) => {
      secrets.set(key, value);
    },
    deleteSecret: async (key) => {
      secrets.delete(key);
    }
  };
  const localBacking = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => (localBacking.has(key) ? (localBacking.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      localBacking.set(key, String(value));
    },
    removeItem: (key: string) => {
      localBacking.delete(key);
    }
  };
  await withWindow({ localStorage, __WEEKFORM_KEYCHAIN__: bridge }, async () => {
    const state = makeSignedInState();
    await writePersistedCloudState(state);
    assert.equal(localBacking.size, 0); // tokens never hit the fallback store
    assert.equal(secrets.size, 1);
    assert.deepEqual(await readPersistedCloudState(), state);
    await clearPersistedCloudState();
    assert.equal(secrets.size, 0);
    assert.equal(await readPersistedCloudState(), null);
  });
});
