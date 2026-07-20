import { AI_CALL_TIMEOUT_MS } from "./constants";

/**
 * User-facing copy for a timed-out AI call. Kept generic so it reads sensibly
 * whether it surfaces as a toast (forecast / acceleration / narrative / visual
 * context) or an in-panel InlineError (classification / review copilot) — every
 * AI hook's catch already routes `error.message` through `useAsyncStatus.fail`.
 */
export const AI_TIMEOUT_MESSAGE = `The AI provider didn't respond within ${Math.round(
  AI_CALL_TIMEOUT_MS / 1000
)}s. It may be slow or unreachable — check your connection and provider settings, then try again.`;

/**
 * Race a Rust-mediated AI `invoke` against a bounded timeout.
 *
 * Native provider calls have connect/read/total timeouts and a total ceiling
 * shorter than this UI timeout. Tauri invoke promises do not expose transport
 * cancellation, so the Rust boundary guarantees the paid HTTP request has
 * already ended before this fallback can abandon its promise. On timeout the
 * caller's existing catch resets status to an actionable error.
 */
export function withAiTimeout<T>(promise: Promise<T>, timeoutMs = AI_CALL_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(AI_TIMEOUT_MESSAGE)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
