import type { AgentChatMessage } from "../lib/types";

export const AGENT_CHAT_STORAGE_KEY = "clear-capacity.agent-chat.v2";
export const AGENT_DRAFT_STORAGE_KEY = "clear-capacity.agent-draft.v1";

interface RemovableStorage {
  removeItem: (key: string) => void;
}

interface ReadableStorage {
  getItem: (key: string) => string | null;
}

export interface AgentSessionBackup {
  messages: AgentChatMessage[];
  draft: string;
}

function parseMessage(value: unknown): AgentChatMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string"
    || (record.role !== "user" && record.role !== "assistant")
    || typeof record.content !== "string"
    || record.content.trim() === ""
  ) return null;
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
    ...(typeof record.analysisSummary === "string"
      ? { analysisSummary: record.analysisSummary }
      : {}),
    ...(typeof record.interrupted === "boolean" ? { interrupted: record.interrupted } : {}),
  };
}

/** Reads the separate Agent conversation boundary for an explicit full backup. */
export function readAgentSessionStorage(
  storage: ReadableStorage = window.localStorage,
): AgentSessionBackup {
  const encodedMessages = storage.getItem(AGENT_CHAT_STORAGE_KEY);
  let messages: AgentChatMessage[] = [];
  if (encodedMessages) {
    try {
      const parsed: unknown = JSON.parse(encodedMessages);
      if (Array.isArray(parsed)) {
        messages = parsed.flatMap((value) => {
          const message = parseMessage(value);
          return message ? [message] : [];
        }).slice(-200);
      }
    } catch {
      // Corrupt history is not replayable by the Agent and is omitted just as it
      // is on screen; the readable draft is still preserved independently.
    }
  }
  return {
    messages,
    draft: storage.getItem(AGENT_DRAFT_STORAGE_KEY) ?? "",
  };
}

/**
 * Clears the Agent's separate browser-storage surfaces during Reset Local Data.
 * Each removal is best effort so one unavailable key cannot prevent the other
 * (or the rest of the durable reset) from being attempted.
 */
export function clearAgentSessionStorage(
  storage: RemovableStorage = window.localStorage,
): boolean {
  let cleared = true;
  for (const key of [AGENT_CHAT_STORAGE_KEY, AGENT_DRAFT_STORAGE_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      cleared = false;
    }
  }
  return cleared;
}
