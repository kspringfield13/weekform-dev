// Session storage adapter seam for the cloud session/token envelope (expansion
// roadmap A4: "Secure macOS Keychain session storage").
//
// THE SEAM: `cloudStore.ts` performs exactly three operations against its storage
// backend — read the raw persisted envelope, write a `PersistedCloudStateV1`, and
// delete the envelope. `SessionStorageAdapter` captures those three operations and
// nothing more; no listing, no migration, no partial updates, because the current
// code does none of those. The defensive parsing (`parsePersistedCloudState`) and
// the swallow-every-error degradation stay ABOVE the seam in the `*Through`
// helpers, so every adapter — localStorage, Tauri Store, or a future Keychain
// bridge — gets identical corrupt-envelope and thrown-error behavior for free.
//
// HONESTY CONTRACT (non-negotiable in this repo): the Keychain adapter below is a
// STUB. `keychainAvailable()` returns false in every current build — browser/Vite
// and the unpackaged Tauri dev shell alike — because no native Keychain bridge
// exists yet. Live macOS Keychain storage CANNOT be verified until a packaged
// desktop build ships a bridge (e.g. a Tauri command or Electron `safeStorage`
// call wired to `window.__WEEKFORM_KEYCHAIN__`); until then this module is
// env-blocked for live proof and every session read/write/delete goes through the
// default adapter. The stub never fakes success: if it were ever selected without
// a real bridge, its methods throw instead of silently dropping tokens.

import { Store } from "@tauri-apps/plugin-store";
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

// ---------------------------------------------------------------------------
// Default adapter — the exact behavior cloudStore.ts had before this seam:
// Tauri Store in the desktop app, localStorage fallback in web/demo builds.
// ---------------------------------------------------------------------------

// Same store file as localStore.ts (legacy name kept for state compatibility), a
// separate key so app-state writes and cloud-state writes never clobber each other.
const STORE_FILE = "clear-capacity.store";
const CLOUD_STATE_KEY = "cloudState";
const CLOUD_STORAGE_KEY = "clear-capacity:cloud:v1"; // fallback for non-Tauri

async function getStore(): Promise<Store | null> {
  try {
    if (!("__TAURI_INTERNALS__" in window)) {
      return null;
    }
    return await Store.load(STORE_FILE);
  } catch {
    return null;
  }
}

/** Tauri Store when available, localStorage otherwise — unchanged legacy behavior. */
export const defaultSessionStorageAdapter: SessionStorageAdapter = {
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

// ---------------------------------------------------------------------------
// Keychain adapter — capability-gated STUB (env-blocked for live proof).
// ---------------------------------------------------------------------------

/**
 * The bridge a packaged native build would install on `window` to expose the
 * OS keychain (e.g. a Tauri `invoke` wrapper over the macOS Security framework,
 * or Electron `safeStorage`). Values are opaque serialized strings; the bridge
 * owns service/account naming. No build ships this today.
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
    if (!bridge || typeof bridge !== "object") return null;
    const candidate = bridge as Partial<KeychainBridge>;
    if (
      typeof candidate.getSecret !== "function" ||
      typeof candidate.setSecret !== "function" ||
      typeof candidate.deleteSecret !== "function"
    ) {
      return null;
    }
    return candidate as KeychainBridge;
  } catch {
    return null;
  }
}

/**
 * True only when a native keychain bridge is actually installed. Today that is
 * NEVER — no packaged build ships `__WEEKFORM_KEYCHAIN__` — so this honestly
 * returns false everywhere and the default adapter carries all traffic. Do not
 * hardcode this to true without a real bridge and a packaged-build verification.
 */
export function keychainAvailable(): boolean {
  return getKeychainBridge() !== null;
}

/**
 * Keychain-backed adapter shape. Fully functional ONLY once a real bridge
 * exists; selected only behind `keychainAvailable()`. If invoked without a
 * bridge it throws — never a fake success — and the `*Through` helpers turn
 * that throw into the same safe degradation every backend gets.
 */
export const keychainSessionStorageAdapter: SessionStorageAdapter = {
  async read(): Promise<unknown> {
    const bridge = getKeychainBridge();
    if (!bridge) throw new Error("keychain bridge not installed (env-blocked stub)");
    const raw = await bridge.getSecret(KEYCHAIN_SECRET_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  },
  async write(state: PersistedCloudStateV1): Promise<void> {
    const bridge = getKeychainBridge();
    if (!bridge) throw new Error("keychain bridge not installed (env-blocked stub)");
    await bridge.setSecret(KEYCHAIN_SECRET_KEY, JSON.stringify(state));
  },
  async delete(): Promise<void> {
    const bridge = getKeychainBridge();
    if (!bridge) throw new Error("keychain bridge not installed (env-blocked stub)");
    await bridge.deleteSecret(KEYCHAIN_SECRET_KEY);
  }
};

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
    await adapter.write(state);
  } catch {
    // Cloud preferences still work in memory when storage is unavailable.
  }
}

/** Best-effort delete via `adapter`; a failed delete leaves only local state behind. */
export async function deleteCloudStateThrough(adapter: SessionStorageAdapter): Promise<void> {
  try {
    await adapter.delete();
  } catch {
    // ignore — a failed delete leaves only local state behind, never an upload path.
  }
}
