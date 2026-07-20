import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  Check,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  chatProviderCapability,
  type ChatProviderId,
} from "../../../../../packages/integrations/src/chat/chatProviderCapabilities";
import type {
  ChatConnectionStatus,
  ChatProviderActivity,
} from "../../hooks/useChatSources";
import {
  chatCapabilityNotice,
  chatConnectionPresentation,
} from "./chatConnectionPresentation";

async function openSetupLink(url: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    await openUrl(url);
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("Your browser blocked the setup page.");
}

export function ChatConnectWizard({
  provider,
  status,
  activity,
  rangeIsValid,
  refreshing,
  onConnect,
  onSync,
  onRecheck,
  onClose,
}: {
  provider: ChatProviderId;
  status: ChatConnectionStatus | undefined;
  activity: ChatProviderActivity;
  rangeIsValid: boolean;
  refreshing: boolean;
  onConnect: () => Promise<void>;
  onSync: () => Promise<void>;
  onRecheck: () => Promise<void>;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const progressHasFocusRef = useRef(false);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const capability = chatProviderCapability(provider);
  const capabilityNotice = chatCapabilityNotice(capability);
  const presentation = chatConnectionPresentation({ status, activity });
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    initialFocusRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  useEffect(() => {
    if (!presentation.canClose && !progressHasFocusRef.current) {
      panelRef.current?.focus();
      progressHasFocusRef.current = true;
    } else if (presentation.canClose) {
      progressHasFocusRef.current = false;
    }
  }, [presentation.canClose]);

  const requestClose = () => {
    if (presentation.canClose) onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const openLink = (url: string) => {
    setLinkError(null);
    void openSetupLink(url).catch((error) => {
      setLinkError(error instanceof Error ? error.message : "The setup page could not be opened.");
    });
  };

  const runPrimaryAction = () => {
    setLinkError(null);
    if (presentation.stage === "complete") {
      onClose();
      return;
    }
    if (presentation.stage === "checking" || presentation.stage === "unavailable") {
      void onRecheck().catch(() => undefined);
      return;
    }
    if (presentation.stage === "access_review" || presentation.stage === "authorization_error") {
      void onConnect().catch(() => undefined);
      return;
    }
    if (presentation.stage === "transfer_error" || presentation.stage === "native_filtering") {
      void onSync().catch(() => undefined);
    }
  };

  const primaryDisabled = refreshing ||
    (presentation.requiresRange && !rangeIsValid) ||
    presentation.stage === "browser_authorization" ||
    (presentation.stage === "native_filtering" && activity.phase === "syncing");
  const showOperatorSetup = presentation.stage === "unavailable";
  const checkingAvailability = presentation.stage === "checking";

  return (
    <div
      className="dialog-overlay chat-connect-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        className={`dialog-panel chat-connect-dialog is-${provider}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={!presentation.canClose}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="chat-connect-header">
          <span className={`calendar-provider-mark is-${provider}`} aria-hidden>
            {capability.label.slice(0, 1)}
          </span>
          <div>
            <span className="chat-connect-eyebrow">Private account transfer</span>
            <h2 className="dialog-title" id={titleId}>Connect {capability.label}</h2>
          </div>
        </header>

        <p className="dialog-desc" id={descriptionId}>{presentation.summary}</p>

        {checkingAvailability ? (
          <div className="chat-connect-unavailable" aria-live="polite">
            <LoaderCircle className="spin" size={16} aria-hidden />
            <div>
              <strong>Checking connector availability</strong>
              <p>Weekform is asking the native app for a safe readiness status.</p>
            </div>
          </div>
        ) : showOperatorSetup ? (
          <div className="chat-connect-unavailable" aria-live="polite">
            <TriangleAlert size={16} aria-hidden />
            <div>
              <strong>{capability.label} connection unavailable</strong>
              <p>This Mac app was not prepared for {capability.label} authorization. You do not need to change app settings or paste a secret.</p>
              <p>The sanitized local JSON import remains available in Chat settings.</p>
            </div>
          </div>
        ) : (
          <ol className="chat-connect-steps" aria-live="polite">
            <li className={presentation.stage === "access_review" ? "is-current" : "is-complete"}>
              <span className="chat-connect-step-number">
                {presentation.stage === "access_review" ? "1" : <Check size={13} aria-hidden />}
              </span>
              <div>
                <strong>Review access</strong>
                <p>{capability.authorization.summary}</p>
                <ul>{capability.authorization.accessItems.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </li>
            <li className={presentation.stage === "browser_authorization" ? "is-current" : status?.connected ? "is-complete" : undefined}>
              <span className="chat-connect-step-number">
                {presentation.stage === "browser_authorization"
                  ? <LoaderCircle className="spin" size={13} aria-hidden />
                  : status?.connected
                    ? <Check size={13} aria-hidden />
                    : "2"}
              </span>
              <div>
                <strong>Authorize in your system browser</strong>
                <p>Weekform never asks for your {capability.label} password. Return here after the provider finishes.</p>
              </div>
            </li>
            <li className={presentation.stage === "native_filtering" ? "is-current" : presentation.stage === "complete" ? "is-complete" : undefined}>
              <span className="chat-connect-step-number">
                {presentation.stage === "native_filtering" && activity.phase === "syncing"
                  ? <LoaderCircle className="spin" size={13} aria-hidden />
                  : presentation.stage === "complete"
                    ? <Check size={13} aria-hidden />
                    : "3"}
              </span>
              <div>
                <strong>Transfer and filter on this Mac</strong>
                <p>Only the selected inclusive range—up to {capability.transfer.range.maxDays} days—is read. Native filtering discards content and raw identities before evidence reaches Weekform.</p>
                {activity.receipt && (
                  <p>{activity.receipt.has_more
                    ? `${activity.receipt.normalized_count} content-free signals retained so far; more provider pages remain.`
                    : `${activity.receipt.normalized_count} content-free signals retained in this run.`}</p>
                )}
              </div>
            </li>
          </ol>
        )}

        {!checkingAvailability && !showOperatorSetup && capabilityNotice && (
          <p className="chat-connect-provider-note">{capabilityNotice}</p>
        )}

        <div className="chat-connect-privacy">
          <LockKeyhole size={14} aria-hidden />
          <span>Credentials stay in macOS Keychain. Message content and raw identifiers are discarded at the native boundary and are not stored, audited, exported, or sent to AI.</span>
        </div>

        {showOperatorSetup && (
          <details className="chat-connect-operator">
            <summary>Requirements for the person who prepares this build</summary>
            <p>{capability.operatorSetup.summary}</p>
            <div className="chat-connect-settings" aria-label={`${capability.label} operator build settings`}>
              {capability.operatorSetup.buildSettings.map((setting) => <code key={setting}>{setting}</code>)}
            </div>
            <div className="chat-connect-links">
              <button type="button" onClick={() => openLink(capability.operatorSetup.credentialsUrl)}>
                <ExternalLink size={13} aria-hidden /> {capability.operatorSetup.credentialsLinkLabel}
              </button>
              <button type="button" onClick={() => openLink(capability.operatorSetup.docsUrl)}>
                <ExternalLink size={13} aria-hidden /> {capability.operatorSetup.docsLinkLabel}
              </button>
            </div>
          </details>
        )}

        {activity.message && <p className="import-error" role="alert">{activity.message}</p>}
        {!rangeIsValid && presentation.requiresRange && (
          <p className="import-error" role="alert">Choose a valid transfer date range before continuing.</p>
        )}
        {linkError && <p className="import-error" role="alert">{linkError}</p>}

        <div className="dialog-actions">
          {presentation.canClose ? (
            <button
              ref={presentation.stage === "complete" ? undefined : initialFocusRef}
              className="secondary-action"
              type="button"
              onClick={onClose}
            >
              {presentation.stage === "complete" ? "Close" : "Not now"}
            </button>
          ) : (
            <span className="chat-connect-stay-open"><ShieldCheck size={13} aria-hidden /> Keep Weekform open</span>
          )}
          <button
            ref={presentation.stage === "complete" ? initialFocusRef : undefined}
            className="primary-action"
            type="button"
            disabled={primaryDisabled}
            onClick={runPrimaryAction}
          >
            {!presentation.canClose && <LoaderCircle className="spin" size={15} aria-hidden />}
            {refreshing ? "Checking…" : presentation.primaryAction}
          </button>
        </div>
      </div>
    </div>
  );
}
