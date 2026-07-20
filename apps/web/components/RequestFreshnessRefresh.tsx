"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";

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
  const [, startTransition] = useTransition();

  const requestFreshData = useCallback(
    (reason: RefreshReason) => {
      const nowMs = Date.now();
      const visible = document.visibilityState === "visible";
      const online = navigator.onLine;
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
      startTransition(() => router.refresh());
    },
    [router],
  );

  useEffect(() => {
    const onVisibilityChange = () => requestFreshData("visible");
    const onOnline = () => requestFreshData("online");
    const timer = window.setInterval(
      () => requestFreshData("interval"),
      REQUEST_FRESH_INTERVAL_MS,
    );

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
    };
  }, [requestFreshData]);

  return null;
}
