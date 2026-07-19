import type {
  SimulationCheckpoint,
  SimulationConfig,
  SimulationDataset,
} from "../../../../packages/simulator/src/types";

export type StoredSimulationStatus = "running" | "canceled" | "complete" | "failed";

export interface StoredSimulationRun {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: StoredSimulationStatus;
  archived: boolean;
  config: SimulationConfig;
  checkpoint: SimulationCheckpoint;
  dataset: SimulationDataset | null;
  error: string | null;
}

const DATABASE_NAME = "weekform-span-simulator";
const DATABASE_VERSION = 1;
const RUN_STORE = "runs";
const LEGACY_STORE_KEY = "weekform.span-simulator.runs.v1";

function parseRun(value: unknown): StoredSimulationRun | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<StoredSimulationRun>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    !candidate.config ||
    !candidate.checkpoint
  ) {
    return null;
  }
  if (!["running", "canceled", "complete", "failed"].includes(candidate.status ?? "")) {
    return null;
  }
  return {
    id: candidate.id,
    name: candidate.name,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    status: candidate.status as StoredSimulationStatus,
    archived: candidate.archived === true,
    config: candidate.config,
    checkpoint: candidate.checkpoint,
    dataset: candidate.dataset ?? null,
    error: typeof candidate.error === "string" ? candidate.error : null,
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RUN_STORE)) {
        database.createObjectStore(RUN_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the simulator database."));
    request.onblocked = () => reject(new Error("The simulator database upgrade is blocked by another tab."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Simulator persistence failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Simulator persistence was aborted."));
  });
}

function readLegacyRuns(): StoredSimulationRun[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseRun).filter((run): run is StoredSimulationRun => Boolean(run));
  } catch {
    return [];
  }
}

export async function readSimulationRuns(): Promise<StoredSimulationRun[]> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(RUN_STORE, "readonly");
    const request = transaction.objectStore(RUN_STORE).getAll();
    const values = await new Promise<unknown[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read simulator runs."));
    });
    await transactionComplete(transaction);
    database.close();

    const runs = values.map(parseRun).filter((run): run is StoredSimulationRun => Boolean(run));
    if (runs.length > 0) {
      return runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    const legacyRuns = readLegacyRuns();
    if (legacyRuns.length > 0 && await writeSimulationRuns(legacyRuns)) {
      window.localStorage.removeItem(LEGACY_STORE_KEY);
    }
    return legacyRuns.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return readLegacyRuns().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}

let writeQueue: Promise<boolean> = Promise.resolve(true);

async function replaceSimulationRuns(runs: StoredSimulationRun[]): Promise<boolean> {
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    const transaction = database.transaction(RUN_STORE, "readwrite");
    const store = transaction.objectStore(RUN_STORE);
    store.clear();
    runs.forEach((run) => store.put(run));
    await transactionComplete(transaction);
    return true;
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

export function writeSimulationRuns(runs: StoredSimulationRun[]): Promise<boolean> {
  const snapshot = structuredClone(runs);
  writeQueue = writeQueue.then(() => replaceSimulationRuns(snapshot));
  return writeQueue;
}
