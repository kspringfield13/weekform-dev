import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_PROVIDER_CAPABILITIES,
  chatProviderCapability,
} from "./chatProviderCapabilities";

test("the shared capability registry contains exactly the three native Chat connectors", () => {
  assert.deepEqual(
    CHAT_PROVIDER_CAPABILITIES.map(({ id, label }) => ({ id, label })),
    [
      { id: "slack", label: "Slack" },
      { id: "google_chat", label: "Google Chat" },
      { id: "webex", label: "Webex" },
    ],
  );
  assert.equal(chatProviderCapability("slack").label, "Slack");
  assert.throws(
    () => chatProviderCapability("teams" as never),
    /Unsupported chat provider: teams/,
  );
});

test("every connector shares the bounded manual transfer and native privacy contract", () => {
  for (const capability of CHAT_PROVIDER_CAPABILITIES) {
    assert.deepEqual(capability.transfer.range, {
      selection: "manual",
      endBoundary: "inclusive",
      maxDays: 90,
    });
    assert.equal(capability.authorization.browser, "system");
    assert.equal(capability.security.credentials, "macos_keychain");
    assert.equal(capability.security.filtering, "native_content_free_projection");
    assert.match(capability.contentBoundary, /discarded at the native boundary/i);
    assert.equal(capability.operatorSetup.buildSettings.length > 0, true);
    assert.equal(capability.authorization.accessItems.length > 0, true);
  }
});

test("Slack encodes GA desktop PKCE, user-only scopes, rotating tokens, and scope-limited transfer facts", () => {
  const slack = chatProviderCapability("slack");

  assert.equal(slack.authorization.flow, "desktop_pkce");
  assert.equal(slack.authorization.callback, "loopback");
  assert.equal(slack.authorization.tokenExchange, "native_pkce");
  assert.equal(slack.authorization.scopeClassification, "user_only");
  assert.equal(slack.authorization.desktopRedirectScopeKind, "user_only");
  assert.equal(slack.authorization.desktopPkceStatus, "ga_2026_03");
  assert.deepEqual(slack.authorization.scopes, [
    "channels:read",
    "groups:read",
    "im:read",
    "mpim:read",
    "channels:history",
    "groups:history",
    "im:history",
    "mpim:history",
  ]);
  assert.equal(slack.security.tokenRotation, true);
  assert.equal(slack.security.refreshTokenMaxAgeDays, 30);
  assert.equal(slack.transfer.reconciliation, "additive_scope_limited");
  assert.deepEqual(slack.transfer.providerLimit, {
    appliesTo: "non_marketplace_conversations_history",
    requestsPerMinute: 1,
    rowsPerRequest: 15,
  });
});

test("Google Chat encodes loopback PKCE, restricted read-only message access, and intact-run authority", () => {
  const google = chatProviderCapability("google_chat");

  assert.equal(google.authorization.flow, "desktop_pkce");
  assert.equal(google.authorization.callback, "loopback");
  assert.equal(google.authorization.tokenExchange, "native_pkce");
  assert.equal(google.authorization.scopeClassification, "restricted");
  assert.equal(
    google.authorization.scopes.includes(
      "https://www.googleapis.com/auth/chat.messages.readonly",
    ),
    true,
  );
  assert.equal(google.security.tokenRotation, null);
  assert.equal(google.security.refreshTokenMaxAgeDays, null);
  assert.equal(google.transfer.reconciliation, "authoritative_intact_run");
  assert.equal(google.transfer.providerLimit, null);
});

test("Webex remains confidential and routes credentials through the existing token-only HTTPS broker", () => {
  const webex = chatProviderCapability("webex");

  assert.equal(webex.authorization.flow, "confidential_broker");
  assert.equal(webex.authorization.callback, "loopback");
  assert.equal(webex.authorization.tokenExchange, "token_only_https_broker");
  assert.equal(webex.authorization.scopeClassification, "confidential");
  assert.equal(webex.requiresBroker, true);
  assert.equal(webex.operatorSetup.buildSettings.includes("WEEKFORM_CHAT_OAUTH_BROKER_URL"), true);
  assert.equal(webex.operatorSetup.buildSettings.includes("WEBEX_CHAT_BROKER_SECURITY_VERIFIED"), true);
  assert.equal(webex.transfer.reconciliation, "authoritative_intact_run");
  assert.equal(webex.transfer.providerLimit, null);
});

test("operator-only setup details remain nested instead of leaking into end-user summaries", () => {
  for (const capability of CHAT_PROVIDER_CAPABILITIES) {
    const endUserPresentation = JSON.stringify({
      description: capability.description,
      authorization: capability.authorization.summary,
      access: capability.authorization.accessItems,
      privacy: capability.contentBoundary,
    });

    for (const setting of capability.operatorSetup.buildSettings) {
      assert.equal(endUserPresentation.includes(setting), false);
    }
  }
});
