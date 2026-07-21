import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ActiveWindowSample } from "../../../../packages/domain/src/models";
import { shouldAcceptCaptureTimestamp } from "../services/captureDeliveryGuard";

interface UseActiveWindowParams {
  isDemoMode: boolean;
  captureAcceptingRef: React.MutableRefObject<boolean>;
  captureAcceptAfterMsRef: React.MutableRefObject<number>;
  setActiveWindowSamples: React.Dispatch<React.SetStateAction<ActiveWindowSample[]>>;
  setCaptureError?: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useActiveWindow(params: UseActiveWindowParams) {
  const {
    captureAcceptingRef,
    captureAcceptAfterMsRef,
    isDemoMode,
    setActiveWindowSamples,
    setCaptureError,
  } = params;

  useEffect(() => {
    if (isDemoMode) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void listen<any>("clear-capacity:active-window-sample", (event) => {
      const payload = event.payload;

      // Tauri event delivery is queued onto the Webview. A sample emitted before
      // the native pause barrier can therefore arrive after pause/reset has
      // completed. The renderer gate is closed synchronously before either
      // operation awaits native work, so those late deliveries cannot repopulate
      // private in-memory activity.
      if (!captureAcceptingRef.current) return;

      if (payload.capture_error) {
        setCaptureError?.(String(payload.capture_error).slice(0, 240));
        return;
      }

      if (!payload.app_name) {
        return;
      }

      // Guard the native `timestamp_ms` before ISO-formatting it: a missing / NaN /
      // out-of-range value makes `new Date(x).toISOString()` throw a RangeError, which
      // would lose the sample. Drop the malformed sample instead, using the shared
      // finite-before-toISOString idiom
      // (format.ts `Number.isFinite(new Date(x).getTime())`, useClassification's
      // NaN-filter). Computing the ISO once also keeps the sample and its audit event on
      // one validated timestamp. Individual samples are deliberately not copied
      // into the unencrypted audit Store; capture policy/pause events remain the
      // inspectable audit boundary and raw rows stay in the encrypted journal.
      if (!shouldAcceptCaptureTimestamp(
        {
          accepting: captureAcceptingRef.current,
          acceptAfterMs: captureAcceptAfterMsRef.current,
        },
        payload.timestamp_ms,
      )) return;
      const sampleDate = new Date(payload.timestamp_ms);
      const timestamp = sampleDate.toISOString();
      setCaptureError?.(null);

      setActiveWindowSamples((current) => {
        const sample: ActiveWindowSample = {
          sample_id: typeof payload.sample_id === "string" ? payload.sample_id : crypto.randomUUID(),
          timestamp,
          app_name: payload.app_name ?? "Unknown app",
          window_title: payload.window_title || null,
          source_type: "macos_active_window",
          privacy_level: "local_only",
        };

        return [...current, sample].slice(-2000);
      });

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
  }, [captureAcceptAfterMsRef, captureAcceptingRef, isDemoMode, setActiveWindowSamples, setCaptureError]);
}
