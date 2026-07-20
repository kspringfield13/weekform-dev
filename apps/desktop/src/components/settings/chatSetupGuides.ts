import type { ChatProviderId } from "../../../../../packages/integrations/src/chat/chatSync";

export type ChatSetupState =
  | "checking"
  | "needs_setup"
  | "ready_to_authorize"
  | "connected";

export interface ChatSetupGuide {
  credentialsUrl: string;
  credentialsLinkLabel: string;
  docsUrl: string;
  docsLinkLabel: string;
  buildSettings: readonly string[];
  setupSummary: string;
  authorizationSummary: string;
  accessItems: readonly string[];
}

export const CHAT_SETUP_GUIDES: Record<ChatProviderId, ChatSetupGuide> = {
  slack: {
    credentialsUrl: "https://api.slack.com/apps",
    credentialsLinkLabel: "Open Slack app settings",
    docsUrl: "https://docs.slack.dev/authentication/using-pkce/",
    docsLinkLabel: "Slack desktop PKCE guide",
    buildSettings: ["SLACK_CHAT_CLIENT_ID"],
    setupSummary: "Create or open a Slack app, enable desktop PKCE and token rotation, and add its public Client ID to the Weekform desktop build.",
    authorizationSummary: "Slack opens in your browser so you can choose a workspace and approve read-only user access.",
    accessItems: [
      "List the conversations you can already access",
      "Read top-level channel, group, and direct-message history",
      "Keep authorization refreshable without storing it in app settings",
    ],
  },
  google_chat: {
    credentialsUrl: "https://console.cloud.google.com/apis/credentials",
    credentialsLinkLabel: "Open Google Cloud credentials",
    docsUrl: "https://developers.google.com/workspace/chat/authenticate-authorize",
    docsLinkLabel: "Google Chat authorization guide",
    buildSettings: ["GOOGLE_CHAT_CLIENT_ID"],
    setupSummary: "Enable the Google Chat API, configure the OAuth consent screen, and add a Desktop app Client ID to the Weekform desktop build.",
    authorizationSummary: "Google opens in your browser so you can approve read-only access to your Chat spaces and messages.",
    accessItems: [
      "See Chat spaces available to your account",
      "Read messages and reactions for local attention-signal processing",
      "Use your identity only to distinguish your own observed actions",
    ],
  },
  webex: {
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
    setupSummary: "Create a Webex integration, register Weekform's exact loopback callback, and configure the reviewed token-only broker. Keep the Client Secret on the broker only.",
    authorizationSummary: "Webex opens in your browser so you can approve read access; only authorization credentials use Weekform's secure token broker.",
    accessItems: [
      "See rooms available to your account",
      "Read messages for local attention-signal processing",
      "Use your identity only to distinguish your own observed actions",
    ],
  },
};

export function chatSetupState(status: {
  available: boolean;
  connected: boolean;
  stale: boolean;
} | undefined): ChatSetupState {
  if (!status || status.stale) return "checking";
  if (status.connected) return "connected";
  return status.available ? "ready_to_authorize" : "needs_setup";
}
