import assert from "node:assert/strict";
import test from "node:test";

import type { ChatConnectionStatus, ChatProviderActivity } from "../../hooks/useChatSources";
import { CHAT_PROVIDER_CAPABILITIES } from "../../../../../packages/integrations/src/chat/chatProviderCapabilities";
import {
  chatCapabilityNotice,
  chatConnectionPresentation,
  chatProviderSetupPresentation,
  normalizeChatProviderSetupInput,
  normalizeSlackClientIdInput,
  slackClientIdSetupPresentation,
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

test("Slack Client ID input accepts only the public numeric identifier", () => {
  assert.equal(normalizeSlackClientIdInput(" 1234567890.1234567890123 "), "1234567890.1234567890123");
  assert.throws(() => normalizeSlackClientIdInput(""), /Client ID/i);
  assert.throws(() => normalizeSlackClientIdInput("client-secret-value"), /Client ID/i);
  assert.throws(() => normalizeSlackClientIdInput("123.456.extra"), /Client ID/i);
});

test("Slack setup is inline when missing and remains editable before connection", () => {
  const missing = slackClientIdSetupPresentation({
    ...readyStatus,
    available: false,
    readinessCode: "missing_client_id",
  });
  assert.deepEqual(missing, { visible: true, canEdit: true });

  assert.deepEqual(slackClientIdSetupPresentation(readyStatus), {
    visible: false,
    canEdit: true,
  });
  assert.deepEqual(slackClientIdSetupPresentation({ ...readyStatus, connected: true }), {
    visible: false,
    canEdit: false,
  });
  assert.deepEqual(slackClientIdSetupPresentation({ ...readyStatus, readinessCode: "unknown" }), {
    visible: false,
    canEdit: false,
  });
});

test("Google Chat setup accepts only a public desktop OAuth Client ID", () => {
  assert.deepEqual(normalizeChatProviderSetupInput({
    provider: "google_chat",
    clientId: " 123456789-abcDEF.apps.googleusercontent.com ",
  }), {
    provider: "google_chat",
    clientId: "123456789-abcDEF.apps.googleusercontent.com",
  });
  assert.throws(
    () => normalizeChatProviderSetupInput({ provider: "google_chat", clientId: "client-secret-value" }),
    /Google Chat Client ID/i,
  );
  assert.throws(
    () => normalizeChatProviderSetupInput({ provider: "google_chat", clientId: "https://accounts.google.com" }),
    /Google Chat Client ID/i,
  );
});

test("Webex setup validates all public connection fields without accepting a secret", () => {
  assert.deepEqual(normalizeChatProviderSetupInput({
    provider: "webex",
    clientId: " webex-public-client-id ",
    redirectUri: " http://127.0.0.1:49323/chat-auth/callback ",
    brokerUrl: " https://weekform.dev/api ",
  }), {
    provider: "webex",
    clientId: "webex-public-client-id",
    redirectUri: "http://127.0.0.1:49323/chat-auth/callback",
    brokerUrl: "https://weekform.dev/api",
  });
  assert.throws(
    () => normalizeChatProviderSetupInput({
      provider: "webex",
      clientId: "https://developer.webex.com/client",
      redirectUri: "http://127.0.0.1:49323/chat-auth/callback",
      brokerUrl: "https://weekform.dev/api",
    }),
    /Webex Client ID/i,
  );
  assert.throws(
    () => normalizeChatProviderSetupInput({
      provider: "webex",
      clientId: "webex-public-client-id",
      redirectUri: "https://weekform.dev/chat-auth/callback",
      brokerUrl: "https://weekform.dev/api",
    }),
    /loopback/i,
  );
  assert.throws(
    () => normalizeChatProviderSetupInput({
      provider: "webex",
      clientId: "webex-public-client-id",
      redirectUri: "http://127.0.0.1:49323/chat-auth/callback",
      brokerUrl: "http://weekform.dev/api",
    }),
    /HTTPS/i,
  );
});

test("provider setup is inline only for missing public fields and editable until connected", () => {
  const googleMissing = chatProviderSetupPresentation("google_chat", {
    ...readyStatus,
    provider: "google_chat",
    available: false,
    readinessCode: "missing_client_id",
  });
  assert.deepEqual(googleMissing, { visible: true, canEdit: true });

  const webexMissingBroker = chatProviderSetupPresentation("webex", {
    ...readyStatus,
    provider: "webex",
    available: false,
    readinessCode: "missing_broker_url",
  });
  assert.deepEqual(webexMissingBroker, { visible: true, canEdit: true });

  const webexReview = chatProviderSetupPresentation("webex", {
    ...readyStatus,
    provider: "webex",
    available: false,
    readinessCode: "broker_security_review_required",
  });
  assert.deepEqual(webexReview, { visible: false, canEdit: true });
  assert.deepEqual(chatProviderSetupPresentation("webex", {
    ...readyStatus,
    provider: "webex",
    connected: true,
  }), { visible: false, canEdit: false });
});
