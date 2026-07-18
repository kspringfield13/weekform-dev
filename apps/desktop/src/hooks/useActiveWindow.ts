import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { createAuditEvent } from "../lib/audit";
import type { ActiveWindowSample, AuditEvent } from "../../../../packages/domain/src/models";

interface UseActiveWindowParams {
  isDemoMode: boolean;
  setActiveWindowSamples: React.Dispatch<React.SetStateAction<ActiveWindowSample[]>>;
  setAuditEvents: React.Dispatch<React.SetStateAction<AuditEvent[]>>;
  addAuditForSession?: (session: any) => void;
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

      setActiveWindowSamples((current) => {
        const sample: ActiveWindowSample = {
          sample_id: crypto.randomUUID(),
          timestamp: new Date(payload.timestamp_ms).toISOString(),
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
          timestamp: new Date(payload.timestamp_ms).toISOString(),
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

  // Session grouping audit can be added here too if wanted
}
