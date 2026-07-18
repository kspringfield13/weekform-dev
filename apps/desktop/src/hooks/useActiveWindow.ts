import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { createAuditEvent } from "../lib/audit";
import type { ActiveWindowSample, AuditEvent } from "../../../../packages/domain/src/models";

interface UseActiveWindowParams {
  isDemoMode: boolean;
  setActiveWindowSamples: React.Dispatch<React.SetStateAction<ActiveWindowSample[]>>;
  setAuditEvents: React.Dispatch<React.SetStateAction<AuditEvent[]>>;
}

export function useActiveWindow(params: UseActiveWindowParams) {
  const { isDemoMode, setActiveWindowSamples, setAuditEvents } = params;

  useEffect(() => {
    if (isDemoMode) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void listen<any>("clear-capacity:active-window-sample", (event) => {
      const payload = event.payload;

      if (payload.capture_error) {
        // caller can handle error state
        return;
      }

      if (!payload.app_name) {
        return;
      }

      // Guard the native `timestamp_ms` before ISO-formatting it: a missing / NaN /
      // out-of-range value makes `new Date(x).toISOString()` throw a RangeError, which
      // would lose the sample AND its audit row (both call sites below format it). Drop
      // the malformed sample instead, using the shared finite-before-toISOString idiom
      // (format.ts `Number.isFinite(new Date(x).getTime())`, useClassification's
      // NaN-filter). Computing the ISO once also keeps the sample and its audit event on
      // the exact same timestamp.
      const sampleDate = new Date(payload.timestamp_ms);
      if (!Number.isFinite(sampleDate.getTime())) {
        return;
      }
      const timestamp = sampleDate.toISOString();

      setActiveWindowSamples((current) => {
        const sample: ActiveWindowSample = {
          sample_id: crypto.randomUUID(),
          timestamp,
          app_name: payload.app_name ?? "Unknown app",
          window_title: payload.window_title || null,
          source_type: "macos_active_window",
          privacy_level: "local_only",
        };

        return [...current, sample].slice(-2000);
      });

      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "active_window_sample",
          source: "macos_active_window",
          title: "Active-window sample captured",
          summary: `${payload.app_name}${payload.window_title ? ` - ${payload.window_title}` : ""}`,
          privacy_level: "local_only",
          timestamp,
          details: {
            app_name: payload.app_name,
            window_title: payload.window_title,
            stored_locally: true,
            sent_to_cloud: false,
            screenshots: false,
            keystrokes: false,
          },
        }),
      ].slice(-1000));
    })
      .then((cleanup) => {
        if (cancelled) {
          // Effect already torn down before listen() resolved — detach the
          // late-installed handler so it can't leak duplicate samples/audit rows.
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch(() => {
        // handle error
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isDemoMode, setActiveWindowSamples, setAuditEvents]);
}
