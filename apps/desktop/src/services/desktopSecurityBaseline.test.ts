import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tauriConfig = JSON.parse(readFileSync(
  new URL("../../src-tauri/tauri.conf.json", import.meta.url),
  "utf8",
)) as {
  app?: { security?: { csp?: string; devCsp?: string; freezePrototype?: boolean } };
};

const capability = JSON.parse(readFileSync(
  new URL("../../src-tauri/capabilities/default.json", import.meta.url),
  "utf8",
)) as {
  permissions?: Array<string | { identifier?: string; allow?: Array<{ url?: string }> }>;
};

const nativeSource = readFileSync(
  new URL("../../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);
const setupSource = readFileSync(
  new URL("../components/settings/SetupScreen.tsx", import.meta.url),
  "utf8",
);
const frontendConstantsSource = readFileSync(
  new URL("../lib/constants.ts", import.meta.url),
  "utf8",
);

test("packaged and development webviews have explicit script-safe CSP baselines", () => {
  const csp = tauriConfig.app?.security?.csp ?? "";
  const devCsp = tauriConfig.app?.security?.devCsp ?? "";

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/);

  // Vite injects an inline React Refresh preamble in development. This policy
  // is never packaged; constrain its tooling exception to the loopback dev URL
  // while keeping the production policy strict.
  assert.match(devCsp, /default-src 'self'/);
  assert.match(devCsp, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  assert.match(devCsp, /object-src 'none'/);
  assert.match(devCsp, /base-uri 'self'/);
  assert.match(devCsp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self' ipc: http:\/\/ipc\.localhost https: wss:/);
  assert.match(devCsp, /http:\/\/127\.0\.0\.1:5173/);
  assert.match(devCsp, /ws:\/\/127\.0\.0\.1:5173/);
  assert.equal(tauriConfig.app?.security?.freezePrototype, true);
});

test("frontend plugin capabilities expose only the operations Weekform uses", () => {
  const permissions = capability.permissions ?? [];
  const identifiers = permissions.map((permission) => (
    typeof permission === "string" ? permission : permission.identifier ?? ""
  ));

  assert.ok(!identifiers.includes("opener:default"));
  assert.ok(!identifiers.includes("store:default"));
  assert.ok(!identifiers.includes("notification:default"));

  const required = [
    "opener:allow-open-url",
    "store:allow-load",
    "store:allow-get-store",
    "store:allow-set",
    "store:allow-get",
    "store:allow-delete",
    "store:allow-save",
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission",
    "notification:allow-notify",
  ];
  for (const permission of required) assert.ok(identifiers.includes(permission), permission);

  for (const excessive of [
    "opener:allow-open-path",
    "opener:allow-reveal-item-in-dir",
    "store:allow-clear",
    "store:allow-reset",
    "store:allow-keys",
    "store:allow-values",
    "store:allow-entries",
    "store:allow-reload",
  ]) {
    assert.ok(!identifiers.includes(excessive), excessive);
  }

  const opener = permissions.find((permission) => (
    typeof permission === "object" && permission.identifier === "opener:allow-open-url"
  ));
  assert.ok(opener && typeof opener === "object");
  const allowedUrls = opener.allow?.map((entry) => entry.url) ?? [];
  assert.deepEqual(allowedUrls, [
    "https://*",
    "http://127.0.0.1:*",
    "http://localhost:*",
  ]);
});

test("each native AI feature has a process-wide in-flight guard", () => {
  const commands = [
    "test_ai_connection",
    "generate_weekly_narrative_with_openai",
    "classify_active_window_sessions_with_openai",
    "generate_review_copilot_suggestions_with_openai",
    "generate_forecast_agent_with_openai",
    "capture_visual_context_with_openai",
    "chat_with_agent",
    "ai_complete",
  ];
  for (const command of commands) {
    const start = nativeSource.indexOf(`async fn ${command}`);
    assert.ok(start >= 0, command);
    const body = nativeSource.slice(start, start + 650);
    assert.match(body, /start_ai_operation\(&[A-Z_]+_IN_FLIGHT/);
  }
  assert.match(nativeSource, /compare_exchange\(\s*false,\s*true/);
  assert.match(nativeSource, /impl Drop for AiOperationGuard/);
});

test("the provider connection test shares the bounded frontend timeout", () => {
  const connectionTest = setupSource.slice(
    setupSource.indexOf("const testConnection = async"),
    setupSource.indexOf("const connectCodexPlan"),
  );
  assert.match(connectionTest, /withAiTimeout\(\s*invoke<TestConnectionResponse>/);
});

test("native provider work ends before the frontend can abandon its invoke", () => {
  const nativeTotal = nativeSource.match(
    /AI_HTTP_TOTAL_TIMEOUT:\s*Duration\s*=\s*Duration::from_secs\((\d+)\)/,
  );
  const frontendTotal = frontendConstantsSource.match(
    /AI_CALL_TIMEOUT_MS\s*=\s*(\d+)\s*\*\s*1000/,
  );
  assert.ok(nativeTotal);
  assert.ok(frontendTotal);
  assert.ok(Number(nativeTotal[1]) < Number(frontendTotal[1]));
});
