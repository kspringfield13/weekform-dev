import type { AIConfig } from "../../../../packages/domain/src/models";

/** True only for the native ChatGPT/Codex-plan connection. */
export function isCodexConnection(config: AIConfig | null | undefined): boolean {
  return config?.provider === "openai" && config.connectionMode === "codex";
}

/**
 * Connection gate shared by onboarding and the feature hooks. The environment-key
 * fallback remains valid for native API-key installations, while a Codex connection
 * deliberately needs no Platform API key.
 */
export function hasAIConnection(
  config: AIConfig | null | undefined,
  hasEnvironmentOpenAIKey = false,
): boolean {
  return isCodexConnection(config) || Boolean(config?.apiKey.trim()) || hasEnvironmentOpenAIKey;
}

export function createCodexAIConfig(model: string): AIConfig {
  return {
    provider: "openai",
    connectionMode: "codex",
    apiKey: "",
    model,
    visionModel: model,
  };
}
