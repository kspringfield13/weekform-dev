import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_SETUP_GUIDES,
  chatSetupState,
} from "./chatSetupGuides";

test("each Chat provider points to its official credential console and setup documentation", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(CHAT_SETUP_GUIDES).map(([provider, guide]) => [
      provider,
      [guide.credentialsUrl, guide.docsUrl],
    ])),
    {
      slack: [
        "https://api.slack.com/apps",
        "https://docs.slack.dev/authentication/using-pkce/",
      ],
      google_chat: [
        "https://console.cloud.google.com/apis/credentials",
        "https://developers.google.com/workspace/chat/authenticate-authorize",
      ],
      webex: [
        "https://developer.webex.com/my-apps",
        "https://developer.webex.com/docs/integrations",
      ],
    },
  );
});

test("setup guides name every build setting needed before authorization", () => {
  assert.deepEqual(CHAT_SETUP_GUIDES.slack.buildSettings, ["SLACK_CHAT_CLIENT_ID"]);
  assert.deepEqual(CHAT_SETUP_GUIDES.google_chat.buildSettings, ["GOOGLE_CHAT_CLIENT_ID"]);
  assert.deepEqual(CHAT_SETUP_GUIDES.webex.buildSettings, [
    "WEBEX_CHAT_CLIENT_ID",
    "WEBEX_CHAT_REDIRECT_URI",
    "WEEKFORM_CHAT_OAUTH_BROKER_URL",
    "WEBEX_CHAT_BROKER_SECURITY_VERIFIED",
  ]);
});

test("the wizard distinguishes build setup, authorization, and completed connections", () => {
  assert.equal(chatSetupState(undefined), "checking");
  assert.equal(chatSetupState({ available: false, connected: false, stale: false }), "needs_setup");
  assert.equal(chatSetupState({ available: true, connected: false, stale: false }), "ready_to_authorize");
  assert.equal(chatSetupState({ available: true, connected: true, stale: false }), "connected");
  assert.equal(chatSetupState({ available: true, connected: true, stale: true }), "checking");
});
