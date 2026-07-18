import { useEffect, useMemo, useState } from "react";
import { addDays, getBusinessWeekRangeLabel, getCurrentIsoWeekId, getLocalDateKey } from "../lib/date";

// Cadence for detecting a local-date rollover. Weekform is a menu-bar/tray
// app that can stay mounted for days, so the date-derived keys must not stay
// frozen at their mount-time value — otherwise the narrative daily-run guard, the
// visual-context daily cap, and week attribution all drift once the clock crosses
// midnight / a week boundary. Deliberately slow (mirrors the proactive-alert
// re-eval cadence): a minute of lag right at midnight is harmless, and a
// visibilitychange sync catches the common "reopened the next morning" case
// immediately regardless of the timer.
const ROLLOVER_CHECK_INTERVAL_MS = 3 * 60 * 1000;

export interface DateContext {
  todayKey: string;
  currentWeekId: string;
  currentWeekRangeLabel: string;
  nextWeekId: string;
  nextWeekRangeLabel: string;
}

/**
 * Live date-derived keys that ROLL OVER as the wall clock crosses midnight / a
 * week boundary, instead of being pinned to the value at first mount. Tracks the
 * local date key in state and re-syncs it on a slow interval and on tab
 * visibility; when the day actually changes, the week-derived values recompute
 * against a fresh `now`. A week boundary is always also a day boundary, so keying
 * the whole bundle off `todayKey` covers week rollover too.
 *
 * Follows the fresh-`now`-at-eval-time pattern from `useProactiveAlerts`.
 */
export function useDateContext(): DateContext {
  const [todayKey, setTodayKey] = useState(() => getLocalDateKey());

  useEffect(() => {
    const sync = () => {
      const next = getLocalDateKey();
      // Only re-render when the day actually changes — otherwise every tick would
      // churn the memo and every consumer downstream.
      setTodayKey((current) => (current === next ? current : next));
    };
    const intervalId = window.setInterval(sync, ROLLOVER_CHECK_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return useMemo(() => {
    const now = new Date();
    const nextWeek = addDays(now, 7);
    return {
      todayKey,
      currentWeekId: getCurrentIsoWeekId(now),
      currentWeekRangeLabel: getBusinessWeekRangeLabel(now),
      nextWeekId: getCurrentIsoWeekId(nextWeek),
      nextWeekRangeLabel: getBusinessWeekRangeLabel(nextWeek),
    };
    // `todayKey` is the rollover signal; a new day recomputes the week-derived
    // values off a fresh `now`.
  }, [todayKey]);
}
