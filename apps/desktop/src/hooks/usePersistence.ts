import { useCallback, useEffect, useMemo, useRef } from "react";
import { writePersistedState } from "../services/localStore";
import type { PersistedAppState } from "../services/localStore";
import { createPersistenceCoordinator } from "../services/persistenceCoordinator";

// Derive the write payload straight from the persisted schema so the two can never
// drift: `version` is stamped by the hook, and `isDemoMode` is a runtime-only guard
// that is destructured out before writing. Adding a field to `PersistedAppState` now
// forces a type error here (and at the App.tsx call site) until it's threaded through,
// which is exactly what the old `as any` cast defeated.
type PersistableState = Omit<PersistedAppState, "version"> & { isDemoMode: boolean };
const PERSISTENCE_DEBOUNCE_MS = 250;
const EMPTY_NATIVE_SAMPLES: PersistedAppState["activeWindowSamples"] = [];

export interface PersistenceBarrier {
  /** Persist the newest complete snapshot observed by the latest React render. */
  flushLatest: () => Promise<void>;
  /** Close the write lane and wait for any write that already crossed the boundary. */
  suspendForReset: () => Promise<void>;
  /** Reopen persistence after Reset has replaced the in-memory workspace. */
  resumeAfterReset: () => void;
}

export function usePersistence(
  state: PersistableState,
  hydrated: boolean,
  onWriteError?: (error: unknown) => void
) {
  const { isDemoMode, ...persistData } = state;
  const isTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const samplesForPersistence = isTauriRuntime
    ? EMPTY_NATIVE_SAMPLES
    : persistData.activeWindowSamples;
  const latestSnapshotRef = useRef<PersistedAppState>({
    version: 1,
    ...persistData,
    activeWindowSamples: samplesForPersistence,
  });
  latestSnapshotRef.current = {
    version: 1,
    ...persistData,
    activeWindowSamples: samplesForPersistence,
  };

  // Keep the latest handler in a ref so it isn't an effect dependency — an inline
  // callback from App.tsx changes every render, and adding it to the deps below
  // would trigger a persist write on every render.
  const onWriteErrorRef = useRef(onWriteError);
  onWriteErrorRef.current = onWriteError;
  // A failing write (quota/disk) tends to keep failing, so surface it ONCE rather
  // than re-toasting on every subsequent state change.
  const writeErrorSurfaced = useRef(false);
  const pendingTimerRef = useRef<number | null>(null);
  const suspendedForResetRef = useRef(false);
  const writeCoordinatorRef = useRef<ReturnType<
    typeof createPersistenceCoordinator<PersistedAppState>
  > | null>(null);
  if (writeCoordinatorRef.current === null) {
    writeCoordinatorRef.current = createPersistenceCoordinator(writePersistedState);
  }
  const writeCoordinator = writeCoordinatorRef.current;

  const flushLatest = useCallback(async (): Promise<void> => {
    if (isDemoMode) throw new Error("Demo state is not persisted.");
    if (!hydrated) throw new Error("Saved Weekform state has not finished loading.");
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    try {
      await writeCoordinator.schedule(latestSnapshotRef.current);
      writeErrorSurfaced.current = false;
    } catch (error) {
      if (!writeErrorSurfaced.current) {
        writeErrorSurfaced.current = true;
        onWriteErrorRef.current?.(error);
      }
      throw error;
    }
  }, [hydrated, isDemoMode, writeCoordinator]);

  const suspendForReset = useCallback(async (): Promise<void> => {
    suspendedForResetRef.current = true;
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    await writeCoordinator.suspend();
  }, [writeCoordinator]);

  const resumeAfterReset = useCallback((): void => {
    writeCoordinator.resume();
    suspendedForResetRef.current = false;
  }, [writeCoordinator]);

  useEffect(() => {
    // Skip the first-mount write until the async hydration read has resolved
    // (App.tsx flips `hydrated` after both startup phases). Without this gate
    // the empty-state write can race ahead of the read and persist `{blocks: []}`,
    // wiping the user's stored work. Mirrors the `themeHydrated` ref guard.
    if (isDemoMode || !hydrated || suspendedForResetRef.current) return;
    const timer = window.setTimeout(() => {
      if (pendingTimerRef.current === timer) pendingTimerRef.current = null;
      void flushLatest().catch(() => undefined);
    }, PERSISTENCE_DEBOUNCE_MS);
    pendingTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (pendingTimerRef.current === timer) pendingTimerRef.current = null;
    };
  }, [
    persistData.blocks,
    persistData.calendarEvents,
    persistData.chatEvents,
    persistData.chatEvidence,
    samplesForPersistence,
    persistData.auditEvents,
    persistData.corrections,
    persistData.reviewSuggestions,
    persistData.generatedForecast,
    persistData.forecastHistory,
    persistData.snapshotHistory,
    persistData.accelerationHistory,
    persistData.visualContextEnabled,
    persistData.visualContextInsights,
    persistData.dismissedPlayIds,
    persistData.actedOnPlayIds,
    persistData.generatedPlays,
    persistData.savedSkills,
    persistData.managerSummaryText,
    persistData.generatedNarrative,
    persistData.lastNarrativeAutoRunDate,
    persistData.paused,
    persistData.aiConfig,
    persistData.retentionDays,
    persistData.onboardingDismissed,
    persistData.walkthroughCompleted,
    persistData.gettingStartedStatus,
    persistData.defaultWindowMode,
    persistData.proactiveAlertSettings,
    persistData.proactiveAlertRuntime,
    persistData.tokenUsageDays,
    persistData.tokenUsageSettings,
    persistData.usageCsvRowHashes,
    persistData.consentReceipts,
    hydrated,
    isDemoMode,
    flushLatest,
  ]);

  return useMemo(
    () => ({ flushLatest, suspendForReset, resumeAfterReset }),
    [flushLatest, resumeAfterReset, suspendForReset],
  );
}
