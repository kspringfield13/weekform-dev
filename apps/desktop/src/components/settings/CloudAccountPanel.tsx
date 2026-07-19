// Account & Sharing settings tab: sign in with the weekform.com account, pick the
// recipient team, edit the CloudSharePolicyV1, review the EXACT payload, and run the
// manually approved sync. Sharing is off by default; nothing here claims "all data
// synced" — the preview names the recipient team and every selected field.

import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudUpload,
  FlaskConical,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Timer,
  Trash2,
  Users
} from "lucide-react";
import type { CloudMetricPolicy, CloudShareLevel } from "../../../../../packages/domain/src/cloud";
import { CLOUD_METRIC_KEYS, CLOUD_METRIC_LABELS } from "../../services/cloudPolicy";
import type { CloudController } from "../../hooks/useCloudSync";
import { formatAuditTime } from "../../lib/format";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { SharePreview } from "./SharePreview";
import {
  getLocalSimulatorPortalNavigation,
  type SimulatorAdminNavigation
} from "../../../../../packages/simulator/src/authorization";

const SHARE_LEVEL_OPTIONS: Array<{ value: CloudShareLevel; label: string; hint: string }> = [
  { value: "summary", label: "Summary", hint: "Capacity metrics and review coverage only" },
  { value: "categories", label: "Categories", hint: "Adds category and work-mode allocation" },
  { value: "projects", label: "Projects", hint: "Adds allocation for allowlisted project names from verified blocks" }
];

const DAY_MS = 24 * 60 * 60 * 1000;

function AccountSharingHeading() {
  return (
    <div className="settings-section-heading">
      <div>
        <h2>Account &amp; sharing</h2>
        <span>
          Optionally share a small, reviewed weekly capacity snapshot with one team. Sharing is off
          by default, every field is opt-in, and nothing uploads without your explicit approval.
        </span>
      </div>
    </div>
  );
}

function AdminPortalSettingsRow({ navigation }: { navigation: SimulatorAdminNavigation }) {
  return (
    <section className="settings-row">
      <div className="settings-row-icon"><FlaskConical size={18} aria-hidden /></div>
      <div>
        <h3>{navigation.label}</h3>
        <p>
          Open the local administrator sign-in for Span Simulator. Its published synthetic demo
          credentials grant no Weekform Cloud or production access.
        </p>
      </div>
      <div className="settings-row-status">
        <strong>Development only</strong>
        <span>{navigation.description}</span>
      </div>
      <button
        className="settings-control"
        type="button"
        onClick={() => window.location.assign(navigation.href)}
      >
        <FlaskConical size={15} aria-hidden />
        <span>Open Admin Portal</span>
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

export function CloudAccountPanel({ cloud }: { cloud: CloudController }) {
  const { account: ctrl, sync } = cloud;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [projectNamesDraft, setProjectNamesDraft] = useState<string | null>(null);
  const [confirmingFirstSync, setConfirmingFirstSync] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const simulatorNavigation = getLocalSimulatorPortalNavigation(
    import.meta.env.DEV && import.meta.env.VITE_ENABLE_SPAN_SIMULATOR === "true"
  );

  if (!ctrl.configured) {
    return (
      <>
        <AccountSharingHeading />
        {simulatorNavigation && <AdminPortalSettingsRow navigation={simulatorNavigation} />}
        <section className="settings-row">
          <div className="settings-row-icon"><Cloud size={18} aria-hidden /></div>
          <div>
            <h3>Weekform Cloud is not configured in this build</h3>
            <p>
              This build has no cloud sync endpoint, so Weekform stays fully local: nothing can be
              uploaded, and no account features are available. Everything else in the app works normally.
            </p>
          </div>
          <div className="settings-row-status">
            <strong>Local only</strong>
            <span>No upload path exists</span>
          </div>
        </section>
      </>
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
    if (ctrl.isDemoMode || ctrl.authBusy) return;
    const succeeded = await ctrl.signIn(email, password);
    if (succeeded) setPassword("");
  };

  const commitProjectNames = () => {
    if (projectNamesDraft === null) return;
    const names = projectNamesDraft
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    ctrl.updatePolicy({ allowedProjectNames: names });
    setProjectNamesDraft(null);
  };

  const startSync = () => {
    if (!sync.buildResult.ok) return;
    if (ctrl.syncState.lastSuccessAt === null) {
      setConfirmingFirstSync(true);
      return;
    }
    void sync.syncNow();
  };

  return (
    <>
      <AccountSharingHeading />
      {simulatorNavigation && <AdminPortalSettingsRow navigation={simulatorNavigation} />}

      {!signedIn && (
        <section className="settings-row">
          <div className="settings-row-icon"><LogIn size={18} aria-hidden /></div>
          <div>
            <h3>Sign in to Weekform Cloud</h3>
            <p>
              Use the account you created on weekform.com — account creation starts there, not in the
              app. Your session is kept in local prototype storage on this Mac (unencrypted, never
              included in JSON exports).
            </p>
            {ctrl.isDemoMode && (
              <p className="import-error" role="note">Cloud sign-in is disabled in the browser demo.</p>
            )}
            <form className="ai-form cloud-signin-form" onSubmit={handleSignIn}>
              <div className="ai-field">
                <label htmlFor="cloud-email">Email</label>
                <input
                  id="cloud-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  disabled={ctrl.isDemoMode}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="ai-field">
                <label htmlFor="cloud-password">Password</label>
                <input
                  id="cloud-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={ctrl.isDemoMode}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="ai-provider-actions">
                <button
                  className="primary-action"
                  type="submit"
                  disabled={ctrl.isDemoMode || ctrl.authBusy || !email.trim() || !password}
                  aria-busy={ctrl.authBusy}
                >
                  {ctrl.authBusy ? <LoaderCircle className="spin" size={15} aria-hidden /> : <LogIn size={15} aria-hidden />}
                  <span>{ctrl.authBusy ? "Signing in…" : "Sign In"}</span>
                </button>
              </div>
              {ctrl.authError && (
                <p className="import-error" role="alert">{ctrl.authError}</p>
              )}
            </form>
          </div>
        </section>
      )}

      {signedIn && ctrl.account && (
        <>
          <section className="settings-row">
            <div className="settings-row-icon"><Cloud size={18} aria-hidden /></div>
            <div>
              <h3>Connected account</h3>
              <p>
                Signed in as {ctrl.account.email}
                {ctrl.account.displayName ? ` (${ctrl.account.displayName})` : ""}. The session is kept
                in local prototype storage on this Mac and is excluded from data exports. Disconnecting
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
                      One exact project name per line. Project allocation is built only from work
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
                    <strong>{policy.allowedProjectNames.length} allowed</strong>
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
          title="Disconnect Weekform Cloud?"
          description="This signs out this Mac and stops all future syncs. Your local Weekform data and snapshots already shared with your team are untouched."
          confirmLabel="Disconnect"
          onConfirm={() => {
            setConfirmingDisconnect(false);
            void ctrl.signOut();
          }}
          onCancel={() => setConfirmingDisconnect(false)}
        />
      )}
    </>
  );
}
