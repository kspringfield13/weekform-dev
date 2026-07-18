// Sample metadata-only chat export used to exercise the parser in
// `chatExport.ts` (there is no automated test runner). Mirrors
// the way `git/fixture.ts` validates the git parser.
//
// PRIVACY: this is the canonical shape an export takes — note there is NO
// message-text field anywhere. Every entry is timestamps + channel/DM/thread
// surface + direction + mention flag + thread id + participant/channel labels.
//
// Shape exercised by this fixture (all one `slack` provider — orgs standardize
// on one chat app):
//   - #data-requests: a morning burst of 3 messages within ~11min (→ one
//     reactive session), 2 received + 1 sent, 2 @-mentions, one threaded.
//   - a DM burst >20min later (→ a second session), 2 received, 1 mention.
//   - a lone #incidents ping in the afternoon (→ a third, single-message
//     session that must still produce a non-zero block).
//   - a malformed entry (no timestamp) and a bad-provider entry that must be
//     dropped.

export const SAMPLE_CHAT_EXPORT = JSON.stringify({
  messages: [
    {
      timestamp: "2026-06-22T09:01:00Z",
      provider: "slack",
      surface: "channel",
      direction: "received",
      mentioned_me: true,
      thread_id: null,
      participant_count: 6,
      channel_name: "#data-requests"
    },
    {
      timestamp: "2026-06-22T09:05:00Z",
      provider: "slack",
      surface: "thread",
      direction: "sent",
      mentioned_me: false,
      thread_id: "T-1042",
      participant_count: 6,
      channel_name: "#data-requests"
    },
    {
      timestamp: "2026-06-22T09:12:00Z",
      provider: "slack",
      surface: "channel",
      direction: "received",
      mentioned_me: true,
      thread_id: null,
      participant_count: 6,
      channel_name: "#data-requests"
    },
    {
      timestamp: "2026-06-22T11:40:00Z",
      provider: "slack",
      surface: "dm",
      direction: "received",
      mentioned_me: true,
      thread_id: null,
      participant_count: 2,
      channel_name: "DM · Priya N."
    },
    {
      timestamp: "2026-06-22T11:52:00Z",
      provider: "slack",
      surface: "dm",
      direction: "received",
      mentioned_me: false,
      thread_id: null,
      participant_count: 2,
      channel_name: "DM · Priya N."
    },
    {
      timestamp: "2026-06-22T15:30:00Z",
      provider: "slack",
      surface: "channel",
      direction: "received",
      mentioned_me: true,
      thread_id: null,
      participant_count: 12,
      channel_name: "#incidents"
    },
    {
      provider: "slack",
      surface: "channel",
      direction: "received",
      mentioned_me: false,
      channel_name: "#dropped-no-timestamp"
    },
    {
      timestamp: "2026-06-22T16:10:00Z",
      provider: "carrier-pigeon",
      surface: "channel",
      direction: "received",
      mentioned_me: false,
      channel_name: "#dropped-bad-provider"
    }
  ]
});
