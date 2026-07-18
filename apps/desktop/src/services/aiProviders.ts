import type { AIConfig, AIProvider } from "../../../../packages/domain/src/models";

export interface AIProviderPreset {
  value: AIProvider;
  label: string;
  baseUrl: string;
  model: string;
  visionModel?: string;
  modelNote: string;
  /** Helper text under the Base URL field. */
  baseUrlNote: string;
  /** Helper text under the optional Vision Model field. */
  visionNote: string;
  /** Recommended model IDs offered as click-to-fill chips under the Model field. */
  modelSuggestions?: string[];
  /** External provider model/docs reference, linked from the form header. */
  docsUrl?: string;
  keyPlaceholder: string;
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    value: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4-mini",
    visionModel: "gpt-5.4-mini",
    modelNote: "Fast, cost-conscious default with structured output and vision.",
    baseUrlNote: "OpenAI's API endpoint. Change it only if you route through a proxy or Azure gateway.",
    visionNote: "Model used for opt-in screenshot analysis. Leave blank to reuse the model above.",
    docsUrl: "https://platform.openai.com/docs/models",
    keyPlaceholder: "sk-..."
  },
  {
    value: "grok",
    label: "Grok (xAI)",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.3",
    visionModel: "grok-4.3",
    modelNote: "xAI's recommended general-purpose model, with structured output and vision.",
    baseUrlNote: "xAI's OpenAI-compatible endpoint. The default works for hosted Grok.",
    visionNote: "Model used for opt-in screenshot analysis. Leave blank to reuse the model above.",
    docsUrl: "https://docs.x.ai/docs/models",
    keyPlaceholder: "xai-..."
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    modelNote: "DeepSeek's lower-cost V4 model for text and structured output.",
    baseUrlNote: "DeepSeek's OpenAI-compatible endpoint. The default works for the hosted API.",
    visionNote: "DeepSeek has no vision model — visual context stays unavailable for this provider.",
    docsUrl: "https://api-docs.deepseek.com/quick_start/pricing",
    keyPlaceholder: "sk-..."
  },
  {
    value: "custom",
    label: "Custom / OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    modelNote: "Enter a model ID supported by your OpenAI-compatible endpoint.",
    baseUrlNote: "Your endpoint's base URL, including the version path (e.g. /v1) if it needs one.",
    visionNote: "Optional vision-capable model ID, if your endpoint accepts image input.",
    keyPlaceholder: "API key"
  }
];

export function getAIProviderPreset(provider: AIProvider): AIProviderPreset {
  return AI_PROVIDER_PRESETS.find((preset) => preset.value === provider) ?? AI_PROVIDER_PRESETS[0];
}

/**
 * Short, human display label for a provider — used in audit trails and block-evidence
 * lines so attribution names the configured provider instead of a hardcoded "OpenAI".
 * (The preset `label`s are form-facing and too verbose for prose, e.g. "Grok (xAI)".)
 */
export function aiProviderLabel(provider: AIProvider): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "grok":
      return "Grok";
    case "deepseek":
      return "DeepSeek";
    case "custom":
      return "your AI provider";
    default:
      return "your AI provider";
  }
}

/**
 * Audit `source` id for a provider's generation or vision call. The Rust layer posts the
 * OpenAI Responses shape to every provider, so only the provider prefix varies; the
 * historical `openai_responses_api`/`openai_vision` ids are preserved for OpenAI so existing
 * (and demo) audit rows stay consistent. Humanized for display by `sourceLabel` (`lib/format`).
 */
export function aiAuditSource(provider: AIProvider, kind: "responses" | "vision" = "responses"): string {
  return kind === "vision" ? `${provider}_vision` : `${provider}_responses_api`;
}

/**
 * Whether a provider can currently power the Rust-mediated GENERATION features
 * (classification, forecast, narrative, Review Copilot, acceleration, visual context).
 * Every generation command posts the OpenAI Responses shape to `POST {base_url}/responses`
 * with `bearer_auth` (see `lib.rs`), and only OpenAI serves that endpoint — the other hosted
 * providers pass the lightweight `test_ai_connection` `/models` check and then 404 on every
 * real feature, so for now they power only the webview-direct Agent chat. `custom` is
 * user-routed and may proxy an OpenAI-compatible Responses endpoint, so it is left to try.
 * Native follow-up (see STATUS): provider-aware request shapes in `lib.rs`.
 */
export function providerSupportsGeneration(provider: AIProvider): boolean {
  return provider === "openai" || provider === "custom";
}

/** Clear, provider-named error for when a generation hook is asked to run on an
 * unsupported provider — surfaced through each hook's existing failure path instead of
 * letting the request 404/time out with an opaque message. */
export function generationProviderUnsupportedMessage(provider: AIProvider): string {
  return (
    `${aiProviderLabel(provider)} currently powers only the Agent chat — the app's other AI features ` +
    "need an OpenAI (or OpenAI-compatible) key. Switch the provider in Settings to use this feature."
  );
}

export function createDefaultAIConfig(provider: AIProvider = "openai"): AIConfig {
  const preset = getAIProviderPreset(provider);
  return {
    provider,
    apiKey: "",
    baseUrl: preset.baseUrl,
    model: preset.model,
    visionModel: preset.visionModel
  };
}

const RETIRED_APP_DEFAULTS: Partial<Record<AIProvider, Record<string, string>>> = {
  openai: { "gpt-4o": "gpt-5.4-mini" },
  grok: { "grok-2-1212": "grok-4.3" },
  deepseek: {
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-flash"
  }
};

export function upgradeRetiredAppDefault(config: AIConfig): AIConfig {
  const replacement = RETIRED_APP_DEFAULTS[config.provider]?.[config.model];
  if (!replacement) return config;

  const preset = getAIProviderPreset(config.provider);
  return {
    ...config,
    model: replacement,
    visionModel:
      !config.visionModel || config.visionModel === config.model
        ? preset.visionModel
        : config.visionModel
  };
}
