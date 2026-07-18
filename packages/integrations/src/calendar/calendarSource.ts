import type { OutlookCalendarEvent, WorkBlock } from "../../../domain/src/models";
import { outlookEventsToWorkBlocks, parseOutlookIcs } from "./outlookIcs";

/**
 * Provider-agnostic calendar source.
 *
 * Today the only wired calendar path is the manual Outlook `.ics` export —
 * the biggest onboarding wall, since it needs a human to export a file before
 * any meeting shows up. The destination is automated sync (Google Calendar,
 * Microsoft 365 / Graph) so meetings flow in without the manual step.
 *
 * The OAuth token dance + network fetch must live in the Tauri/Rust layer
 * (`apps/desktop/src-tauri/`) — they're out of loop scope. This module is the
 * pure, loop-safe half: a single `CalendarSource` contract every provider
 * implements, plus the normalization (provider events → `WorkBlock`s) that the
 * native side reuses regardless of which provider fetched the events.
 *
 * ## Shape (mirrors the source-import pattern)
 *   - {@link CalendarProviderDescriptor} — static metadata per provider (id,
 *     label, how it connects, whether the loop-safe layer can run it today).
 *   - {@link CalendarSource} — `sync(weekId, input?)` → `{ events, work_blocks }`.
 *   - {@link createOutlookIcsSource} — the one concrete source that runs in
 *     pure JS today (wraps `parseOutlookIcs` + `outlookEventsToWorkBlocks`).
 *   - {@link createOAuthCalendarSource} — adapts a native-supplied fetcher to
 *     the same contract; the Rust follow-up injects the fetcher.
 *
 * ## Rust follow-up (when automated sync is built)
 *   1. Add a Tauri command per OAuth provider that runs the OAuth flow and
 *      returns calendar events for a week (`apps/desktop/src-tauri/`).
 *   2. Widen `OutlookCalendarEvent.source` in `packages/domain/src/models.ts`
 *      from the `"outlook_ics"` literal to a union
 *      (`"outlook_ics" | "google" | "microsoft_graph"`) so fetched events can
 *      carry their true origin; the parser keeps emitting `"outlook_ics"`.
 *   3. In the frontend, build the source via {@link createOAuthCalendarSource}
 *      with a fetcher that `invoke()`s the command, then flip the matching
 *      descriptor's `loopSafe`/availability and enable its Connect button in
 *      `SetupScreen.tsx`.
 */

/** Stable id for a calendar provider. */
export type CalendarProviderId = "outlook_ics" | "google" | "microsoft_graph";

/** How a provider's events reach the app. */
export type CalendarConnectionKind = "file_import" | "oauth";

export interface CalendarProviderDescriptor {
  id: CalendarProviderId;
  /** Human-facing name for the data-source UI. */
  label: string;
  connection: CalendarConnectionKind;
  /**
   * True when the pure (loop-safe) layer can run this source today. `oauth`
   * providers stay `false` until the native connector lands — the UI renders
   * those as a disabled "coming soon" stub.
   */
  loopSafe: boolean;
  /** One-line description for the settings row / tooltip. */
  description: string;
}

/** Normalized output every calendar source returns. */
export interface CalendarSyncResult {
  /** Calendar events for the synced week. */
  events: OutlookCalendarEvent[];
  /** Work blocks derived from `events`, sorted by start time. */
  work_blocks: WorkBlock[];
}

/**
 * A connected calendar provider. `file_import` sources parse the `input`
 * export text; `oauth` sources ignore `input` and call their injected fetcher.
 */
export interface CalendarSource {
  readonly descriptor: CalendarProviderDescriptor;
  sync(weekId: string, input?: string): Promise<CalendarSyncResult>;
}

/**
 * Fetches calendar events for one week. Implemented by the native (Tauri/Rust)
 * layer for OAuth providers — it owns the token exchange + network call. The
 * pure side only normalizes the result into `WorkBlock`s.
 */
export type CalendarEventFetcher = (weekId: string) => Promise<OutlookCalendarEvent[]>;

/** Static metadata for every calendar provider, in display order. */
export const CALENDAR_PROVIDERS: CalendarProviderDescriptor[] = [
  {
    id: "outlook_ics",
    label: "Outlook (.ics export)",
    connection: "file_import",
    loopSafe: true,
    description: "Import a local .ics calendar export. Parsed on-device — no network call."
  },
  {
    id: "google",
    label: "Google Calendar",
    connection: "oauth",
    loopSafe: false,
    description: "Sync meetings via Google OAuth. Requires the native connector (coming soon)."
  },
  {
    id: "microsoft_graph",
    label: "Microsoft 365",
    connection: "oauth",
    loopSafe: false,
    description: "Sync meetings via Microsoft Graph OAuth. Requires the native connector (coming soon)."
  }
];

/** Look up a provider descriptor by id. */
export function getCalendarProvider(id: CalendarProviderId): CalendarProviderDescriptor | undefined {
  return CALENDAR_PROVIDERS.find((provider) => provider.id === id);
}

const OUTLOOK_ICS_DESCRIPTOR = CALENDAR_PROVIDERS[0];

/**
 * The one calendar source that runs in pure JS today: a local `.ics` export.
 * `sync` parses the export text and derives meeting work blocks for `weekId`.
 */
export function createOutlookIcsSource(): CalendarSource {
  return {
    descriptor: OUTLOOK_ICS_DESCRIPTOR,
    async sync(weekId, input = "") {
      const events = parseOutlookIcs(input);
      return { events, work_blocks: outlookEventsToWorkBlocks(events, weekId) };
    }
  };
}

/**
 * Adapt a native-supplied {@link CalendarEventFetcher} (an OAuth provider) to
 * the {@link CalendarSource} contract. The Rust follow-up provides `fetcher`;
 * this wrapper reuses the shared `outlookEventsToWorkBlocks` normalization so
 * OAuth-fetched meetings produce identical work blocks to the `.ics` path.
 */
export function createOAuthCalendarSource(
  descriptor: CalendarProviderDescriptor,
  fetcher: CalendarEventFetcher
): CalendarSource {
  return {
    descriptor,
    async sync(weekId) {
      const events = await fetcher(weekId);
      return { events, work_blocks: outlookEventsToWorkBlocks(events, weekId) };
    }
  };
}
