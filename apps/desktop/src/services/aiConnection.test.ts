import assert from "node:assert/strict";
import test from "node:test";

import type { AIConfig } from "../../../../packages/domain/src/models";
import {
  createCodexAIConfig,
  hasAIConnection,
  isCodexConnection,
} from "./aiConnection";
import { aiAuditSource } from "./aiProviders";

const legacyApiConfig: AIConfig = {
  provider: "openai",
  apiKey: "sk-test",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.4-mini",
};

test("legacy API-key configurations remain connected", () => {
  assert.equal(isCodexConnection(legacyApiConfig), false);
  assert.equal(hasAIConnection(legacyApiConfig, false), true);
});

test("the environment key remains a valid API connection fallback", () => {
  assert.equal(hasAIConnection(null, true), true);
  assert.equal(hasAIConnection(null, false), false);
});

test("a ChatGPT-backed Codex configuration is connected without an API key", () => {
  const config = createCodexAIConfig("gpt-5.6-sol");

  assert.equal(config.connectionMode, "codex");
  assert.equal(config.provider, "openai");
  assert.equal(config.apiKey, "");
  assert.equal(config.model, "gpt-5.6-sol");
  assert.equal(isCodexConnection(config), true);
  assert.equal(hasAIConnection(config, false), true);
  assert.equal(aiAuditSource(config.provider, "responses", config.connectionMode), "codex_app_server");
  assert.equal(aiAuditSource(config.provider, "vision", config.connectionMode), "codex_app_server_vision");
});
