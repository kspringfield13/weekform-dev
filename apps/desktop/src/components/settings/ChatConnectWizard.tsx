import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ExternalLink, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ChatProviderId } from "../../../../../packages/integrations/src/chat/chatSync";
import type { ChatConnectionStatus } from "../../hooks/useChatSources";
import {
  CHAT_SETUP_GUIDES,
  chatSetupState,
} from "./chatSetupGuides";

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
  label,
  status,
  rangeIsValid,
  busy,
  refreshing,
  onConnect,
  onRecheck,
  onClose,
}: {
  provider: ChatProviderId;
  label: string;
  status: ChatConnectionStatus | undefined;
  rangeIsValid: boolean;
  busy: boolean;
  refreshing: boolean;
  onConnect: () => void;
  onRecheck: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const guide = CHAT_SETUP_GUIDES[provider];
  const setupState = chatSetupState(status);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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

  const needsSetup = setupState === "needs_setup";
  const checking = setupState === "checking";

  return (
    <div
      className="dialog-overlay chat-connect-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="dialog-panel chat-connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <header className="chat-connect-header">
          <span className={`calendar-provider-mark is-${provider}`} aria-hidden>{label.slice(0, 1)}</span>
          <div>
            <span className="chat-connect-eyebrow">Chat connection</span>
            <h2 className="dialog-title" id={titleId}>Connect {label}</h2>
          </div>
        </header>

        <p className="dialog-desc" id={descriptionId}>
          {needsSetup
            ? `This copy of Weekform needs ${label} connector setup before you can authorize an account.`
            : checking
              ? "Weekform needs a fresh connector check before it can continue."
              : guide.authorizationSummary}
        </p>

        {needsSetup || checking ? (
          <ol className="chat-connect-steps">
            <li>
              <span className="chat-connect-step-number">1</span>
              <div>
                <strong>Get the provider credential</strong>
                <p>{guide.setupSummary}</p>
                <div className="chat-connect-links">
                  <button type="button" onClick={() => openLink(guide.credentialsUrl)}>
                    <ExternalLink size={13} aria-hidden /> {guide.credentialsLinkLabel}
                  </button>
                  <button type="button" onClick={() => openLink(guide.docsUrl)}>
                    <ExternalLink size={13} aria-hidden /> {guide.docsLinkLabel}
                  </button>
                </div>
              </div>
            </li>
            <li>
              <span className="chat-connect-step-number">2</span>
              <div>
                <strong>Add the public setup to Weekform</strong>
                <p>Configure these build settings, then restart the desktop app. Never paste a client secret into Weekform.</p>
                <div className="chat-connect-settings" aria-label={`${label} required build settings`}>
                  {guide.buildSettings.map((setting) => <code key={setting}>{setting}</code>)}
                </div>
              </div>
            </li>
            <li>
              <span className="chat-connect-step-number">3</span>
              <div>
                <strong>Recheck, then authorize</strong>
                <p>Weekform will verify the connector before opening {label} in your browser.</p>
              </div>
            </li>
          </ol>
        ) : (
          <ol className="chat-connect-steps">
            <li>
              <span className="chat-connect-step-number"><ExternalLink size={13} aria-hidden /></span>
              <div><strong>Sign in in your browser</strong><p>Weekform never asks for your {label} password.</p></div>
            </li>
            <li>
              <span className="chat-connect-step-number"><ShieldCheck size={13} aria-hidden /></span>
              <div>
                <strong>Approve limited read access</strong>
                <ul>{guide.accessItems.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </li>
            <li>
              <span className="chat-connect-step-number"><Check size={13} aria-hidden /></span>
              <div><strong>Return to Weekform</strong><p>The selected date range syncs into content-free, reviewable evidence on this Mac.</p></div>
            </li>
          </ol>
        )}

        <div className="chat-connect-privacy">
          <LockKeyhole size={14} aria-hidden />
          <span>Credentials stay in macOS Keychain. Message content is discarded at the native boundary and is not stored or sent to AI.</span>
        </div>

        {status?.detail && <p className="chat-connect-build-detail"><strong>Connector check:</strong> {status.detail}</p>}
        {!rangeIsValid && !needsSetup && !checking && (
          <p className="import-error" role="alert">Choose a valid transfer date range before continuing.</p>
        )}
        {linkError && <p className="import-error" role="alert">{linkError}</p>}

        <div className="dialog-actions">
          <button ref={closeRef} className="secondary-action" type="button" onClick={onClose}>Not now</button>
          {needsSetup || checking ? (
            <button className="primary-action" type="button" disabled={refreshing} onClick={onRecheck}>
              {refreshing && <LoaderCircle className="spin" size={15} aria-hidden />}
              {refreshing ? "Checking…" : "Recheck setup"}
            </button>
          ) : (
            <button className="primary-action" type="button" disabled={!rangeIsValid || busy} onClick={onConnect}>
              {busy && <LoaderCircle className="spin" size={15} aria-hidden />}
              {busy ? "Connecting…" : `Continue to ${label}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
