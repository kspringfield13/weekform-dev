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
 * The native path has no cancellation (only the Agent wires an AbortController)
 * and the `reqwest` clients have no read timeout, so a hung provider would pin an
 * AI hook at "generating" forever. On timeout we reject with `AI_TIMEOUT_MESSAGE`
 * — the caller's existing catch then calls `fail(message)`, resetting status to
 * "error". The underlying request is not cancelled (it can't be); it simply
 * finishes in the background and its result is ignored.
 */
export function withAiTimeout<T>(promise: Promise<T>, timeoutMs = AI_CALL_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(AI_TIMEOUT_MESSAGE)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
