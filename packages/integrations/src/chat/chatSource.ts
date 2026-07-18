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
 * Today the only loop-safe path is the metadata-only file export — the user
 * exports their chat metadata and we parse it on-device (`chatExport.ts`). The
 * destination is automated sync (Slack Web API, Microsoft Graph, Webex REST)
 * so reactive load flows in without the manual export step.
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
 * Every path through this module flows through `chatExport.ts`, whose record
 * type and parser whitelist only metadata fields (timestamps, surface,
 * direction, mention flag, thread id, participant counts, channel labels).
 * There is no field that could carry message text — so an OAuth fetcher that
 * accidentally returned bodies could never surface them, because
 * {@link ChatEventFetcher} returns {@link ChatMessageRecord}s, which have no
 * text field.
 *
 * ## Shape (mirrors `calendarSource.ts`)
 *   - {@link ChatProviderDescriptor} — static metadata per provider (id, label,
 *     how it connects, whether the loop-safe layer can run it today).
 *   - {@link ChatSource} — `sync(weekId, input?)` → `{ events, work_blocks }`.
 *   - {@link createChatExportSource} — the one source that runs in pure JS today
 *     (wraps the metadata-only file-export parser).
 *   - {@link createOAuthChatSource} — adapts a native-supplied fetcher to the
 *     same contract; the Rust follow-up injects the fetcher.
 *
 * ## Rust follow-up (when automated sync is built) — [manual / Rust]
 *   1. Add a Tauri command per OAuth provider that runs the vendor OAuth flow
 *      (Slack Web API / Microsoft Graph / Webex REST) and returns the week's
 *      metadata-only messages (`apps/desktop/src-tauri/`).
 *   2. In the frontend, build the source via {@link createOAuthChatSource} with
 *      a {@link ChatEventFetcher} that `invoke()`s the command, then flip the
 *      matching descriptor's `loopSafe` and enable its Connect button in
 *      `SetupScreen.tsx`.
 */

/** Stable id for a chat provider — reuses the per-message vendor id. */
export type ChatProviderId = ChatProvider;

/** How a provider's messages reach the app. */
export type ChatConnectionKind = "file_import" | "oauth";

export interface ChatProviderDescriptor {
  id: ChatProviderId;
  /** Human-facing name for the data-source UI. */
  label: string;
  connection: ChatConnectionKind;
  /**
   * True when the pure (loop-safe) layer can run this source today. `oauth`
   * providers stay `false` until the native connector lands — the UI renders
   * those as a disabled "coming soon" stub.
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
 * Static metadata for every chat provider, in display order.
 *
 * Slack ships a documented metadata export the loop-safe parser reads today, so
 * it is `file_import` + `loopSafe`. Teams (Microsoft Graph) and Webex (REST) are
 * API-first with no equivalent user-facing export, so they wait on the native
 * OAuth connector and render as a disabled "coming soon" stub — mirroring the
 * calendar registry's one-file-import / two-OAuth split.
 */
export const CHAT_PROVIDERS: ChatProviderDescriptor[] = [
  {
    id: "slack",
    label: "Slack (metadata export)",
    connection: "file_import",
    loopSafe: true,
    description: "Import a metadata-only Slack export. Parsed on-device — no message text, no network call."
  },
  {
    id: "teams",
    label: "Microsoft Teams",
    connection: "oauth",
    loopSafe: false,
    description: "Sync chat metadata via Microsoft Graph OAuth. Requires the native connector (coming soon)."
  },
  {
    id: "webex",
    label: "Webex",
    connection: "oauth",
    loopSafe: false,
    description: "Sync chat metadata via the Webex REST API. Requires the native connector (coming soon)."
  }
];

/** Look up a provider descriptor by id. */
export function getChatProvider(id: ChatProviderId): ChatProviderDescriptor | undefined {
  return CHAT_PROVIDERS.find((provider) => provider.id === id);
}

const CHAT_EXPORT_DESCRIPTOR = CHAT_PROVIDERS[0];

/**
 * The one chat source that runs in pure JS today: a metadata-only file export.
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
 * Adapt a native-supplied {@link ChatEventFetcher} (an OAuth provider) to the
 * {@link ChatSource} contract. The Rust follow-up provides `fetcher`; this
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
