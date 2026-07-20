export const MAX_VISUAL_CONTEXT_CAPTURES_PER_DAY = 8;
export const MIN_VISUAL_CONTEXT_SESSION_MINUTES = 10;
export const MIN_VISUAL_CONTEXT_GAP_MS = 45 * 60 * 1000;

// Proactive alert throttling. Mirrors the visual-context caps above: a hard daily
// ceiling plus a minimum quiet period between interruptive OS notifications so the
// menu-bar app stays calm even when a guardrail condition lingers.
export const MAX_PROACTIVE_ALERTS_PER_DAY = 4;
export const MIN_PROACTIVE_ALERT_GAP_MS = 90 * 60 * 1000;

// Bounded fallback for every Rust-mediated AI call. Native connect/read/total
// limits end provider HTTP work before this 60-second UI ceiling; the frontend
// race still protects state if invocation/serialization itself ever stalls.
export const AI_CALL_TIMEOUT_MS = 60 * 1000;

// Hover explanation for every AI-triggering button that is grayed out because no
// AI access exists (no saved provider/Codex connection and no OPENAI_API_KEY
// environment fallback). One shared string keeps guidance identical everywhere.
export const AI_UNAVAILABLE_HINT =
  "Needs an AI connection — use a ChatGPT/Codex plan or provider API key under Settings → AI Assistance";
