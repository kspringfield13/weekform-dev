import type {
  ChatConnectionStatus,
  ChatProviderConfiguration,
  ChatProviderActivity,
} from "../../hooks/useChatSources";
import type { ChatProviderCapability } from "../../../../../packages/integrations/src/chat/chatProviderCapabilities";

export type ChatConnectionStage =
  | "checking"
  | "unavailable"
  | "access_review"
  | "browser_authorization"
  | "native_filtering"
  | "authorization_error"
  | "transfer_error"
  | "complete";

export interface ChatConnectionPresentation {
  stage: ChatConnectionStage;
  summary: string;
  primaryAction: string;
  canClose: boolean;
  requiresRange: boolean;
}

export interface ChatProviderSetupPresentation {
  visible: boolean;
  canEdit: boolean;
}

export type ChatProviderSetupInput = ChatProviderConfiguration;

export const WEBEX_DESKTOP_REDIRECT_URI =
  "http://127.0.0.1:49323/chat-auth/callback";

export function normalizeSlackClientIdInput(value: string): string {
  const normalized = value.trim();
  if (!/^\d+\.\d+$/.test(normalized) || normalized.length > 96) {
    throw new Error(
      "Enter the public Slack Client ID from Basic Information, such as 1234567890.1234567890123.",
    );
  }
  return normalized;
}

function normalizeGoogleChatClientIdInput(value: string): string {
  const normalized = value.trim();
  const valid = normalized.length <= 255
    && normalized.endsWith(".apps.googleusercontent.com")
    && /^[A-Za-z0-9.-]+$/.test(normalized);
  if (!valid) {
    throw new Error(
      "Enter the public Google Chat Client ID for a Desktop app, ending in .apps.googleusercontent.com.",
    );
  }
  return normalized;
}

function normalizeWebexClientIdInput(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 255 || !/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error("Enter the public Webex Client ID from your integration settings.");
  }
  return normalized;
}

function normalizeWebexRedirectUriInput(value: string): string {
  const normalized = value.trim();
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Enter an exact loopback HTTP callback with a port and /chat-auth/callback path.");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (
    url.protocol !== "http:"
    || !loopback
    || !url.port
    || url.pathname !== "/chat-auth/callback"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("Enter an exact loopback HTTP callback with a port and /chat-auth/callback path.");
  }
  return normalized;
}

function normalizeWebexBrokerUrlInput(value: string): string {
  const normalized = value.trim();
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Enter the credential-free HTTPS URL for Weekform’s Webex token broker.");
  }
  if (
    url.protocol !== "https:"
    || !url.hostname
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("Enter the credential-free HTTPS URL for Weekform’s Webex token broker.");
  }
  return normalized;
}

export function normalizeChatProviderSetupInput(
  input: ChatProviderSetupInput,
): ChatProviderSetupInput {
  if (input.provider === "slack") {
    return { provider: input.provider, clientId: normalizeSlackClientIdInput(input.clientId) };
  }
  if (input.provider === "google_chat") {
    return { provider: input.provider, clientId: normalizeGoogleChatClientIdInput(input.clientId) };
  }
  return {
    provider: input.provider,
    clientId: normalizeWebexClientIdInput(input.clientId),
    redirectUri: normalizeWebexRedirectUriInput(input.redirectUri),
    brokerUrl: normalizeWebexBrokerUrlInput(input.brokerUrl),
  };
}

export function chatProviderSetupPresentation(
  provider: ChatProviderCapability["id"],
  status: ChatConnectionStatus | undefined,
): ChatProviderSetupPresentation {
  const setupCodes = provider === "webex"
    ? new Set(["missing_client_id", "missing_redirect_uri", "invalid_redirect_uri", "missing_broker_url", "invalid_broker_url"])
    : new Set(["missing_client_id"]);
  const connected = status?.connected === true;
  return {
    visible: !connected && setupCodes.has(status?.readinessCode ?? "unknown"),
    canEdit: !connected && status?.readinessCode !== "unknown",
  };
}

export function slackClientIdSetupPresentation(
  status: ChatConnectionStatus | undefined,
): ChatProviderSetupPresentation {
  return chatProviderSetupPresentation("slack", status);
}

/** Render end-user limitations from the canonical registry, never parallel metadata. */
export function chatCapabilityNotice(capability: ChatProviderCapability): string {
  const notices: string[] = [];
  if (capability.authorization.desktopPkceStatus === "ga_2026_03") {
    notices.push("Desktop PKCE is generally available as of March 2026.");
  }
  if (capability.authorization.desktopRedirectScopeKind === "user_only") {
    notices.push("Desktop redirects grant user scopes only.");
  }
  if (capability.authorization.scopeClassification === "restricted") {
    notices.push("The read-only message scope is restricted and may require provider verification.");
  }
  if (capability.authorization.tokenExchange === "token_only_https_broker") {
    notices.push("Only authorization credentials use the existing token-only HTTPS broker; chat data does not.");
  }
  if (capability.security.tokenRotation) {
    notices.push("Tokens rotate.");
  }
  if (capability.security.refreshTokenMaxAgeDays !== null) {
    notices.push(`PKCE refresh tokens expire after ${capability.security.refreshTokenMaxAgeDays} days.`);
  }
  if (capability.transfer.providerLimit) {
    notices.push(
      `Applicable history access may be limited to ${capability.transfer.providerLimit.requestsPerMinute} request per minute and ${capability.transfer.providerLimit.rowsPerRequest} rows.`,
    );
  }
  return notices.join(" ");
}

/**
 * Convert native and async state into a small, testable wizard contract.
 * Provider identifiers and native setup detail never participate in this copy.
 */
export function chatConnectionPresentation(input: {
  status: ChatConnectionStatus | undefined;
  activity: ChatProviderActivity;
}): ChatConnectionPresentation {
  const { status, activity } = input;
  if (!status || status.stale) {
    return {
      stage: "checking",
      summary: "Weekform is checking whether this connector is available.",
      primaryAction: "Recheck availability",
      canClose: true,
      requiresRange: false,
    };
  }

  if (!status.available && !status.connected) {
    return {
      stage: "unavailable",
      summary: "This connector is unavailable in this build. You can still use the sanitized local import.",
      primaryAction: "Recheck availability",
      canClose: true,
      requiresRange: false,
    };
  }

  if (activity.phase === "authorizing") {
    return {
      stage: "browser_authorization",
      summary: "Finish authorization in your browser, then return to Weekform.",
      primaryAction: "Waiting for browser…",
      canClose: false,
      requiresRange: false,
    };
  }

  if (activity.phase === "syncing") {
    return {
      stage: "native_filtering",
      summary: "Weekform is transferring the selected range and projecting it into content-free evidence on this Mac.",
      primaryAction: "Transferring…",
      canClose: false,
      requiresRange: true,
    };
  }

  if (activity.phase === "error") {
    if (status.connected) {
      return {
        stage: "transfer_error",
        summary: "Authorization is saved, but the initial transfer did not complete. Retry without authorizing again.",
        primaryAction: "Retry transfer",
        canClose: true,
        requiresRange: true,
      };
    }
    return {
      stage: "authorization_error",
      summary: "Authorization did not complete and no chat data was transferred.",
      primaryAction: "Try authorization again",
      canClose: true,
      requiresRange: true,
    };
  }

  if (
    status.connected &&
    activity.receipt?.transform_ready &&
    !activity.receipt.has_more
  ) {
    return {
      stage: "complete",
      summary: "The selected range completed and its content-free evidence is ready for review.",
      primaryAction: "Done",
      canClose: true,
      requiresRange: false,
    };
  }

  if (status.connected) {
    return {
      stage: "native_filtering",
      summary: activity.receipt?.has_more
        ? "The first provider page is retained locally. Continue the transfer to finish the selected range."
        : "Authorization is saved. Start the bounded transfer and native content-free filtering.",
      primaryAction: activity.receipt?.has_more ? "Continue transfer" : "Start transfer",
      canClose: true,
      requiresRange: true,
    };
  }

  return {
    stage: "access_review",
    summary: "Review the limited access and local privacy boundary before continuing.",
    primaryAction: "Authorize in browser",
    canClose: true,
    requiresRange: true,
  };
}
