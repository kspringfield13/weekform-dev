import type { SettingsTab, WindowMode } from "../lib/types";

export interface WebTrackingHandoffResolution {
  startTracking: boolean;
  windowMode: WindowMode;
  screen: "setup" | null;
  settingsTab: SettingsTab | null;
}

/**
 * A Web request can resume native collection only after the desktop account is
 * known to be signed in. Signed-out users keep their current pause state and
 * land on the existing Account & Sharing sign-in surface instead.
 */
export function resolveWebTrackingHandoff(
  desktopSignedIn: boolean,
): WebTrackingHandoffResolution {
  return desktopSignedIn
    ? {
        startTracking: true,
        windowMode: "compact",
        screen: null,
        settingsTab: null,
      }
    : {
        startTracking: false,
        windowMode: "large",
        screen: "setup",
        settingsTab: "account",
      };
}
