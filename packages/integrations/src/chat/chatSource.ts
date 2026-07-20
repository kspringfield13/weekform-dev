import { importRawEvents, type RawEventImportResult } from "../import/rawEvents";
import {
  chatMessagesToImport,
  importChatExport,
  type ChatMessageRecord,
  type ChatProvider
} from "./chatExport";

/**
 * Provider-agnostic workplace-chat source.
 *
 * This is the chat analog of {@link file ../calendar/calendarSource.ts}: a single
 * {@link ChatSource} contract every provider implements, plus the pure
 * normalization (chat metadata → reactive `WorkBlock`s) that the native side
 * reuses regardless of which vendor's API fetched the messages.
 *
 * Settings now connects Slack, Google Chat, and Webex through native adapters.
 * This older wrapper remains as a compatibility boundary for normalized local
 * JSON imports and for callers that inject an already-sanitized native fetcher.
 *
 * ## Single generic `chat` signal — vendor rides on `provider`
 *
 * There is ONE `chat` `SourceType`; the specific vendor rides on each message's
 * `provider` field, not a dedicated source type (see `chatExport.ts`). The
 * descriptors here exist to label the data-source UI (which vendor the user
 * connects) and to gate which connection methods are loop-safe today — the
 * derived reactive-work signal is identical across vendors.
 *
 * ## Privacy — METADATA ONLY (hard constraint)
 *
 * Provider APIs can return message content. The Rust connectors immediately
 * project those responses into the versioned, content-free evidence contract
 * in `chatSync.ts`; message bodies and display names never cross into React.
 * This compatibility adapter likewise accepts only `ChatMessageRecord`, which
 * has no message-body field, and `chatExport.ts` discards display labels.
 *
 * ## Shape (mirrors `calendarSource.ts`)
 *   - {@link ChatProviderDescriptor} — compatibility metadata per provider.
 *   - {@link ChatSource} — `sync(weekId, input?)` → `{ events, work_blocks }`.
 *   - {@link createChatExportSource} — parses Weekform-normalized local JSON.
 *   - {@link createOAuthChatSource} — compatibility adapter for sanitized
 *     native-supplied records. The live Settings flow uses `chatSync.ts`.
 */

/** Stable id for a chat provider — reuses the per-message vendor id. */
export type ChatProviderId = Exclude<ChatProvider, "teams">;

/** How a provider's messages reach the app. */
export type ChatConnectionKind = "file_import" | "oauth";

export interface ChatProviderDescriptor {
  id: ChatProviderId;
  /** Human-facing name for the data-source UI. */
  label: string;
  connection: ChatConnectionKind;
  /**
   * Compatibility flag retained for old consumers. All three providers have
   * native desktop implementations; deployment credentials still determine
   * whether a given connection is available at runtime.
   */
  loopSafe: boolean;
  /** One-line description for the settings row / tooltip. */
  description: string;
}

/**
 * Normalized output every chat source returns — the same `{ events, work_blocks,
 * skipped }` shape as every other source import (`skipped` carries the count of
 * dropped records so callers can surface a "N skipped" note). Unlike the
 * calendar source, chat events are plain `RawEvent`s, so this is just
 * {@link RawEventImportResult} rather than a distinct shape.
 */
export type ChatSyncResult = RawEventImportResult;

/**
 * A connected chat provider. `file_import` sources parse the `input` export
 * text; `oauth` sources ignore `input` and call their injected fetcher.
 */
export interface ChatSource {
  readonly descriptor: ChatProviderDescriptor;
  sync(weekId: string, input?: string): Promise<ChatSyncResult>;
}

/**
 * Fetches one week of metadata-only chat messages. Implemented by the native
 * (Tauri/Rust) layer for OAuth providers — it owns the token exchange + network
 * call. It returns {@link ChatMessageRecord}s (which have no text field), so the
 * pure side only sessionizes + normalizes them into reactive `WorkBlock`s.
 */
export type ChatEventFetcher = (weekId: string) => Promise<ChatMessageRecord[]>;

/**
 * Compatibility metadata for the exact three providers exposed in Settings.
 * The authoritative live-connector registry and connection details live in
 * `chatSync.ts`.
 */
export const CHAT_PROVIDERS: ChatProviderDescriptor[] = [
  {
    id: "slack",
    label: "Slack",
    connection: "oauth",
    loopSafe: true,
    description: "Connect Slack through the native desktop authorization flow."
  },
  {
    id: "google_chat",
    label: "Google Chat",
    connection: "oauth",
    loopSafe: true,
    description: "Connect Google Chat through the native desktop authorization flow."
  },
  {
    id: "webex",
    label: "Webex",
    connection: "oauth",
    loopSafe: true,
    description: "Connect Webex through the native desktop authorization flow and OAuth broker."
  }
];

/** Look up a provider descriptor by id. */
export function getChatProvider(id: ChatProviderId): ChatProviderDescriptor | undefined {
  return CHAT_PROVIDERS.find((provider) => provider.id === id);
}

const CHAT_EXPORT_DESCRIPTOR: ChatProviderDescriptor = {
  id: "slack",
  label: "Weekform-normalized Chat JSON",
  connection: "file_import",
  loopSafe: true,
  description: "Import an existing Weekform-normalized Chat evidence file locally."
};

/**
 * The compatibility source that runs in pure JS: a normalized local JSON file.
 * `sync` parses the export and derives reactive work blocks for `weekId`. The
 * export is vendor-neutral (each message carries its own `provider`), so this
 * single source handles any vendor's metadata dump even though its descriptor
 * is the file-import provider.
 */
export function createChatExportSource(): ChatSource {
  return {
    descriptor: CHAT_EXPORT_DESCRIPTOR,
    async sync(weekId, input = "") {
      // Never throws (matching the calendar source): an empty export yields no
      // records, and a malformed export returns a structured empty result whose
      // `error` the caller can surface — `importChatExport` owns both cases.
      return importChatExport(input, { weekId });
    }
  };
}

/**
 * Adapt a native-supplied {@link ChatEventFetcher} to the legacy
 * {@link ChatSource} contract. The native connector provides `fetcher`; this
 * wrapper reuses the shared `chatMessagesToImport` + `importRawEvents`
 * normalization so OAuth-fetched messages produce identical reactive blocks to
 * the file-export path.
 */
export function createOAuthChatSource(
  descriptor: ChatProviderDescriptor,
  fetcher: ChatEventFetcher
): ChatSource {
  return {
    descriptor,
    async sync(weekId) {
      const messages = await fetcher(weekId);
      const imports = chatMessagesToImport(messages);
      return importRawEvents(imports, { weekId });
    }
  };
}
