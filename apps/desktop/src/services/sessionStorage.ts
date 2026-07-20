// Session storage adapter seam for the cloud session/token envelope (expansion
// roadmap A4: "Secure macOS Keychain session storage").
//
// THE SEAM: `cloudStore.ts` performs exactly three operations against its storage
// backend — read the raw persisted envelope, write a `PersistedCloudStateV1`, and
// delete the envelope. `SessionStorageAdapter` captures those three operations and
// nothing more; no listing, no migration, no partial updates, because the current
// code does none of those. The defensive parsing (`parsePersistedCloudState`) and
// the swallow-every-error degradation stay ABOVE the seam in the `*Through`
// helpers, so every adapter — localStorage, Tauri Store, or Keychain
// bridge — gets identical corrupt-envelope and thrown-error behavior for free.
//
// Native Tauri builds use three Rust commands backed by macOS Security.framework.
// Browser/demo builds have no bridge and retain the documented fallback. Tests may
// inject `__WEEKFORM_KEYCHAIN__`; production native code does not depend on it.

import { Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import {
  parsePersistedCloudState,
  type PersistedCloudStateV1
} from "./cloudPolicy";

// ---------------------------------------------------------------------------
// The adapter contract — mirrors what cloudStore.ts actually does today.
// ---------------------------------------------------------------------------

/**
 * Minimal storage backend for the persisted cloud/session envelope. `read`
 * returns the raw (unparsed, unvalidated) envelope or null when nothing is
 * stored; validation is the caller's job so hostile stored data degrades the
 * same way regardless of backend. Adapters may throw — callers must treat a
 * throw exactly like "nothing readable / write skipped".
 */
export interface SessionStorageAdapter {
  /** Raw persisted envelope, or null when nothing has ever been stored. */
  read(): Promise<unknown>;
  /** Persist the full envelope (the ONLY place session tokens may be written). */
  write(state: PersistedCloudStateV1): Promise<void>;
  /** Remove the envelope entirely (sign-out / "reset all local data"). */
  delete(): Promise<void>;
}

export interface SessionRevocationMarker {
  isSet(): Promise<boolean>;
  set(): Promise<void>;
  clear(): Promise<void>;
}

/**
 * A credential-free tombstone wins over a stale primary envelope. Deletion is
 * considered durable when either the primary delete succeeds or the marker is
 * written; only a later successful replacement write clears the marker.
 */
export function createRevocationGuardedAdapter(
  primary: SessionStorageAdapter,
  marker: SessionRevocationMarker
): SessionStorageAdapter {
  return {
    async read() {
      if (await marker.isSet()) return null;
      return primary.read();
    },
    async write(state) {
      await primary.write(state);
      await marker.clear();
    },
    async delete() {
      let markerWritten = false;
      let primaryDeleted = false;
      let failure: unknown = null;
      try {
        await marker.set();
        markerWritten = true;
      } catch (error) {
        failure = error;
      }
      try {
        await primary.delete();
        primaryDeleted = true;
      } catch (error) {
        failure ??= error;
      }
      if (!markerWritten && !primaryDeleted) throw failure;
    }
  };
}

/** Preserve call order so an older async write can never finish after a later reset. */
export function createSerializedSessionStorageAdapter(
  adapter: SessionStorageAdapter
): SessionStorageAdapter {
  let tail: Promise<void> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
  return {
    read: () => enqueue(() => adapter.read()),
    write: (state) => enqueue(() => adapter.write(state)),
    delete: () => enqueue(() => adapter.delete())
  };
}

// ---------------------------------------------------------------------------
// Default adapter: Tauri Store in the desktop app, localStorage only in a
// browser/demo runtime. A native Store failure must fail closed instead of
// silently creating a second token store in localStorage.
// ---------------------------------------------------------------------------

// Same store file as localStore.ts (legacy name kept for state compatibility), a
// separate key so app-state writes and cloud-state writes never clobber each other.
const STORE_FILE = "clear-capacity.store";
const CLOUD_STATE_KEY = "cloudState";
const CLOUD_STORAGE_KEY = "clear-capacity:cloud:v1"; // fallback for non-Tauri
const CLOUD_REVOCATION_KEY = "clear-capacity:cloud-revoked:v1";

const browserRevocationMarker: SessionRevocationMarker = {
  async isSet() {
    return window.localStorage.getItem(CLOUD_REVOCATION_KEY) === "1";
  },
  async set() {
    window.localStorage.setItem(CLOUD_REVOCATION_KEY, "1");
  },
  async clear() {
    window.localStorage.removeItem(CLOUD_REVOCATION_KEY);
  }
};

export function browserFallbackAllowed(runtime: Record<string, unknown>): boolean {
  return !("__TAURI_INTERNALS__" in runtime);
}

async function getStore(): Promise<Store | null> {
  if (browserFallbackAllowed(window as unknown as Record<string, unknown>)) {
    return null;
  }
  // Deliberately allow Store.load failures to propagate. Falling through to
  // localStorage in a native runtime can strand a second credential envelope
  // that a later Store-backed reset would not clear.
  return Store.load(STORE_FILE);
}

/** Tauri Store in native builds; localStorage only in browser/demo builds. */
const primarySessionStorageAdapter: SessionStorageAdapter = {
  async read(): Promise<unknown> {
    const store = await getStore();
    if (!store) {
      const raw = window.localStorage.getItem(CLOUD_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as unknown;
    }
    const data = await store.get<unknown>(CLOUD_STATE_KEY);
    if (!data) return null;
    return data;
  },
  async write(state: PersistedCloudStateV1): Promise<void> {
    const store = await getStore();
    if (!store) {
      window.localStorage.setItem(CLOUD_STORAGE_KEY, JSON.stringify(state));
      return;
    }
    await store.set(CLOUD_STATE_KEY, state);
    await store.save();
  },
  async delete(): Promise<void> {
    const store = await getStore();
    if (!store) {
      window.localStorage.removeItem(CLOUD_STORAGE_KEY);
      return;
    }
    await store.delete(CLOUD_STATE_KEY);
    await store.save();
  }
};

export const defaultSessionStorageAdapter = createSerializedSessionStorageAdapter(
  createRevocationGuardedAdapter(primarySessionStorageAdapter, browserRevocationMarker)
);

// ---------------------------------------------------------------------------
// Keychain adapter — native Tauri commands backed by macOS Security.framework.
// ---------------------------------------------------------------------------

/**
 * Values are opaque serialized strings. Tests can inject this bridge; native
 * builds construct the same interface over Tauri `invoke` commands below.
 */
export interface KeychainBridge {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

/** Keychain item key for the session envelope (versioned like the localStorage key). */
const KEYCHAIN_SECRET_KEY = "weekform:cloud-session:v1";

function getKeychainBridge(): KeychainBridge | null {
  try {
    if (typeof window === "undefined") return null;
    const bridge = (window as unknown as Record<string, unknown>).__WEEKFORM_KEYCHAIN__;
    if (bridge && typeof bridge === "object") {
      const candidate = bridge as Partial<KeychainBridge>;
      if (
        typeof candidate.getSecret === "function" &&
        typeof candidate.setSecret === "function" &&
        typeof candidate.deleteSecret === "function"
      ) {
        return candidate as KeychainBridge;
      }
    }
    if ("__TAURI_INTERNALS__" in window) {
      return {
        getSecret: (key) => invoke<string | null>("keychain_get_secret", { key }),
        setSecret: (key, value) => invoke<void>("keychain_set_secret", { key, value }),
        deleteSecret: (key) => invoke<void>("keychain_delete_secret", { key }),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True only when a fake test bridge or the Tauri native bridge is available.
 */
export function keychainAvailable(): boolean {
  return getKeychainBridge() !== null;
}

/**
 * Keychain-backed adapter shape. Selected only behind `keychainAvailable()`.
 * If invoked without a
 * bridge it throws — never a fake success — and the `*Through` helpers turn
 * that throw into the same safe degradation every backend gets.
 */
const primaryKeychainSessionStorageAdapter: SessionStorageAdapter = {
  async read(): Promise<unknown> {
    const bridge = getKeychainBridge();
    if (!bridge) throw new Error("keychain bridge not installed");
    const raw = await bridge.getSecret(KEYCHAIN_SECRET_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  },
  async write(state: PersistedCloudStateV1): Promise<void> {
    const bridge = getKeychainBridge();
    if (!bridge) throw new Error("keychain bridge not installed");
    await bridge.setSecret(KEYCHAIN_SECRET_KEY, JSON.stringify(state));
  },
  async delete(): Promise<void> {
    const bridge = getKeychainBridge();
    if (!bridge) throw new Error("keychain bridge not installed");
    await bridge.deleteSecret(KEYCHAIN_SECRET_KEY);
  }
};

export const keychainSessionStorageAdapter = createSerializedSessionStorageAdapter(
  createRevocationGuardedAdapter(primaryKeychainSessionStorageAdapter, browserRevocationMarker)
);

// ---------------------------------------------------------------------------
// Adapter selection — capability check with an unconditional fallback.
// ---------------------------------------------------------------------------

/** Injection points so tests can prove selection without any real platform storage. */
export interface AdapterResolution {
  keychainAvailable?: () => boolean;
  keychain?: SessionStorageAdapter;
  fallback?: SessionStorageAdapter;
}

/**
 * Keychain adapter iff the capability probe passes; the default (Tauri/localStorage)
 * adapter otherwise. The probe result is consulted per call — a bridge appearing or
 * vanishing mid-session changes the very next operation, never a cached stale choice.
 */
export function resolveSessionStorageAdapter(overrides: AdapterResolution = {}): SessionStorageAdapter {
  const available = overrides.keychainAvailable ?? keychainAvailable;
  const keychain = overrides.keychain ?? keychainSessionStorageAdapter;
  const fallback = overrides.fallback ?? defaultSessionStorageAdapter;
  let probe = false;
  try {
    probe = available();
  } catch {
    probe = false; // a broken probe must never strand session access
  }
  return probe ? keychain : fallback;
}

// ---------------------------------------------------------------------------
// Defensive read/write/delete THROUGH an adapter — the behavior cloudStore.ts
// guarantees regardless of backend: validated reads, swallowed failures.
// ---------------------------------------------------------------------------

/** Read + validate the persisted cloud state via `adapter`; null when absent/unreadable. */
export async function readCloudStateThrough(
  adapter: SessionStorageAdapter
): Promise<PersistedCloudStateV1 | null> {
  try {
    const raw = await adapter.read();
    if (raw === null || raw === undefined) return null;
    return parsePersistedCloudState(raw);
  } catch {
    return null;
  }
}

/** Best-effort write via `adapter`; cloud preferences still work in memory on failure. */
export async function writeCloudStateThrough(
  adapter: SessionStorageAdapter,
  state: PersistedCloudStateV1
): Promise<void> {
  try {
    await writeCloudStateStrictThrough(adapter, state);
  } catch {
    // Cloud preferences still work in memory when storage is unavailable.
  }
}

/**
 * Confirmed write for consequential workflows. Unlike the best-effort wrapper,
 * this rejects when storage cannot prove the complete envelope is durable.
 */
export async function writeCloudStateStrictThrough(
  adapter: SessionStorageAdapter,
  state: PersistedCloudStateV1
): Promise<void> {
  await adapter.write(state);
}

/** True only when the adapter confirms deletion or a durable revocation tombstone. */
export async function deleteCloudStateThrough(adapter: SessionStorageAdapter): Promise<boolean> {
  try {
    await adapter.delete();
    return true;
  } catch {
    return false;
  }
}
