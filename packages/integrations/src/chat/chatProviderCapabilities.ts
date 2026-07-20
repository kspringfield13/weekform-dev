/** Native Chat connectors exposed by Weekform. Legacy Teams files remain import-only. */
export type ChatProviderId = "slack" | "google_chat" | "webex";

export type ChatAuthorizationFlow = "desktop_pkce" | "confidential_broker";
export type ChatScopeClassification = "user_only" | "restricted" | "confidential";
export type ChatReconciliationMode =
  | "additive_scope_limited"
  | "authoritative_intact_run";

export interface ChatProviderCapability {
  id: ChatProviderId;
  label: string;
  connection: "oauth_pkce" | "oauth_broker";
  description: string;
  contentBoundary: string;
  requiresBroker: boolean;
  authorization: {
    flow: ChatAuthorizationFlow;
    browser: "system";
    callback: "loopback";
    tokenExchange: "native_pkce" | "token_only_https_broker";
    scopeClassification: ChatScopeClassification;
    desktopPkceStatus: "ga_2026_03" | null;
    desktopRedirectScopeKind: "user_only" | null;
    scopes: readonly string[];
    summary: string;
    accessItems: readonly string[];
  };
  transfer: {
    range: {
      selection: "manual";
      endBoundary: "inclusive";
      maxDays: 90;
    };
    reconciliation: ChatReconciliationMode;
    providerLimit: {
      appliesTo: "non_marketplace_conversations_history";
      requestsPerMinute: 1;
      rowsPerRequest: 15;
    } | null;
  };
  security: {
    credentials: "macos_keychain";
    filtering: "native_content_free_projection";
    tokenRotation: true | null;
    refreshTokenMaxAgeDays: 30 | null;
  };
  /** Deployment/operator details. End-user presentation should disclose this only on request. */
  operatorSetup: {
    credentialsUrl: string;
    credentialsLinkLabel: string;
    docsUrl: string;
    docsLinkLabel: string;
    buildSettings: readonly string[];
    summary: string;
  };
}

const RANGE = {
  selection: "manual",
  endBoundary: "inclusive",
  maxDays: 90,
} as const;

const CONTENT_BOUNDARY =
  "Message content is discarded at the native boundary before reviewable evidence reaches the app.";

/**
 * Single source of truth for capability, access-review, privacy, and operator
 * setup presentation across the native Chat connection flow.
 */
export const CHAT_PROVIDER_CAPABILITIES = [
  {
    id: "slack",
    label: "Slack",
    connection: "oauth_pkce",
    description:
      "Sync top-level evidence from currently listed, non-archived conversations. Thread replies and inaccessible history remain outside the transfer scope.",
    contentBoundary: CONTENT_BOUNDARY,
    requiresBroker: false,
    authorization: {
      flow: "desktop_pkce",
      browser: "system",
      callback: "loopback",
      tokenExchange: "native_pkce",
      scopeClassification: "user_only",
      desktopPkceStatus: "ga_2026_03",
      desktopRedirectScopeKind: "user_only",
      scopes: [
        "channels:read",
        "groups:read",
        "im:read",
        "mpim:read",
        "channels:history",
        "groups:history",
        "im:history",
        "mpim:history",
      ],
      summary:
        "Slack opens in your system browser so you can choose a workspace and approve read-only user access.",
      accessItems: [
        "List the conversations you can already access",
        "Read top-level channel, group, and direct-message history",
        "Keep authorization refreshable without storing it in app settings",
      ],
    },
    transfer: {
      range: RANGE,
      reconciliation: "additive_scope_limited",
      providerLimit: {
        appliesTo: "non_marketplace_conversations_history",
        requestsPerMinute: 1,
        rowsPerRequest: 15,
      },
    },
    security: {
      credentials: "macos_keychain",
      filtering: "native_content_free_projection",
      tokenRotation: true,
      refreshTokenMaxAgeDays: 30,
    },
    operatorSetup: {
      credentialsUrl: "https://api.slack.com/apps",
      credentialsLinkLabel: "Open Slack app settings",
      docsUrl: "https://docs.slack.dev/authentication/using-pkce/",
      docsLinkLabel: "Slack desktop PKCE guide",
      buildSettings: ["SLACK_CHAT_CLIENT_ID"],
      summary:
        "Create or open a Slack app, enable desktop PKCE and token rotation, and add its public Client ID to the Weekform desktop build.",
    },
  },
  {
    id: "google_chat",
    label: "Google Chat",
    connection: "oauth_pkce",
    description:
      "Sync attention evidence from the spaces and direct messages available to your account.",
    contentBoundary: CONTENT_BOUNDARY,
    requiresBroker: false,
    authorization: {
      flow: "desktop_pkce",
      browser: "system",
      callback: "loopback",
      tokenExchange: "native_pkce",
      scopeClassification: "restricted",
      desktopPkceStatus: null,
      desktopRedirectScopeKind: null,
      scopes: [
        "openid",
        "https://www.googleapis.com/auth/chat.spaces.readonly",
        "https://www.googleapis.com/auth/chat.messages.readonly",
      ],
      summary:
        "Google opens in your system browser so you can approve restricted, read-only access to your Chat spaces and messages.",
      accessItems: [
        "See Chat spaces available to your account",
        "Read messages and reactions for local attention-signal processing",
        "Use your identity only to distinguish your own observed actions",
      ],
    },
    transfer: {
      range: RANGE,
      reconciliation: "authoritative_intact_run",
      providerLimit: null,
    },
    security: {
      credentials: "macos_keychain",
      filtering: "native_content_free_projection",
      tokenRotation: null,
      refreshTokenMaxAgeDays: null,
    },
    operatorSetup: {
      credentialsUrl: "https://console.cloud.google.com/apis/credentials",
      credentialsLinkLabel: "Open Google Cloud credentials",
      docsUrl: "https://developers.google.com/workspace/chat/authenticate-authorize",
      docsLinkLabel: "Google Chat authorization guide",
      buildSettings: ["GOOGLE_CHAT_CLIENT_ID"],
      summary:
        "Enable the Google Chat API, configure the OAuth consent screen, and add a macOS desktop Client ID to the Weekform desktop build.",
    },
  },
  {
    id: "webex",
    label: "Webex",
    connection: "oauth_broker",
    description:
      "Sync attention evidence from the rooms and direct messages available to your account.",
    contentBoundary: CONTENT_BOUNDARY,
    requiresBroker: true,
    authorization: {
      flow: "confidential_broker",
      browser: "system",
      callback: "loopback",
      tokenExchange: "token_only_https_broker",
      scopeClassification: "confidential",
      desktopPkceStatus: null,
      desktopRedirectScopeKind: null,
      scopes: [
        "spark:rooms_read",
        "spark:messages_read",
        "spark:people_read",
        "spark:kms",
      ],
      summary:
        "Webex opens in your system browser for read access; only authorization credentials use Weekform's existing HTTPS token broker.",
      accessItems: [
        "See rooms available to your account",
        "Read messages for local attention-signal processing",
        "Use your identity only to distinguish your own observed actions",
      ],
    },
    transfer: {
      range: RANGE,
      reconciliation: "authoritative_intact_run",
      providerLimit: null,
    },
    security: {
      credentials: "macos_keychain",
      filtering: "native_content_free_projection",
      tokenRotation: null,
      refreshTokenMaxAgeDays: null,
    },
    operatorSetup: {
      credentialsUrl: "https://developer.webex.com/my-apps",
      credentialsLinkLabel: "Open Webex integrations",
      docsUrl: "https://developer.webex.com/docs/integrations",
      docsLinkLabel: "Webex integration guide",
      buildSettings: [
        "WEBEX_CHAT_CLIENT_ID",
        "WEBEX_CHAT_REDIRECT_URI",
        "WEEKFORM_CHAT_OAUTH_BROKER_URL",
        "WEBEX_CHAT_BROKER_SECURITY_VERIFIED",
      ],
      summary:
        "Create a confidential Webex integration, register Weekform's exact loopback callback, and configure the reviewed token-only HTTPS broker. Keep the Client Secret on the broker only.",
    },
  },
] as const satisfies readonly ChatProviderCapability[];

export function chatProviderCapability(provider: ChatProviderId): ChatProviderCapability {
  const capability = CHAT_PROVIDER_CAPABILITIES.find(
    (candidate) => candidate.id === provider,
  );
  if (!capability) throw new Error(`Unsupported chat provider: ${provider}`);
  return capability;
}
