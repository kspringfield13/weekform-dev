"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  REQUEST_FRESH_INTERVAL_MS,
  shouldRequestFreshData,
  type RefreshReason,
} from "@/lib/requestFreshness";

/**
 * Near-real-time request refresh for authenticated dashboards.
 *
 * No Supabase client, subscription payload, or workload record lives in the
 * browser. `router.refresh()` requests a new server-component render, whose
 * server-side Supabase client repeats the current user's RLS-scoped queries.
 */
export function RequestFreshnessRefresh() {
  const router = useRouter();
  const lastRequestedAtRef = useRef(Date.now());
  const [lastRequestedAt, setLastRequestedAt] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);
  const [pending, startTransition] = useTransition();

  const requestFreshData = useCallback(
    (reason: RefreshReason) => {
      const nowMs = Date.now();
      const visible = document.visibilityState === "visible";
      const online = navigator.onLine;
      setAvailable(visible && online);
      if (
        !shouldRequestFreshData({
          reason,
          nowMs,
          lastRequestedAtMs: lastRequestedAtRef.current,
          visible,
          online,
        })
      ) {
        return;
      }
      // Advance the gate before scheduling the render so simultaneous browser
      // events cannot enqueue duplicate requests.
      lastRequestedAtRef.current = nowMs;
      setLastRequestedAt(nowMs);
      startTransition(() => router.refresh());
    },
    [router],
  );

  useEffect(() => {
    const onVisibilityChange = () => requestFreshData("visible");
    const onOnline = () => requestFreshData("online");
    const onOffline = () => setAvailable(false);
    const timer = window.setInterval(
      () => requestFreshData("interval"),
      REQUEST_FRESH_INTERVAL_MS,
    );

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    setAvailable(document.visibilityState === "visible" && navigator.onLine);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [requestFreshData]);

  const status = !available
    ? "Updates are paused while this page is hidden or offline."
    : pending
      ? "Checking for approved updates…"
      : lastRequestedAt === null
        ? "Approved updates are checked every 15 seconds while this page is visible and online."
        : `Checked for approved updates at ${new Date(lastRequestedAt).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}.`;

  return (
    // Deliberately not an aria-live region: announcing a routine poll every
    // 15 seconds would interrupt screen-reader users. The visible status stays
    // available without turning background freshness into noisy feedback.
    <div className="status-line">
      <span>{status}</span>
      <span>Request-fresh server data · no browser workload cache</span>
    </div>
  );
}
