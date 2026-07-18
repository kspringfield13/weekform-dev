import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// Thin wrapper around the Tauri notification plugin. All entry points are safe to
// call from any environment: in the web preview (no Tauri runtime) they no-op and
// resolve false, so callers never need to branch on the host.

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Ensure OS notification permission, requesting it once if needed. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!inTauri()) return false;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    return granted;
  } catch {
    return false;
  }
}

/**
 * Send a menu-bar notification. Returns whether it was delivered. Body/title must
 * already be privacy-safe (metrics only) — this layer does not sanitise.
 */
export async function sendOsNotification(title: string, body: string): Promise<boolean> {
  if (!inTauri()) return false;
  try {
    if (!(await ensureNotificationPermission())) return false;
    sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}
