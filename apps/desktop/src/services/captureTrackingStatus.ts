/**
 * Native foreground sampling runs every five seconds. Requiring a successful
 * journaled sample within this bounded window distinguishes a working collector
 * from an enabled preference, a permission failure, or a stalled capture loop.
 */
export const CAPTURE_CONFIRMATION_MAX_AGE_MS = 12_000;

export function isCaptureTrackingConfirmed(input: {
  trackingEnabled: boolean;
  captureError: string | null;
  lastSuccessfulCaptureAtMs: number | null;
  nowMs: number;
}): boolean {
  const {
    trackingEnabled,
    captureError,
    lastSuccessfulCaptureAtMs,
    nowMs,
  } = input;
  if (!trackingEnabled || captureError !== null) return false;
  if (!Number.isFinite(nowMs) || lastSuccessfulCaptureAtMs === null
    || !Number.isFinite(lastSuccessfulCaptureAtMs)) return false;
  const ageMs = nowMs - lastSuccessfulCaptureAtMs;
  return ageMs >= 0 && ageMs <= CAPTURE_CONFIRMATION_MAX_AGE_MS;
}
