// Account & Sharing settings tab: sign in with the weekform.dev account, pick the
// recipient team, edit the CloudSharePolicyV1, review the EXACT payload, and run the
// manually approved sync. Sharing is off by default; nothing here claims "all data
// synced" — the preview names the recipient team and every selected field.

import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudUpload,
  ExternalLink,
  LoaderCircle,
  Laptop,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Timer,
  Trash2,
  Users
} from "lucide-react";
import {
  MAX_SHARED_PROJECTS,
  truncateSharedProjectName,
  type CloudMetricPolicy,
  type CloudShareLevel
} from "../../../../../packages/domain/src/cloud";
import { CLOUD_METRIC_KEYS, CLOUD_METRIC_LABELS } from "../../services/cloudPolicy";
import type { CloudController } from "../../hooks/useCloudSync";
import { formatAuditTime } from "../../lib/format";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { SharePreview } from "./SharePreview";
import {
  getConfiguredManagerAccessSignInUrl,
  openManagerAccess,
  openWeekformWebApp
} from "../../services/adminPortal";

const SHARE_LEVEL_OPTIONS: Array<{ value: CloudShareLevel; label: string; hint: string }> = [
  { value: "summary", label: "Summary", hint: "Capacity metrics and review coverage only" },
  { value: "categories", label: "Categories", hint: "Adds category and work-mode allocation" },
  { value: "projects", label: "Projects", hint: "Adds allocation for allowlisted project names from verified blocks" }
];

const DAY_MS = 24 * 60 * 60 * 1000;

function AccountSharingHeading() {
  const [openError, setOpenError] = useState<string | null>(null);

  const openWebApp = async () => {
    setOpenError(null);
    try {
      await openWeekformWebApp();
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Weekform Web could not be opened.");
    }
  };

  return (
    <div className="settings-section-heading account-sharing-heading">
      <div className="account-sharing-heading-copy">
        <span className="account-sharing-eyebrow">Account</span>
        <div className="account-sharing-title-row">
          <h2>Weekform Web</h2>
          <button
            className="settings-control account-sharing-web-app-button"
            type="button"
            onClick={() => void openWebApp()}
          >
            <ExternalLink size={15} aria-hidden />
            <span>Open Web App</span>
          </button>
        </div>
        <p>Connect your workspace, then choose exactly what leaves this Mac.</p>
        {openError && <small className="account-sharing-open-error" role="alert">{openError}</small>}
      </div>
    </div>
  );
}

function ManagerAccessSettingsRow() {
  const [openError, setOpenError] = useState<string | null>(null);
  const destination = getConfiguredManagerAccessSignInUrl();
  const isLocalWorkspace = destination.endsWith("/manager-access");

  const openPortal = async () => {
    setOpenError(null);
    try {
      await openManagerAccess(destination);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Manager Access could not be opened.");
    }
  };

  return (
    <section className="settings-row">
      <div className="settings-row-icon"><ShieldCheck size={18} aria-hidden /></div>
      <div>
        <h3>Manager Access</h3>
        <p>
          {isLocalWorkspace
            ? "Open the local Weekform Manager Access workspace for development and testing."
            : "Open Weekform Manager Access to use your individual workspace and manage approved team signals."}
        </p>
      </div>
      <div className="settings-row-status">
        <strong>{isLocalWorkspace ? "Local development" : "Web app"}</strong>
        <span>Opens in your browser</span>
        {openError && <small className="import-error" role="alert">{openError}</small>}
      </div>
      <button
        className="settings-control"
        type="button"
        onClick={() => void openPortal()}
      >
        <ExternalLink size={15} aria-hidden />
        <span>Open Manager Access</span>
      </button>
    </section>
  );
}

function sharedSnapshotFreshness(lastSuccessAt: string | null, hasSyncedSnapshot: boolean): string | null {
  if (!hasSyncedSnapshot) return null;
  if (!lastSuccessAt) return "Sync time unknown";
  const syncedAt = new Date(lastSuccessAt).getTime();
  if (!Number.isFinite(syncedAt)) return "Sync time unknown";
  const ageMs = Math.max(0, Date.now() - syncedAt);
  if (ageMs <= DAY_MS) return "Synced within the last day";
  if (ageMs <= 7 * DAY_MS) return "Synced within the last week";
  return "Stale — older than 7 days";
}

export function CloudAccountPanel({
  cloud,
  disabled = false,
}: {
  cloud: CloudController;
  disabled?: boolean;
}) {
  const { account: ctrl, sync } = cloud;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [activeOAuthProvider, setActiveOAuthProvider] = useState<"google" | "github" | null>(null);
  const [projectNamesDraft, setProjectNamesDraft] = useState<string | null>(null);
  const [confirmingFirstSync, setConfirmingFirstSync] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  if (!ctrl.configured) {
    return (
      <div className="account-sharing-page">
        <AccountSharingHeading />
        <ManagerAccessSettingsRow />
        <section className="settings-row">
          <div className="settings-row-icon"><Cloud size={18} aria-hidden /></div>
          <div>
            <h3>Weekform Web is not configured in this build</h3>
            <p>
              This build has no Web sync endpoint, so Weekform stays fully local: nothing can be
              uploaded, and no account features are available. Everything else in the app works normally.
            </p>
          </div>
          <div className="settings-row-status">
            <strong>Local only</strong>
            <span>No upload path exists</span>
          </div>
        </section>
      </div>
    );
  }

  const signedIn = ctrl.account !== null;
  const policy = ctrl.policy;
  const selectedTeam = ctrl.teams.find((team) => team.teamId === policy.teamId) ?? null;
  const sharedMetricLabels = CLOUD_METRIC_KEYS.filter((key) => policy.metrics[key]).map(
    (key) => CLOUD_METRIC_LABELS[key]
  );
  const snapshotFreshness = sharedSnapshotFreshness(
    ctrl.syncState.lastSuccessAt,
    ctrl.syncState.lastSyncedClientSnapshotId !== null
  );

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || ctrl.isDemoMode || ctrl.authBusy) return;
    const succeeded = await ctrl.signIn(email, password);
    if (succeeded) setPassword("");
  };

  const handleOAuthSignIn = async (provider: "google" | "github") => {
    if (disabled || ctrl.isDemoMode || ctrl.authBusy) return;
    setActiveOAuthProvider(provider);
    try {
      await ctrl.signInWithOAuth(provider);
    } finally {
      setActiveOAuthProvider(null);
    }
  };

  const commitProjectNames = () => {
    if (disabled) return;
    if (projectNamesDraft === null) return;
    const names = Array.from(
      new Set(
        projectNamesDraft
          .split("\n")
          .map((name) => truncateSharedProjectName(name))
          .filter((name): name is string => name !== null)
      )
    ).slice(0, MAX_SHARED_PROJECTS);
    ctrl.updatePolicy({ allowedProjectNames: names });
    setProjectNamesDraft(null);
  };

  const startSync = () => {
    if (disabled) return;
    if (!sync.buildResult.ok) return;
    if (ctrl.syncState.lastSuccessAt === null) {
      setConfirmingFirstSync(true);
      return;
    }
    void sync.syncNow();
  };

  return (
    <fieldset
      className="account-sharing-page cloud-account-reset-boundary"
      disabled={disabled}
      aria-busy={disabled}
    >
      <AccountSharingHeading />

      {!signedIn && (
        <section className="cloud-auth-card" aria-labelledby="weekform-web-signin-title">
          <div className="cloud-auth-intro">
            <span className="cloud-auth-mark" aria-hidden><Cloud size={16} /></span>
            <div>
              <span className="cloud-auth-kicker">Your Weekform account</span>
              <h3 id="weekform-web-signin-title">Sign in to Weekform Web</h3>
            </div>
            <p>
              Continue your private workspace across Mac and Web. Sharing stays off until you choose
              a team, review the exact payload, and approve the first sync.
            </p>
            <span className="cloud-auth-trust"><ShieldCheck size={13} aria-hidden /> Session stored in macOS Keychain</span>
          </div>

          <div className="cloud-auth-actions">
            {ctrl.isDemoMode && (
              <p className="cloud-auth-note" role="note">Sign-in is available in the desktop app.</p>
            )}
            <div className="cloud-oauth-options" aria-label="Sign-in options">
              <button
                className="cloud-oauth-button"
                type="button"
                disabled={ctrl.isDemoMode || ctrl.authBusy}
                aria-busy={activeOAuthProvider === "google"}
                onClick={() => void handleOAuthSignIn("google")}
              >
                <span className="cloud-provider-tile" aria-hidden>
                  {activeOAuthProvider === "google" ? <LoaderCircle className="spin" size={18} /> : (
                    <svg viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z" />
                      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.38l-3.24-2.53c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.61A10 10 0 0 0 12 22Z" />
                      <path fill="#FBBC05" d="M6.39 13.92A6.02 6.02 0 0 1 6.08 12c0-.67.11-1.32.31-1.92V7.47H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.53l3.35-2.61Z" />
                      <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.47l3.35 2.61C7.18 7.71 9.39 5.95 12 5.95Z" />
                    </svg>
                  )}
                </span>
                <span>Sign in with Google</span>
              </button>

              <button
                className="cloud-oauth-button"
                type="button"
                disabled={ctrl.isDemoMode || ctrl.authBusy}
                aria-busy={activeOAuthProvider === "github"}
                onClick={() => void handleOAuthSignIn("github")}
              >
                <span className="cloud-provider-tile" aria-hidden>
                  {activeOAuthProvider === "github" ? <LoaderCircle className="spin" size={18} /> : (
                    <svg viewBox="0 0 24 24">
                      <path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.58 9.58 0 0 1 12 6.82a9.6 9.6 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
                    </svg>
                  )}
                </span>
                <span>Sign in with GitHub</span>
              </button>
            </div>

            <details className="cloud-password-disclosure">
              <summary>
                <span>Sign in with email and password</span>
                <ChevronDown className="cloud-disclosure-chevron" size={15} aria-hidden />
              </summary>
              <form className="ai-form cloud-signin-form" onSubmit={handleSignIn}>
                <div className="ai-field">
                  <label htmlFor="cloud-email">Email</label>
                  <input id="cloud-email" type="email" autoComplete="username" value={email} disabled={ctrl.isDemoMode} onChange={(event) => setEmail(event.target.value)} />
                </div>
                <div className="ai-field">
                  <label htmlFor="cloud-password">Password</label>
                  <input id="cloud-password" type="password" autoComplete="current-password" value={password} disabled={ctrl.isDemoMode} onChange={(event) => setPassword(event.target.value)} />
                </div>
                <button className="primary-action cloud-password-submit" type="submit" disabled={ctrl.isDemoMode || ctrl.authBusy || !email.trim() || !password} aria-busy={ctrl.authBusy}>
                  {ctrl.authBusy && activeOAuthProvider === null ? <LoaderCircle className="spin" size={15} aria-hidden /> : <LogIn size={15} aria-hidden />}
                  <span>{ctrl.authBusy && activeOAuthProvider === null ? "Signing in…" : "Sign in"}</span>
                </button>
              </form>
            </details>
            {ctrl.authError && <p className="cloud-auth-error import-error" role="alert">{ctrl.authError}</p>}
          </div>
        </section>
      )}

      <ManagerAccessSettingsRow />

      {signedIn && ctrl.account && (
        <>
          <section className="settings-row">
            <div className="settings-row-icon"><Cloud size={18} aria-hidden /></div>
            <div>
              <h3>Connected account</h3>
              <p>
                Signed in as {ctrl.account.email}
                {ctrl.account.displayName ? ` (${ctrl.account.displayName})` : ""}. The native session is kept
                in macOS Keychain and is excluded from data exports. Disconnecting
                stops all future syncs.
              </p>
              {ctrl.authError && <p className="import-error" role="alert">{ctrl.authError}</p>}
            </div>
            <div className="settings-row-status">
              <strong>Connected</strong>
              <span>
                {ctrl.account.signedInAt
                  ? <>Since <time dateTime={ctrl.account.signedInAt}>{formatAuditTime(ctrl.account.signedInAt)}</time></>
                  : "Session active"}
              </span>
            </div>
            <button className="settings-control" type="button" onClick={() => setConfirmingDisconnect(true)}>
              <LogOut size={15} aria-hidden />
              <span>Disconnect</span>
            </button>
          </section>

          <section className="settings-row">
            <div className="settings-row-icon"><Laptop size={18} aria-hidden /></div>
            <div>
              <h3>Private Web workspace</h3>
              <p>
                Keep Weekform Web current with review-safe derived blocks and capacity metrics. This
                private replica never includes raw samples, app or window titles, evidence, notes,
                project or stakeholder names, screenshots, audit detail, or AI credentials. Web edits
                arrive here as requests and cannot change local truth until you approve them on this Mac.
              </p>
              {cloud.personal.lastError && <p className="import-error" role="alert">{cloud.personal.lastError}</p>}
              {cloud.personal.lastNotice && !cloud.personal.lastError && (
                <p className="cloud-consent-note" role="status" aria-live="polite" aria-atomic="true">
                  <CheckCircle2 size={13} aria-hidden /> {cloud.personal.lastNotice}
                </p>
              )}
              {cloud.personal.pendingCommands.length > 0 && (
                <div className="cloud-share-preview" aria-label="Pending Web review requests">
                  <strong>{cloud.personal.pendingCommands.length} Web review request{cloud.personal.pendingCommands.length === 1 ? "" : "s"}</strong>
                  <ul className="cloud-share-preview-lines">
                    {cloud.personal.pendingCommands.map((command) => (
                      <li key={command.commandId}>
                        <span>
                          {command.action === "confirm" ? "Confirm" : command.action === "exclude" ? "Exclude" : "Relabel"}
                          {" "}block {command.blockId.slice(0, 8)}… for {command.weekId}
                        </span>
                        <div className="ai-provider-actions">
                          <button className="settings-control" type="button" onClick={() => void cloud.personal.rejectCommand(command.commandId)}>
                            Reject
                          </button>
                          <button className="primary-action" type="button" onClick={() => void cloud.personal.approveCommand(command.commandId)}>
                            Approve on Mac
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="settings-row-status">
              <strong>{cloud.personal.enabled ? "On" : "Off"}</strong>
              <span>
                {cloud.personal.enabled
                  ? cloud.personal.queuedBatches > 0
                    ? `${cloud.personal.queuedBatches} update${cloud.personal.queuedBatches === 1 ? "" : "s"} queued`
                    : ctrl.personalSyncState.lastSuccessAt
                      ? <>Synced <time dateTime={ctrl.personalSyncState.lastSuccessAt}>{formatAuditTime(ctrl.personalSyncState.lastSuccessAt)}</time></>
                      : "Ready to sync"
                  : "No personal replica uploads"}
              </span>
            </div>
            <div className="data-export-options">
              {cloud.personal.enabled ? (
                <>
                  <button className="settings-control" type="button" onClick={() => void cloud.personal.syncNow()} disabled={cloud.personal.syncBusy}>
                    <RefreshCw size={15} aria-hidden className={cloud.personal.syncBusy ? "spin" : undefined} />
                    <span>{cloud.personal.syncBusy ? "Syncing…" : "Sync Web"}</span>
                  </button>
                  <button className="settings-control" type="button" onClick={() => ctrl.updatePersonalReplicaPolicy({ enabled: false })}>
                    Turn Off
                  </button>
                </>
              ) : (
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => {
                    const consentedAt = new Date().toISOString();
                    ctrl.updatePersonalReplicaPolicy({ enabled: true, consentedAt });
                  }}
                >
                  Enable Web workspace
                </button>
              )}
            </div>
          </section>

          <section className="settings-row">
            <div className="settings-row-icon"><Users size={18} aria-hidden /></div>
            <div>
              <h3>Recipient team</h3>
              <p>
                Snapshots go to exactly one team you belong to. Changing the team clears your previous
                consent — you review the payload again before the next sync.
              </p>
              {ctrl.teamsError && <p className="import-error" role="alert">{ctrl.teamsError}</p>}
            </div>
            <div className="settings-row-status">
              <strong>{selectedTeam ? selectedTeam.teamName : "No team selected"}</strong>
              <span>
                {ctrl.teams.length === 0
                  ? "No active memberships found"
                  : selectedTeam
                    ? `Your role: ${selectedTeam.role}`
                    : `${ctrl.teams.length} team${ctrl.teams.length === 1 ? "" : "s"} available`}
              </span>
            </div>
            <div className="data-export-options">
              <label className="sr-only" htmlFor="cloud-team">Recipient team</label>
              <select
                id="cloud-team"
                value={policy.teamId ?? ""}
                onChange={(event) => ctrl.updatePolicy({ teamId: event.target.value || null })}
              >
                <option value="">No team selected</option>
                {ctrl.teams.map((team) => (
                  <option key={team.teamId} value={team.teamId}>{team.teamName}</option>
                ))}
              </select>
              <button
                className="settings-control"
                type="button"
                onClick={() => void ctrl.refreshTeams()}
                aria-label="Refresh team list"
              >
                <RefreshCw size={15} aria-hidden />
                <span>Refresh</span>
              </button>
            </div>
          </section>

          <section className="settings-row">
            <div className="settings-row-icon"><ShieldCheck size={18} aria-hidden /></div>
            <div>
              <h3>Share weekly capacity snapshot</h3>
              <p>
                Off by default. When on, only the fields you select below can be shared — never raw
                activity, window titles, sessions, evidence, notes, calendar or chat details,
                screenshots, audit entries, or AI keys.
              </p>
            </div>
            <div className="settings-row-status">
              <strong>{policy.enabled ? "On" : "Off"}</strong>
              <span>
                {policy.enabled
                  ? `${sharedMetricLabels.length} metric${sharedMetricLabels.length === 1 ? "" : "s"} at the "${policy.shareLevel}" level`
                  : "Nothing is uploaded"}
              </span>
            </div>
            <button
              className={policy.enabled ? "settings-control is-on" : "settings-control"}
              type="button"
              aria-pressed={policy.enabled}
              onClick={() => ctrl.updatePolicy({ enabled: !policy.enabled })}
            >
              {policy.enabled ? "Turn Sharing Off" : "Turn Sharing On"}
            </button>
          </section>

          {policy.enabled && (
            <>
              <section className="settings-row">
                <div className="settings-row-icon"><ShieldCheck size={18} aria-hidden /></div>
                <div>
                  <h3>Share level</h3>
                  <p>{SHARE_LEVEL_OPTIONS.find((option) => option.value === policy.shareLevel)?.hint}.</p>
                </div>
                <div className="settings-row-status" role="status" aria-live="polite" aria-atomic="true">
                  <strong>{SHARE_LEVEL_OPTIONS.find((option) => option.value === policy.shareLevel)?.label}</strong>
                  <span>Each level adds to the previous one</span>
                </div>
                <div className="data-export-options">
                  <label className="sr-only" htmlFor="cloud-share-level">Share level</label>
                  <select
                    id="cloud-share-level"
                    value={policy.shareLevel}
                    onChange={(event) => ctrl.updatePolicy({ shareLevel: event.target.value as CloudShareLevel })}
                  >
                    {SHARE_LEVEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="settings-row cloud-metric-row">
                <div className="settings-row-icon"><ShieldCheck size={18} aria-hidden /></div>
                <div>
                  <h3>Shared metrics</h3>
                  <p>
                    Each metric is an individual consent switch. A metric that is off is omitted from
                    the payload entirely — never sent as zero.
                  </p>
                  <div className="cloud-metric-grid" role="group" aria-label="Shared metrics">
                    {CLOUD_METRIC_KEYS.map((key: keyof CloudMetricPolicy) => (
                      <label key={key} className="cloud-metric-toggle">
                        <input
                          type="checkbox"
                          checked={policy.metrics[key]}
                          onChange={(event) =>
                            ctrl.updatePolicy({
                              metrics: { ...policy.metrics, [key]: event.target.checked }
                            })
                          }
                        />
                        <span>{CLOUD_METRIC_LABELS[key]}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="settings-row-status">
                  <strong>{sharedMetricLabels.length} of {CLOUD_METRIC_KEYS.length}</strong>
                  <span>Review coverage counts are always included</span>
                </div>
              </section>

              {policy.shareLevel === "projects" && (
                <section className="settings-row">
                  <div className="settings-row-icon"><ShieldCheck size={18} aria-hidden /></div>
                  <div>
                    <h3>Allowed project names</h3>
                    <p>
                      One exact project name per line, up to {MAX_SHARED_PROJECTS}. Project allocation is built only from work
                      blocks you verified whose project name matches this list verbatim — any other
                      name never appears, not even grouped.
                    </p>
                    <textarea
                      className="cloud-project-allowlist"
                      aria-label="Allowed project names, one per line"
                      rows={4}
                      value={projectNamesDraft ?? policy.allowedProjectNames.join("\n")}
                      onChange={(event) => setProjectNamesDraft(event.target.value)}
                      onBlur={commitProjectNames}
                    />
                    {projectNamesDraft !== null && (
                      <p className="cloud-allowlist-hint" role="status">
                        <AlertCircle size={13} aria-hidden /> Unsaved edits — they apply when you leave
                        the field.
                        <button
                          type="button"
                          className="link-action"
                          // Commit on mousedown: the textarea's blur handler would otherwise
                          // commit first and unmount this button before its click lands.
                          onMouseDown={(event) => {
                            event.preventDefault();
                            commitProjectNames();
                          }}
                        >
                          Apply now
                        </button>
                      </p>
                    )}
                  </div>
                  <div className="settings-row-status">
                    <strong>{policy.allowedProjectNames.length} of {MAX_SHARED_PROJECTS} allowed</strong>
                    <span>Empty list shares no project names</span>
                  </div>
                </section>
              )}

              <section className="settings-row">
                <div className="settings-row-icon"><Timer size={18} aria-hidden /></div>
                <div>
                  <h3>Hourly auto-sync</h3>
                  <p>
                    Off by default. When on, Weekform re-syncs the approved snapshot about once an hour
                    — only while the app is running, and only after your first manually approved sync.
                  </p>
                </div>
                <div className="settings-row-status">
                  <strong>{policy.autoSyncEnabled ? "On" : "Off"}</strong>
                  <span>Requires the app to be open</span>
                </div>
                <button
                  className={policy.autoSyncEnabled ? "settings-control is-on" : "settings-control"}
                  type="button"
                  aria-pressed={policy.autoSyncEnabled}
                  onClick={() => ctrl.updatePolicy({ autoSyncEnabled: !policy.autoSyncEnabled })}
                >
                  {policy.autoSyncEnabled ? "Disable Auto-Sync" : "Enable Auto-Sync"}
                </button>
              </section>

              <section className="settings-row cloud-preview-row">
                <div className="settings-row-icon"><CloudUpload size={18} aria-hidden /></div>
                <div>
                  <h3>Review and sync</h3>
                  <p>
                    This is the exact payload the selected team receives — nothing more. Review it,
                    record your consent, then sync.
                  </p>
                  <SharePreview result={sync.buildResult} teamName={selectedTeam?.teamName ?? null} />
                  {sync.buildResult.ok && policy.consentedAt === null && (
                    <button className="secondary-action" type="button" onClick={ctrl.recordConsent}>
                      <ShieldCheck size={15} aria-hidden />
                      <span>I reviewed what will be shared with this team</span>
                    </button>
                  )}
                  {policy.consentedAt !== null && (
                    <p className="cloud-consent-note">
                      <CheckCircle2 size={13} aria-hidden /> Consent recorded{" "}
                      <time dateTime={policy.consentedAt}>{formatAuditTime(policy.consentedAt)}</time>.
                      Changing the team or the shared fields asks you to review again.
                    </p>
                  )}
                </div>
                <div className="settings-row-status" role="status" aria-live="polite" aria-atomic="true">
                  <strong>
                    {ctrl.syncState.status === "syncing"
                      ? "Syncing…"
                      : sync.upToDate
                        ? "Up to date"
                        : ctrl.syncState.status === "error"
                          ? "Last attempt failed"
                          : "Not synced yet"}
                  </strong>
                  <span>
                    {ctrl.syncState.lastSuccessAt
                      ? <>Last success <time dateTime={ctrl.syncState.lastSuccessAt}>{formatAuditTime(ctrl.syncState.lastSuccessAt)}</time></>
                      : "No successful sync yet"}
                  </span>
                  {ctrl.syncState.lastAttemptAt && (
                    <span>
                      Last attempt <time dateTime={ctrl.syncState.lastAttemptAt}>{formatAuditTime(ctrl.syncState.lastAttemptAt)}</time>
                    </span>
                  )}
                  {snapshotFreshness && <span>{snapshotFreshness}</span>}
                  {policy.autoSyncEnabled && ctrl.syncState.nextScheduledAt && (
                    <span>
                      Next auto-sync attempt{" "}
                      <time dateTime={ctrl.syncState.nextScheduledAt}>{formatAuditTime(ctrl.syncState.nextScheduledAt)}</time>
                    </span>
                  )}
                  {policy.autoSyncEnabled && !ctrl.syncState.nextScheduledAt && policy.consentedAt !== null && (
                    <span>Auto-sync is not currently scheduled — sync once manually to arm it.</span>
                  )}
                  {ctrl.syncState.lastSyncedClientSnapshotId && (
                    <small>Synced row id: {ctrl.syncState.lastSyncedClientSnapshotId}</small>
                  )}
                  {ctrl.syncState.lastError && (
                    <small className="import-error" role="alert">
                      <AlertCircle size={12} aria-hidden /> {ctrl.syncState.lastError}
                    </small>
                  )}
                </div>
                <button
                  className="primary-action"
                  type="button"
                  disabled={
                    !sync.buildResult.ok ||
                    policy.consentedAt === null ||
                    sync.syncBusy
                  }
                  aria-busy={sync.syncBusy}
                  onClick={startSync}
                >
                  {sync.syncBusy
                    ? <LoaderCircle className="spin" size={15} aria-hidden />
                    : <CloudUpload size={15} aria-hidden />}
                  <span>{sync.syncBusy ? "Syncing…" : "Sync Now"}</span>
                </button>
              </section>
            </>
          )}

          <section className="settings-row">
            <div className="settings-row-icon"><Trash2 size={18} aria-hidden /></div>
            <div>
              <h3>Delete my snapshots for the selected team</h3>
              <p>
                Removes every snapshot row you previously synced to{" "}
                {selectedTeam ? selectedTeam.teamName : "the selected team"} from the cloud. Local data
                on this Mac is untouched.
              </p>
            </div>
            <div className="settings-row-status">
              <strong>Cloud rows only</strong>
              <span>Your local ledger stays intact</span>
            </div>
            <button
              className="settings-control"
              type="button"
              disabled={policy.teamId === null || sync.deleteBusy}
              aria-busy={sync.deleteBusy}
              onClick={() => setConfirmingDelete(true)}
            >
              {sync.deleteBusy
                ? <LoaderCircle className="spin" size={15} aria-hidden />
                : <Trash2 size={15} aria-hidden />}
              <span>Delete My Snapshots</span>
            </button>
          </section>
        </>
      )}

      {confirmingFirstSync && sync.buildResult.ok && (
        <ConfirmDialog
          title="Share this snapshot with your team?"
          tone="default"
          description={`This uploads the previewed weekly snapshot to ${selectedTeam ? selectedTeam.teamName : "the selected team"}. Only the listed fields are sent — nothing else.`}
          confirmLabel="Share snapshot"
          onConfirm={() => {
            setConfirmingFirstSync(false);
            void sync.syncNow();
          }}
          onCancel={() => setConfirmingFirstSync(false)}
        >
          <ul className="dialog-delete-list">
            <li>Recipient: {selectedTeam ? selectedTeam.teamName : sync.buildResult.snapshot.teamId}</li>
            <li>Week {sync.buildResult.snapshot.weekId} at the "{sync.buildResult.snapshot.shareLevel}" level</li>
            <li>
              {sharedMetricLabels.length > 0
                ? `Metrics: ${sharedMetricLabels.join(", ")}`
                : "Metrics: none selected"}
            </li>
            <li>Review coverage counts (reviewed / eligible blocks)</li>
            <li>Never sent: raw activity, titles, evidence, notes, calendar or chat details, screenshots, AI keys</li>
          </ul>
        </ConfirmDialog>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete your synced snapshots?"
          description={`This removes every snapshot you synced to ${selectedTeam ? selectedTeam.teamName : "the selected team"} from the cloud. Managers will no longer see your rows. Local data is untouched.`}
          confirmLabel="Delete from cloud"
          onConfirm={() => {
            setConfirmingDelete(false);
            void sync.deleteMySnapshots();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      {confirmingDisconnect && (
        <ConfirmDialog
          title="Disconnect Weekform Web?"
          description="This signs out this Mac and stops all future syncs. Your local Weekform data and snapshots already shared with your team are untouched."
          confirmLabel="Disconnect"
          onConfirm={() => {
            setConfirmingDisconnect(false);
            void ctrl.signOut();
          }}
          onCancel={() => setConfirmingDisconnect(false)}
        />
      )}
    </fieldset>
  );
}
