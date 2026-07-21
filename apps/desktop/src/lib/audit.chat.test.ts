import assert from "node:assert/strict";
import test from "node:test";

import { createChatSyncAuditEvent } from "./audit";

test("Chat audit receipts preserve unknown transfer counts as null", () => {
  const failed = createChatSyncAuditEvent({
    provider: "slack",
    action: "sync",
    success: false,
  });

  assert.equal(failed.details.fetched_count, null);
  assert.equal(failed.details.normalized_count, null);
  assert.equal(failed.details.dropped_count, null);
  assert.equal(failed.details.observed_episode_count, null);
  assert.equal(failed.details.directed_review_count, null);
});

test("Chat audit receipts distinguish Webex credential brokering from Chat data flow", () => {
  const connected = createChatSyncAuditEvent({
    provider: "webex",
    action: "connect",
    success: true,
  });

  assert.equal(connected.details.oauth_credentials_may_transit_token_broker, true);
  assert.equal(connected.details.oauth_broker_handles_chat_data, false);
  assert.equal(connected.details.canonical_chat_evidence_sent_to_weekform_cloud, false);
  assert.equal(connected.details.derived_chat_blocks_follow_existing_replica_controls, true);
  assert.equal("chat_evidence_sent_to_weekform_cloud" in connected.details, false);
  assert.equal(connected.details.credentials_saved_to_keychain, true);
  assert.equal(connected.details.provider_keychain_state_may_have_changed, true);
  assert.equal("credentials_in_keychain" in connected.details, false);
  assert.equal(connected.details.canonical_chat_evidence_sent_to_ai, false);
  assert.equal(connected.details.derived_chat_blocks_follow_existing_ai_controls, true);
  assert.equal("chat_evidence_sent_to_ai" in connected.details, false);
});

test("a failed connection audit does not claim Keychain state stayed unchanged", () => {
  const failed = createChatSyncAuditEvent({
    provider: "slack",
    action: "connect",
    success: false,
  });

  assert.equal(failed.details.credentials_saved_to_keychain, null);
  assert.equal(failed.details.provider_keychain_state_may_have_changed, true);
});

test("public connector setup audits all providers without claiming OAuth credentials", () => {
  for (const provider of ["slack", "google_chat", "webex"] as const) {
    const configured = createChatSyncAuditEvent({
      provider,
      action: "configure",
      success: true,
    });

    assert.match(configured.title, /Connection setup completed/i);
    assert.match(configured.summary, /public connection details/i);
    assert.match(configured.summary, /without storing a Client Secret/i);
    assert.equal(configured.details.public_connection_config_saved_to_keychain, true);
    assert.equal(configured.details.client_secret_requested, false);
    assert.equal(configured.details.credentials_saved_to_keychain, null);
    assert.equal(configured.details.oauth_credentials_may_transit_token_broker, false);
  }
});

test("a failed sync audit allows for token refresh before the provider read failed", () => {
  const failed = createChatSyncAuditEvent({
    provider: "google_chat",
    action: "sync",
    success: false,
  });

  assert.equal(failed.details.provider_keychain_state_may_have_changed, true);
});

test("a failed disconnect audit preserves unknown partial Keychain mutation truth", () => {
  const failed = createChatSyncAuditEvent({
    provider: "webex",
    action: "disconnect",
    success: false,
  });

  assert.equal(failed.details.credentials_removed, null);
  assert.equal(failed.details.provider_keychain_state_may_have_changed, true);
});

test("scope-limited Slack audit distinguishes additive workload application from replacement authority", () => {
  const applied = createChatSyncAuditEvent({
    provider: "slack",
    action: "sync",
    success: true,
    coverage: "scope_limited",
    observedEpisodeCount: 2,
    directedReviewCount: 1,
    workloadApplied: true,
    authoritative: false,
    hasMore: false,
  });

  assert.match(applied.summary, /applied additively/i);
  assert.equal(applied.details.workload_model_applied, true);
  assert.equal(applied.details.destructive_replacement_authority, false);
  assert.equal("authoritative_workload_transform" in applied.details, false);
});

test("resumable pages and blocked transfers never claim a completed sync", () => {
  const resumable = createChatSyncAuditEvent({
    provider: "slack",
    action: "sync",
    success: true,
    coverage: "partial",
    hasMore: true,
    normalizedCount: 2,
  });
  assert.match(resumable.title, /page retained/i);
  assert.doesNotMatch(resumable.title, /completed/i);

  const blocked = createChatSyncAuditEvent({
    provider: "google_chat",
    action: "sync",
    success: false,
    coverage: "permission_limited",
    hasMore: false,
    normalizedCount: 0,
  });
  assert.match(blocked.title, /incomplete/i);
  assert.equal(blocked.details.success, false);
  assert.equal(blocked.details.workload_model_applied, false);
});
