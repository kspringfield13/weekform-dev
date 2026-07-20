import { invoke } from "@tauri-apps/api/core";
import type { AIConfig } from "../../../../packages/domain/src/models";
import { withAiTimeout } from "../lib/aiTimeout";

/**
 * Generic AI request shape mirrored by the Rust `ai_complete` command.
 *
 * Every AI operation flows through this one Tauri command: the frontend owns
 * the operation-specific pieces (instructions, response schema, sampling) and
 * Rust keeps only the native concerns (credentials, direct HTTP or Codex
 * app-server transport). This keeps prompt and schema tuning in TypeScript.
 *
 * Note: `aiConfig` is passed through verbatim. Rust accepts its camelCase
 * fields. API-key mode resolves a provider-specific key/base URL; Codex mode
 * delegates to the isolated native app-server and needs no Platform key.
 */
export interface AiCompleteRequest {
  prompt: string;
  instructions: string;
  /** Goes verbatim into the provider request's text.format field. */
  responseFormat: Record<string, unknown>;
  model?: string;
  temperature?: number;
  topP?: number;
  reasoningEffort?: string;
  aiConfig?: AIConfig | null;
}

export interface AiCompleteResponse {
  outputText: string;
  model: string;
}

/** Build a strict json_schema response format for a structured operation. */
export function jsonSchemaFormat(name: string, schema: Record<string, unknown>) {
  return {
    type: "json_schema",
    name,
    strict: true,
    schema
  } as const;
}

/** Plain-text response format for conversational operations. */
export const textFormat = { type: "text" } as const;

export async function aiComplete(request: AiCompleteRequest): Promise<AiCompleteResponse> {
  return withAiTimeout(invoke<AiCompleteResponse>("ai_complete", { request }));
}

/**
 * Run a structured operation and parse the JSON result. The caller supplies the
 * expected type; validation beyond JSON.parse stays the caller's responsibility
 * since the provider already enforces the strict schema server-side.
 */
export async function aiCompleteJson<T>(
  request: AiCompleteRequest
): Promise<{ data: T; model: string }> {
  const response = await aiComplete(request);
  let data: T;
  try {
    data = JSON.parse(response.outputText) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AI response was not valid JSON: ${message}`);
  }
  return { data, model: response.model };
}
