import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { writePersistedState } from "../services/localStore";
import type { PersistedAppState } from "../services/localStore";

// Derive the write payload straight from the persisted schema so the two can never
// drift: `version` is stamped by the hook, and `isDemoMode` is a runtime-only guard
// that is destructured out before writing. Adding a field to `PersistedAppState` now
// forces a type error here (and at the App.tsx call site) until it's threaded through,
// which is exactly what the old `as any` cast defeated.
type PersistableState = Omit<PersistedAppState, "version"> & { isDemoMode: boolean };

export function usePersistence(
  state: PersistableState,
  hydrated: MutableRefObject<boolean>,
  onWriteError?: (error: unknown) => void
) {
  const { isDemoMode, ...persistData } = state;

  // Keep the latest handler in a ref so it isn't an effect dependency — an inline
  // callback from App.tsx changes every render, and adding it to the deps below
  // would trigger a persist write on every render.
  const onWriteErrorRef = useRef(onWriteError);
  onWriteErrorRef.current = onWriteError;
  // A failing write (quota/disk) tends to keep failing, so surface it ONCE rather
  // than re-toasting on every subsequent state change.
  const writeErrorSurfaced = useRef(false);

  useEffect(() => {
    // Skip the first-mount write until the async hydration read has resolved
    // (App.tsx flips `hydrated` in readPersistedState().then). Without this gate
    // the empty-state write can race ahead of the read and persist `{blocks: []}`,
    // wiping the user's stored work. Mirrors the `themeHydrated` ref guard.
    if (isDemoMode || !hydrated.current) return;
    writePersistedState({
      version: 1,
      ...persistData,
    }).catch((error) => {
      if (writeErrorSurfaced.current) return;
      writeErrorSurfaced.current = true;
      onWriteErrorRef.current?.(error);
    });
  }, [
    persistData.blocks,
    persistData.calendarEvents,
    persistData.chatEvents,
    persistData.activeWindowSamples,
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
    persistData.proactiveAlertSettings,
    persistData.proactiveAlertRuntime,
    isDemoMode,
  ]);
}
