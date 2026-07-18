import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface UseTrayStatusArgs {
  isDemoMode: boolean;
  paused: boolean;
  hasWorkBlocks: boolean;
  reviewCount: number;
  reliableCapacityPct: number;
}

// Ambient menu-bar signal: keep the tray tooltip in sync with a privacy-safe
// status line (counts and percentages only — never window titles or app names).
// Pushes to the native tray only when the text actually changes.
export function useTrayStatus({
  isDemoMode,
  paused,
  hasWorkBlocks,
  reviewCount,
  reliableCapacityPct,
}: UseTrayStatusArgs): void {
  const lastTooltip = useRef<string | null>(null);

  useEffect(() => {
    if (isDemoMode) return;

    const tooltip = paused
      ? "ClearCapacity — tracking paused"
      : hasWorkBlocks
        ? `ClearCapacity — ${reviewCount} to review · ${Math.round(reliableCapacityPct)}% reliable capacity`
        : "ClearCapacity";

    if (lastTooltip.current === tooltip) return;
    lastTooltip.current = tooltip;
    void invoke("set_tray_tooltip", { tooltip }).catch(() => undefined);
  }, [isDemoMode, paused, hasWorkBlocks, reviewCount, reliableCapacityPct]);
}
