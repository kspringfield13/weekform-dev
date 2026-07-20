import type {
  ChatConnectionStatus,
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
