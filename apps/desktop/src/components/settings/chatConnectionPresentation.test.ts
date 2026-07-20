import assert from "node:assert/strict";
import test from "node:test";

import type { ChatConnectionStatus, ChatProviderActivity } from "../../hooks/useChatSources";
import { CHAT_PROVIDER_CAPABILITIES } from "../../../../../packages/integrations/src/chat/chatProviderCapabilities";
import {
  chatCapabilityNotice,
  chatConnectionPresentation,
} from "./chatConnectionPresentation";

const readyStatus: ChatConnectionStatus = {
  provider: "slack",
  available: true,
  connected: false,
  stale: false,
  readinessCode: "ready",
  detail: "This connector is ready for authorization.",
};

function activity(
  phase: ChatProviderActivity["phase"],
  overrides: Partial<ChatProviderActivity> = {},
): ChatProviderActivity {
  return {
    phase,
    message: null,
    last_synced_at: null,
    receipt: null,
    ...overrides,
  };
}

test("an unconfigured connector is plainly unavailable without exposing operator setup", () => {
  const presentation = chatConnectionPresentation({
    status: { ...readyStatus, available: false, readinessCode: "missing_client_id" },
    activity: activity("idle"),
  });

  assert.equal(presentation.stage, "unavailable");
  assert.equal(presentation.canClose, true);
  assert.equal(presentation.requiresRange, false);
  assert.match(presentation.summary, /unavailable in this build/i);
  assert.doesNotMatch(presentation.summary, /CLIENT_ID|environment|build variable/i);
});

test("a ready connector begins with access review before browser authorization", () => {
  const presentation = chatConnectionPresentation({
    status: readyStatus,
    activity: activity("idle"),
  });

  assert.equal(presentation.stage, "access_review");
  assert.equal(presentation.canClose, true);
  assert.match(presentation.primaryAction, /authorize in browser/i);
});

test("authorization and native filtering are non-dismissible connection stages", () => {
  const authorizing = chatConnectionPresentation({
    status: readyStatus,
    activity: activity("authorizing"),
  });
  const filtering = chatConnectionPresentation({
    status: { ...readyStatus, connected: true },
    activity: activity("syncing"),
  });

  assert.equal(authorizing.stage, "browser_authorization");
  assert.equal(authorizing.canClose, false);
  assert.equal(filtering.stage, "native_filtering");
  assert.equal(filtering.canClose, false);
  assert.match(filtering.summary, /content-free/i);
});

test("an initial-transfer error preserves the saved connection and offers retry", () => {
  const presentation = chatConnectionPresentation({
    status: { ...readyStatus, connected: true },
    activity: activity("error", { message: "The provider could not be reached." }),
  });

  assert.equal(presentation.stage, "transfer_error");
  assert.equal(presentation.canClose, true);
  assert.match(presentation.primaryAction, /retry transfer/i);
  assert.match(presentation.summary, /authorization is saved/i);
});

test("the wizard reports completion only after an intact initial transfer", () => {
  const presentation = chatConnectionPresentation({
    status: { ...readyStatus, connected: true },
    activity: activity("idle", {
      receipt: {
        provider: "slack",
        range: {
          start_date: "2026-07-20",
          end_date: "2026-07-20",
          start: "2026-07-20T04:00:00.000Z",
          end_exclusive: "2026-07-21T04:00:00.000Z",
        },
        coverage: "scope_limited",
        fetched_count: 1,
        normalized_count: 1,
        dropped_count: 0,
        completed_at: "2026-07-20T16:00:00.000Z",
        observed_episode_count: 1,
        directed_review_count: 0,
        detail: "Scope-limited transfer complete.",
        retry_after_seconds: null,
        checkpoint: null,
        has_more: false,
        resumed: false,
        authority_eligible: false,
        model_eligible: true,
        transform_ready: true,
        workload_applied: true,
        authoritative: false,
      },
    }),
  });

  assert.equal(presentation.stage, "complete");
  assert.equal(presentation.canClose, true);
  assert.equal(presentation.primaryAction, "Done");
});

test("end-user provider notices are derived from the shared capability facts", () => {
  const notices = Object.fromEntries(CHAT_PROVIDER_CAPABILITIES.map((capability) => [
    capability.id,
    chatCapabilityNotice(capability),
  ]));

  assert.match(notices.slack, /user scopes only/i);
  assert.match(notices.slack, /30 days/i);
  assert.match(notices.slack, /1 request per minute/i);
  assert.match(notices.slack, /15 rows/i);
  assert.match(notices.google_chat, /restricted/i);
  assert.match(notices.webex, /token-only HTTPS broker/i);
});
