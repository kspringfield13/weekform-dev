import { useState, type FormEvent } from "react";
import {
  KeyRound,
  Link2,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Unplug,
  Upload,
} from "lucide-react";
import {
  CHAT_PROVIDER_CAPABILITIES,
  type ChatProviderId,
} from "../../../../../packages/integrations/src/chat/chatProviderCapabilities";
import type {
  ChatConnectionStatus,
  ChatCoverageState,
  ChatSourcesController,
} from "../../hooks/useChatSources";
import { formatAuditTime, formatCount } from "../../lib/format";
import { ChatConnectWizard } from "./ChatConnectWizard";
import {
  chatProviderSetupPresentation,
  normalizeChatProviderSetupInput,
  WEBEX_DESKTOP_REDIRECT_URI,
  type ChatProviderSetupInput,
} from "./chatConnectionPresentation";

const COVERAGE_LABELS: Record<ChatCoverageState, string> = {
  complete: "Complete",
  scope_limited: "Scope-limited",
  partial: "Partial",
  rate_limited: "Rate-limited",
  permission_limited: "Permission-limited",
};

function statusLabel(status: ChatConnectionStatus | undefined): string {
  if (status?.stale) return "Status unknown";
  if (status?.connected) return "Connected";
  if (status?.readinessCode === "missing_client_id") return "Needs Client ID";
  if (["missing_redirect_uri", "invalid_redirect_uri", "missing_broker_url", "invalid_broker_url"]
    .includes(status?.readinessCode ?? "")) return "Needs setup";
  if (status?.readinessCode === "broker_security_review_required") return "Broker review required";
  if (status?.available) return "Ready";
  return "Unavailable";
}

interface ChatProviderSetupDraft {
  clientId: string;
  redirectUri: string;
  brokerUrl: string;
}

const INITIAL_SETUP_DRAFTS: Record<ChatProviderId, ChatProviderSetupDraft> = {
  slack: { clientId: "", redirectUri: "", brokerUrl: "" },
  google_chat: { clientId: "", redirectUri: "", brokerUrl: "" },
  webex: { clientId: "", redirectUri: WEBEX_DESKTOP_REDIRECT_URI, brokerUrl: "" },
};

function setupInput(
  provider: ChatProviderId,
  draft: ChatProviderSetupDraft,
): ChatProviderSetupInput {
  if (provider === "webex") {
    return {
      provider,
      clientId: draft.clientId,
      redirectUri: draft.redirectUri,
      brokerUrl: draft.brokerUrl,
    };
  }
  return { provider, clientId: draft.clientId };
}

export function ChatSourcesPanel({
  controller,
  legacyImportError,
  onImportLegacy,
  disabled = false,
}: {
  controller: ChatSourcesController;
  legacyImportError?: string | null;
  onImportLegacy?: (file: File) => void;
  disabled?: boolean;
}) {
  const { range, rangeError, rangeInput } = controller;
  const rangeFeedbackId = "chat-range-feedback";
  const [wizardProvider, setWizardProvider] = useState<ChatProviderId | null>(null);
  const [setupDrafts, setSetupDrafts] = useState(INITIAL_SETUP_DRAFTS);
  const [editingProvider, setEditingProvider] = useState<ChatProviderId | null>(null);
  const [savingProvider, setSavingProvider] = useState<ChatProviderId | null>(null);
  const [setupErrors, setSetupErrors] = useState<Partial<Record<ChatProviderId, string>>>({});
  const wizardDescriptor = CHAT_PROVIDER_CAPABILITIES.find((provider) => provider.id === wizardProvider);
  const wizardStatus = controller.statuses.find((status) => status.provider === wizardProvider);
  const wizardActivity = wizardProvider ? controller.activity[wizardProvider] : null;

  const saveProviderSetup = async (
    event: FormEvent<HTMLFormElement>,
    provider: ChatProviderId,
  ) => {
    event.preventDefault();
    setSetupErrors((current) => ({ ...current, [provider]: undefined }));
    let normalized: ChatProviderSetupInput;
    try {
      normalized = normalizeChatProviderSetupInput(setupInput(provider, setupDrafts[provider]));
    } catch (error) {
      setSetupErrors((current) => ({
        ...current,
        [provider]: error instanceof Error ? error.message : "Enter valid public connection details.",
      }));
      return;
    }
    setSavingProvider(provider);
    try {
      const status = await controller.configureProvider(normalized);
      if (!status) {
        setSetupErrors((current) => ({
          ...current,
          [provider]: "The details were saved, but Weekform could not recheck readiness. Use Refresh status to verify them.",
        }));
        return;
      }
      setSetupDrafts((current) => ({
        ...current,
        [provider]: INITIAL_SETUP_DRAFTS[provider],
      }));
      setEditingProvider(null);
      if (status.available) setWizardProvider(provider);
    } catch (error) {
      setSetupErrors((current) => ({
        ...current,
        [provider]: error instanceof Error
          ? error.message
          : "Weekform could not save these public connection details.",
      }));
    } finally {
      setSavingProvider(null);
    }
  };

  const updateSetupDraft = (
    provider: ChatProviderId,
    field: keyof ChatProviderSetupDraft,
    value: string,
  ) => {
    setSetupDrafts((current) => ({
      ...current,
      [provider]: { ...current[provider], [field]: value },
    }));
    setSetupErrors((current) => ({ ...current, [provider]: undefined }));
  };

  return (
    <section className="calendar-sources" aria-labelledby="chat-sources-title">
      <div className="calendar-sources-heading">
        <div className="settings-row-icon"><MessageSquareText size={18} aria-hidden /></div>
        <div>
          <h3 id="chat-sources-title">Chat</h3>
          <p>Connect your own chat accounts to turn directed requests and observed chat actions into reviewable workload evidence—not message-volume scoring.</p>
        </div>
        <div className="calendar-range" role="group" aria-label="Chat transfer date range">
          <label htmlFor="chat-range-start">
            <span>From</span>
            <input
              id="chat-range-start"
              type="date"
              value={rangeInput.start_date}
              aria-invalid={Boolean(rangeError)}
              aria-describedby={rangeError ? rangeFeedbackId : undefined}
              onChange={(event) => controller.updateRange("start_date", event.target.value)}
            />
          </label>
          <span className="calendar-range-arrow" aria-hidden>→</span>
          <label htmlFor="chat-range-end">
            <span>Through</span>
            <input
              id="chat-range-end"
              type="date"
              value={rangeInput.end_date}
              aria-invalid={Boolean(rangeError)}
              aria-describedby={rangeError ? rangeFeedbackId : undefined}
              onChange={(event) => controller.updateRange("end_date", event.target.value)}
            />
          </label>
          <button
            className="icon-button"
            type="button"
            title="Refresh chat connection status"
            aria-label="Refresh chat connection status"
            aria-busy={controller.refreshingStatuses}
            disabled={controller.refreshingStatuses}
            onClick={() => void controller.refreshStatuses().catch(() => undefined)}
          >
            {controller.refreshingStatuses
              ? <LoaderCircle className="spin" size={15} aria-hidden />
              : <RotateCw size={15} aria-hidden />}
          </button>
        </div>
      </div>

      {(rangeError || controller.statusError) && (
        <div className="calendar-source-feedback" aria-live="polite">
          {rangeError
            ? <small className="import-error" id={rangeFeedbackId} role="alert">{rangeError}</small>
            : <small className="import-error" role="alert">{controller.statusError}</small>}
        </div>
      )}

      <div className="calendar-provider-list">
        {CHAT_PROVIDER_CAPABILITIES.map((provider) => {
          const status = controller.statuses.find((candidate) => candidate.provider === provider.id);
          const activity = controller.activity[provider.id];
          const busy = activity.phase === "authorizing" || activity.phase === "syncing" || activity.phase === "disconnecting";
          const receipt = activity.receipt;
          const errorId = `chat-${provider.id}-error`;
          const setup = chatProviderSetupPresentation(provider.id, status);
          const showSetupInput = setup.visible || editingProvider === provider.id;
          const draft = setupDrafts[provider.id];
          const setupError = setupErrors[provider.id];
          const clientIdHelpId = `chat-${provider.id}-client-id-help`;
          const setupErrorId = `chat-${provider.id}-setup-error`;
          return (
            <article className="calendar-provider" key={provider.id} aria-busy={busy}>
              <div className={`calendar-provider-mark is-${provider.id}`} aria-hidden>
                {provider.label.slice(0, 1)}
              </div>
              <div className="calendar-provider-copy">
                <div className="calendar-provider-title">
                  <h4>{provider.label}</h4>
                  <span className={status?.connected && !status.stale ? "source-status is-active" : "source-status"}>
                    {status?.connected && !status.stale ? <span className="source-status-dot" /> : null}
                    {statusLabel(status)}
                  </span>
                </div>
                <p>{provider.description}</p>
                {showSetupInput && (
                  <form
                    className="chat-provider-setup"
                    onSubmit={(event) => void saveProviderSetup(event, provider.id)}
                  >
                    <div className="chat-provider-setup-heading">
                      <div>
                        <strong>{provider.label} connection details</strong>
                        <span>Public values only</span>
                      </div>
                      {!setup.visible && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProvider(null);
                            setSetupDrafts((current) => ({
                              ...current,
                              [provider.id]: INITIAL_SETUP_DRAFTS[provider.id],
                            }));
                            setSetupErrors((current) => ({ ...current, [provider.id]: undefined }));
                          }}
                        >Cancel</button>
                      )}
                    </div>
                    <label className="chat-provider-setup-field" htmlFor={`chat-${provider.id}-client-id`}>
                      <span>{provider.label} Client ID</span>
                      <div className="chat-provider-setup-input">
                        <KeyRound size={14} aria-hidden />
                        <input
                          id={`chat-${provider.id}-client-id`}
                          type="text"
                          value={draft.clientId}
                          placeholder={provider.id === "slack"
                            ? "1234567890.1234567890123"
                            : provider.id === "google_chat"
                              ? "123456789-example.apps.googleusercontent.com"
                              : "Webex public Client ID"}
                          autoComplete="off"
                          spellCheck={false}
                          aria-invalid={Boolean(setupError)}
                          aria-describedby={setupError ? `${clientIdHelpId} ${setupErrorId}` : clientIdHelpId}
                          onChange={(event) => updateSetupDraft(provider.id, "clientId", event.target.value)}
                        />
                      </div>
                    </label>
                    {provider.id === "webex" && (
                      <div className="chat-provider-setup-grid">
                        <label className="chat-provider-setup-field" htmlFor="chat-webex-redirect-uri">
                          <span>Exact redirect URI</span>
                          <div className="chat-provider-setup-input">
                            <Link2 size={14} aria-hidden />
                            <input
                              id="chat-webex-redirect-uri"
                              type="url"
                              value={draft.redirectUri}
                              autoComplete="off"
                              spellCheck={false}
                              aria-invalid={Boolean(setupError)}
                              aria-describedby={setupError ? setupErrorId : undefined}
                              onChange={(event) => updateSetupDraft("webex", "redirectUri", event.target.value)}
                            />
                          </div>
                        </label>
                        <label className="chat-provider-setup-field" htmlFor="chat-webex-broker-url">
                          <span>Weekform broker URL</span>
                          <div className="chat-provider-setup-input">
                            <ShieldCheck size={14} aria-hidden />
                            <input
                              id="chat-webex-broker-url"
                              type="url"
                              value={draft.brokerUrl}
                              placeholder="https://weekform.dev/api"
                              autoComplete="off"
                              spellCheck={false}
                              aria-invalid={Boolean(setupError)}
                              aria-describedby={setupError ? setupErrorId : undefined}
                              onChange={(event) => updateSetupDraft("webex", "brokerUrl", event.target.value)}
                            />
                          </div>
                        </label>
                      </div>
                    )}
                    <div className="chat-provider-setup-footer">
                      <small id={clientIdHelpId}>
                        {provider.id === "slack"
                          ? "Paste the public Client ID from Slack’s Basic Information page. Never enter the Client Secret."
                          : provider.id === "google_chat"
                            ? "Paste the public Desktop app Client ID from Google Cloud. Never enter the Client Secret."
                            : "The Client Secret stays on Weekform’s reviewed broker and must never be pasted into the desktop app."}
                      </small>
                      <button className="settings-control" type="submit" disabled={savingProvider === provider.id}>
                        {savingProvider === provider.id && <LoaderCircle className="spin" size={14} aria-hidden />}
                        {savingProvider === provider.id ? "Saving…" : "Save and review access"}
                      </button>
                    </div>
                    {provider.id === "webex" && (
                      <small>The redirect must match the Webex integration exactly. The broker address is public; its secret and security attestation remain server-controlled.</small>
                    )}
                    {setupError && (
                      <small className="import-error" id={setupErrorId} role="alert">{setupError}</small>
                    )}
                  </form>
                )}
                <div className="calendar-provider-meta" aria-live="polite">
                  <span>{status
                    ? status.available || status.connected || status.stale ||
                        setup.visible || status.readinessCode === "broker_security_review_required"
                      ? status.detail
                      : "This connector is unavailable in this build. Open the connection window for details or use the sanitized local import below."
                    : "Checking native connector availability…"}</span>
                  {receipt ? (
                    <>
                      <span>{COVERAGE_LABELS[receipt.coverage]} coverage</span>
                      <span>{formatCount(receipt.normalized_count)} content-free signal{receipt.normalized_count === 1 ? "" : "s"} retained in this run</span>
                      <span>{formatCount(receipt.observed_episode_count)} observed episode{receipt.observed_episode_count === 1 ? "" : "s"}</span>
                      <span>{formatCount(receipt.directed_review_count)} directed signal{receipt.directed_review_count === 1 ? "" : "s"} held at 0% for review</span>
                      {receipt.has_more && <span>More provider pages remain</span>}
                      {receipt.workload_applied && (
                        <span>{receipt.authoritative
                          ? "Applied to workload with whole-range replacement authority"
                          : "Applied additively to workload; existing provider evidence was retained"}</span>
                      )}
                      {!receipt.workload_applied && !receipt.has_more && (
                        <span>Not applied to workload; this run was not transform-ready</span>
                      )}
                      {receipt.retry_after_seconds !== null && (
                        <span>Provider asks for a {formatCount(receipt.retry_after_seconds)}-second wait before retry</span>
                      )}
                      <span>{receipt.detail}</span>
                    </>
                  ) : (
                    <span>No sync receipt yet</span>
                  )}
                  {activity.last_synced_at && (
                    <span>Synced <time dateTime={activity.last_synced_at}>{formatAuditTime(activity.last_synced_at)}</time></span>
                  )}
                </div>
                {activity.message && <p className="import-error" id={errorId} role="alert">{activity.message}</p>}
              </div>
              <div className="calendar-provider-actions">
                {showSetupInput ? null : status?.stale ? (
                  <button
                    className="settings-control"
                    type="button"
                    disabled={busy || controller.refreshingStatuses}
                    aria-busy={controller.refreshingStatuses}
                    onClick={() => void controller.refreshStatuses().catch(() => undefined)}
                  >
                    {controller.refreshingStatuses
                      ? <LoaderCircle className="spin" size={15} aria-hidden />
                      : <RotateCw size={15} aria-hidden />}
                    <span>{controller.refreshingStatuses ? "Checking…" : "Refresh status"}</span>
                  </button>
                ) : status?.connected ? (
                  <>
                    <button
                      className="settings-control"
                      type="button"
                      disabled={!range || busy}
                      aria-busy={activity.phase === "syncing"}
                      aria-describedby={activity.message ? errorId : undefined}
                      onClick={() => void controller.sync(provider.id).catch(() => undefined)}
                    >
                      {activity.phase === "syncing"
                        ? <LoaderCircle className="spin" size={15} aria-hidden />
                        : <RefreshCw size={15} aria-hidden />}
                      <span>{activity.phase === "syncing" ? "Syncing…" : receipt?.has_more ? "Continue sync" : "Sync range"}</span>
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title={`Disconnect ${provider.label}`}
                      aria-label={`Disconnect ${provider.label}`}
                      aria-busy={activity.phase === "disconnecting"}
                      disabled={busy}
                      onClick={() => void controller.disconnect(provider.id).catch(() => undefined)}
                    >
                      {activity.phase === "disconnecting"
                        ? <LoaderCircle className="spin" size={15} aria-hidden />
                        : <Unplug size={15} aria-hidden />}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="settings-control"
                      type="button"
                      disabled={busy || status?.readinessCode === "broker_security_review_required"}
                      aria-busy={activity.phase === "authorizing"}
                      aria-describedby={activity.message ? errorId : undefined}
                      onClick={() => setWizardProvider(provider.id)}
                    >
                      {activity.phase === "authorizing"
                        ? <LoaderCircle className="spin" size={15} aria-hidden />
                        : <Link2 size={15} aria-hidden />}
                      <span>{activity.phase === "authorizing"
                        ? "Authorizing…"
                        : status?.readinessCode === "broker_security_review_required"
                          ? "Security review required"
                          : "Connect now"}</span>
                    </button>
                    {setup.canEdit && (
                      <button
                        className="icon-button"
                        type="button"
                        title={`Change ${provider.label} connection details`}
                        aria-label={`Change ${provider.label} connection details`}
                        onClick={() => {
                          setEditingProvider(provider.id);
                          setSetupErrors((current) => ({ ...current, [provider.id]: undefined }));
                        }}
                      >
                        <KeyRound size={14} aria-hidden />
                      </button>
                    )}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <p className="calendar-live-note">
        <strong>Signal path:</strong> Ambient discarded <span aria-hidden>→</span> Directed held at 0% for review <span aria-hidden>→</span> Observed response or coordination episode <span aria-hidden>→</span> User confirms.
      </p>
      <p className="calendar-live-note">
        <ShieldCheck size={12} aria-hidden /> Provider APIs may return message content during sync. The native boundary minimally inspects only what is needed to derive an attention signal, then immediately discards the content; it is never stored, exported, sent to AI, or shared with managers.
      </p>
      <p className="calendar-live-note">Transfers are manual, limited to 90 days, and default to the prior 14 days through today so coverage stays understandable and provider limits stay manageable.</p>
      <p className="calendar-live-note">Provider and conversation detail stays local. Only the existing member-approved aggregate workload contract can reach Manager Access.</p>
      <p className="calendar-live-note">Disconnecting stops future transfers and removes that provider&apos;s credential and cursor. Derived blocks stay reviewable; canonical Chat evidence follows Raw evidence retention and Reset Local Data.</p>
      {onImportLegacy && (
        <div className="calendar-source-feedback chat-import-feedback">
          <label className="settings-control" title="Import a legacy Weekform-normalized content-free JSON file">
            <Upload size={15} aria-hidden />
            <span>Import normalized JSON</span>
            <input
              accept=".json,application/json"
              type="file"
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportLegacy(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <small>Compatibility path for existing Weekform-normalized files; vendor exports are not accepted directly.</small>
          {legacyImportError && <small className="import-error" role="alert">{legacyImportError}</small>}
        </div>
      )}
      {wizardProvider && wizardDescriptor && wizardActivity && (
        <ChatConnectWizard
          provider={wizardProvider}
          status={wizardStatus}
          activity={wizardActivity}
          rangeIsValid={Boolean(range)}
          refreshing={controller.refreshingStatuses}
          onClose={() => setWizardProvider(null)}
          onRecheck={controller.refreshStatuses}
          onConnect={() => controller.connect(wizardProvider)}
          onSync={() => controller.sync(wizardProvider)}
        />
      )}
    </section>
  );
}
