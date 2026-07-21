export interface CaptureDeliveryState {
  accepting: boolean;
  acceptAfterMs: number;
}

export function canChangeCapturePaused(
  resetInProgress: boolean,
  nextPaused: boolean,
): boolean {
  return nextPaused || !resetInProgress;
}

/**
 * Reject malformed samples and any native event timestamped at or before the
 * latest resume boundary. Tauri can queue an event in the Webview across a
 * pause/reset; a boolean gate alone would admit that stale event after resume.
 */
export function shouldAcceptCaptureTimestamp(
  state: CaptureDeliveryState,
  timestampMs: unknown,
): timestampMs is number {
  if (!state.accepting || typeof timestampMs !== "number") return false;
  if (!Number.isFinite(timestampMs) || timestampMs <= state.acceptAfterMs) return false;
  return Number.isFinite(new Date(timestampMs).getTime());
}
