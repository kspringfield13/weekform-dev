import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UserRound,
  Waypoints,
} from "lucide-react";
import type {
  OutlookCalendarEvent,
  RawEvent,
  WeeklyCapacitySnapshot,
  WorkBlock,
} from "../../../../../packages/domain/src/models";
import type {
  TeamCalendarEvidenceDay,
  TeamTimelineIdentity,
  TeamTimelinePoint,
} from "../../../../../packages/inference/src/teamTimeline";
import { buildTeamCalendarEvidence } from "../../../../../packages/inference/src/teamTimeline";
import type { CloudController } from "../../hooks/useCloudSync";
import {
  buildManagerRosterMember,
  resolveTeamWorkspaceMembership,
  type LiveManagerRosterMember,
} from "../../services/adminPortal";
import {
  fetchManagerTeamWorkspace,
  fetchTeamWorkloadTimeline,
  getCloudEnv,
  type CloudManagerWorkspaceData,
  type CloudTeamTimelineSnapshot,
} from "../../services/cloudClient";
import { TeamGantt } from "./TeamGantt";
import "./TeamScreen.css";

type LoadState = "idle" | "loading" | "ready" | "error";

const METRIC_LABELS: Record<string, string> = {
  reliableNewWorkCapacityPct: "Reliable capacity",
  allocatedPct: "Allocated",
  reactivePct: "Reactive load",
  meetingPct: "Meetings",
  fragmentedWorkPct: "Fragmented work",
  blockedPct: "Blocked",
  carryoverRiskPct: "Carryover risk",
  contextSwitchScore: "Context switching",
  wipLoadScore: "Work in progress",
  summaryConfidence: "Summary confidence",
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not synced yet";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Sync time unavailable" : parsed.toLocaleString();
}

function reviewCoverage(member: LiveManagerRosterMember): number | null {
  return member.review;
}

export function TeamScreen({
  cloud,
  snapshot,
  blocks,
  calendarEvents,
  chatEvents,
  calendarConnected,
  chatConnected,
  hasWorkBlocks,
  onOpenIndividual,
  onOpenManagerWorkspace,
  onOpenSharingSettings,
}: {
  cloud: CloudController;
  snapshot: WeeklyCapacitySnapshot;
  blocks: WorkBlock[];
  calendarEvents: OutlookCalendarEvent[];
  chatEvents: RawEvent[];
  calendarConnected: boolean;
  chatConnected: boolean;
  hasWorkBlocks: boolean;
  onOpenIndividual: () => void;
  onOpenManagerWorkspace: () => void;
  onOpenSharingSettings: () => void;
}) {
  const demoMode = cloud.account.isDemoMode;
  const membership = useMemo(() => demoMode ? {
    teamId: "demo-atlas-team",
    teamName: "Atlas Analytics",
    role: "manager" as const,
    sharePolicy: null,
  } : resolveTeamWorkspaceMembership(
    cloud.account.teams,
    cloud.account.policy.teamId,
  ), [cloud.account.policy.teamId, cloud.account.teams, demoMode]);
  const manager = membership?.role === "owner" || membership?.role === "manager";
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [managerData, setManagerData] = useState<CloudManagerWorkspaceData | null>(null);
  const [timelineSnapshots, setTimelineSnapshots] = useState<CloudTeamTimelineSnapshot[]>([]);
  const [timelineState, setTimelineState] = useState<LoadState>("idle");
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "done">("idle");
  const localCalendarEvidence = useMemo<TeamCalendarEvidenceDay[]>(() => (
    buildTeamCalendarEvidence({ calendarEvents, chatEvents, workBlocks: blocks })
  ), [blocks, calendarEvents, chatEvents]);

  useEffect(() => {
    let current = true;
    if (demoMode) {
      const now = new Date().toISOString();
      setManagerData({
        latestSyncedAt: now,
        members: [
          { id: "demo-atlas-team:demo-manager", userId: "demo-manager", teamId: "demo-atlas-team", teamName: "Atlas Analytics", role: "manager", joinedAt: now, displayName: "Morgan Lee", email: "morgan@example.test", isSelf: true, snapshot: { weekId: snapshot.week_id, syncedAt: now, shareLevel: "summary", reliableCapacityPct: snapshot.reliable_new_work_capacity_pct, reactivePct: snapshot.reactive_pct, meetingPct: snapshot.meeting_pct, fragmentedPct: snapshot.fragmented_work_pct, summaryConfidence: snapshot.summary_confidence, reviewedBlocks: blocks.filter((block) => block.user_verified).length, eligibleBlocks: blocks.length } },
          { id: "demo-atlas-team:demo-member-a", userId: "demo-member-a", teamId: "demo-atlas-team", teamName: "Atlas Analytics", role: "member", joinedAt: now, displayName: "Ari Chen", email: "ari@example.test", isSelf: false, snapshot: { weekId: snapshot.week_id, syncedAt: now, shareLevel: "summary", reliableCapacityPct: 18, reactivePct: 34, meetingPct: 27, fragmentedPct: 24, summaryConfidence: 0.82, reviewedBlocks: 11, eligibleBlocks: 13 } },
          { id: "demo-atlas-team:demo-member-b", userId: "demo-member-b", teamId: "demo-atlas-team", teamName: "Atlas Analytics", role: "member", joinedAt: now, displayName: "Sam Rivera", email: "sam@example.test", isSelf: false, snapshot: { weekId: snapshot.week_id, syncedAt: now, shareLevel: "summary", reliableCapacityPct: 31, reactivePct: 19, meetingPct: 21, fragmentedPct: 16, summaryConfidence: 0.88, reviewedBlocks: 9, eligibleBlocks: 10 } },
        ],
      });
      setLoadError(null);
      setLoadState("ready");
      return () => { current = false; };
    }
    if (!manager || !membership) {
      setManagerData(null);
      setLoadState("idle");
      return () => { current = false; };
    }

    const load = async () => {
      const env = getCloudEnv();
      if (!env) {
        if (current) {
          setLoadError("This build is not connected to the authenticated team service.");
          setLoadState("error");
        }
        return;
      }
      setLoadState("loading");
      const session = await cloud.account.getFreshSession();
      if (!session) {
        if (current) {
          setLoadError("Weekform could not confirm your Weekform Web session. Check your connection, or sign in again.");
          setLoadState("error");
        }
        return;
      }
      const result = await fetchManagerTeamWorkspace(env, session, [membership]);
      if (!current) return;
      if (!result.ok) {
        setLoadError(result.message);
        setLoadState("error");
        return;
      }
      setManagerData(result.value);
      setLoadError(null);
      setLoadState("ready");
    };
    void load();
    return () => { current = false; };
  }, [blocks, cloud.account.getFreshSession, demoMode, manager, membership, snapshot]);

  useEffect(() => {
    let current = true;
    if (demoMode) {
      const now = new Date().toISOString();
      setTimelineSnapshots([
        { userId: "demo-manager", weekId: snapshot.week_id, syncedAt: now, reliableCapacityPct: snapshot.reliable_new_work_capacity_pct, reactivePct: snapshot.reactive_pct, meetingPct: snapshot.meeting_pct, fragmentedPct: snapshot.fragmented_work_pct, reviewedBlocks: blocks.filter((block) => block.user_verified).length, eligibleBlocks: blocks.length },
        { userId: "demo-member-a", weekId: snapshot.week_id, syncedAt: now, reliableCapacityPct: 18, reactivePct: 34, meetingPct: 27, fragmentedPct: 24, reviewedBlocks: 11, eligibleBlocks: 13 },
        { userId: "demo-member-b", weekId: snapshot.week_id, syncedAt: now, reliableCapacityPct: 31, reactivePct: 19, meetingPct: 21, fragmentedPct: 16, reviewedBlocks: 9, eligibleBlocks: 10 },
      ]);
      setTimelineError(null);
      setTimelineState("ready");
      return () => { current = false; };
    }
    if (!membership) return () => { current = false; };
    const loadTimeline = async () => {
      const env = getCloudEnv();
      if (!env) {
        if (current) {
          setTimelineError("This build is not connected to the authenticated team service.");
          setTimelineState("error");
        }
        return;
      }
      setTimelineState("loading");
      const session = await cloud.account.getFreshSession();
      if (!session) {
        if (current) {
          setTimelineError("Weekform could not confirm your Weekform Web session before the workload horizon could load.");
          setTimelineState("error");
        }
        return;
      }
      const result = await fetchTeamWorkloadTimeline(env, session, membership.teamId);
      if (!current) return;
      if (!result.ok) {
        setTimelineError(result.message);
        setTimelineState("error");
        return;
      }
      setTimelineSnapshots(result.value);
      setTimelineError(null);
      setTimelineState("ready");
    };
    void loadTimeline();
    return () => { current = false; };
  }, [blocks, cloud.account.getFreshSession, demoMode, membership, snapshot]);

  const managerMembers = useMemo(
    () => (managerData?.members ?? []).map((member) => (
      buildManagerRosterMember(member, new Date().toISOString())
    )),
    [managerData],
  );
  const sharingMembers = managerMembers.filter((member) => member.syncedAt !== null);
  const attentionCount = managerMembers.filter((member) => member.risk === "attention").length;
  const staleCount = managerMembers.filter((member) => member.risk === "stale").length;
  const capacityMedian = median(
    sharingMembers.flatMap((member) => member.capacity === null ? [] : [member.capacity]),
  );
  const reviewMedian = median(
    sharingMembers.flatMap((member) => reviewCoverage(member) === null ? [] : [reviewCoverage(member)!]),
  );
  const timelinePoints = useMemo<TeamTimelinePoint[]>(() => {
    const identityByUser = new Map(
      (managerData?.members ?? []).map((member) => [member.userId, member] as const),
    );
    const viewerId = demoMode ? "demo-manager" : cloud.account.account?.userId ?? "";
    return timelineSnapshots
      .filter((point) => manager || point.userId === viewerId)
      .map((point) => {
        const identity = identityByUser.get(point.userId);
        const isSelf = point.userId === viewerId;
        return {
          ...point,
          displayName: isSelf
            ? (cloud.account.account?.displayName || cloud.account.account?.email || "You")
            : (identity?.displayName || identity?.email || "Team member"),
          isSelf,
        };
      });
  }, [cloud.account.account, demoMode, manager, managerData, timelineSnapshots]);
  const timelineIdentities = useMemo<TeamTimelineIdentity[]>(() => {
    const viewerId = demoMode ? "demo-manager" : cloud.account.account?.userId ?? "";
    if (!manager) {
      return viewerId ? [{
        userId: viewerId,
        displayName: cloud.account.account?.displayName || cloud.account.account?.email || "You",
        isSelf: true,
      }] : [];
    }
    return (managerData?.members ?? []).map((member) => ({
      userId: member.userId,
      displayName: member.isSelf
        ? (member.displayName || member.email || "You")
        : (member.displayName || member.email || "Team member"),
      isSelf: member.isSelf,
    }));
  }, [cloud.account.account, demoMode, manager, managerData]);
  const timelineAnchorWeek = timelinePoints.reduce(
    (latest, point) => point.weekId > latest ? point.weekId : latest,
    snapshot.week_id,
  );
  const sharedSnapshot = cloud.sync.buildResult.ok ? cloud.sync.buildResult.snapshot : null;
  const buildRejectionMessage = cloud.sync.buildResult.ok
    ? null
    : cloud.sync.buildResult.message;
  const sharingForSelectedTeam = Boolean(
    membership
    && cloud.account.policy.enabled
    && cloud.account.policy.teamId === membership.teamId
    && cloud.account.policy.consentedAt,
  );

  const syncApprovedSnapshot = async () => {
    setSyncStatus("syncing");
    const succeeded = await cloud.sync.syncNow();
    setSyncStatus(succeeded ? "done" : "idle");
  };

  if (!membership) {
    return (
      <section className="screen team-screen">
        <div className="team-screen-empty" role="status">
          <Waypoints size={24} aria-hidden />
          <h1>Team connection needs attention</h1>
          <p>
            Sharing is enabled for a team that is not currently available in your active memberships.
            Refresh Account &amp; Sharing before sending another snapshot.
          </p>
          <button className="primary-action" type="button" onClick={onOpenSharingSettings}>
            Review connection <ArrowRight size={15} aria-hidden />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="screen team-screen" data-team-role={manager ? "manager" : "member"}>
      <header className="team-screen-header">
        <div>
          <span className="eyebrow">{manager ? "Team workload intelligence" : "Your team connection"}</span>
          <h1>{manager ? `${membership.teamName} workload` : `Your place in ${membership.teamName}`}</h1>
          <p>
            {manager
              ? "Coordinate commitments from member-approved summaries without ranking people."
              : "Understand what you contribute, what stays private, and whether your team signal is current."}
          </p>
        </div>
        <div className="team-screen-actions">
          <div className="team-role-indicator">
            {manager ? <Waypoints size={15} aria-hidden /> : <ShieldCheck size={15} aria-hidden />}
            <span>{manager ? "Manager · approved summaries" : "Member · your data only"}</span>
          </div>
          <div className="team-view-toggle" aria-label="Weekform workspace mode">
            <button type="button" onClick={onOpenIndividual}>
              <UserRound size={14} aria-hidden /> Individual
            </button>
            <button className="is-active" type="button" aria-current="page">
              <Waypoints size={14} aria-hidden /> {manager ? "Manager" : "Team"}
            </button>
          </div>
        </div>
      </header>

      {manager ? (
        <>
          <div className="team-evidence-rail" aria-label="Team evidence coverage">
            <div><span>Active roster</span><strong>{loadState === "ready" ? managerMembers.length : "—"}</strong><small>RLS-scoped members</small></div>
            <div><span>Sharing now</span><strong>{loadState === "ready" ? sharingMembers.length : "—"}</strong><small>approved snapshots</small></div>
            <div><span>Coverage</span><strong>{loadState === "ready" && managerMembers.length ? `${Math.round((sharingMembers.length / managerMembers.length) * 100)}%` : "—"}</strong><small>unknown stays unknown</small></div>
            <div><span>Freshness</span><strong>{loadState === "ready" ? formatTimestamp(managerData?.latestSyncedAt ?? null) : "—"}</strong><small>latest team sync</small></div>
          </div>

          {loadState === "loading" ? (
            <div className="team-loading" role="status"><RefreshCw className="team-spin" size={18} aria-hidden /> Loading approved team data…</div>
          ) : loadState === "error" ? (
            <div className="team-error" role="alert"><CircleAlert size={18} aria-hidden /><div><strong>Team data could not be loaded</strong><p>{loadError} No cached or placeholder data is shown.</p></div></div>
          ) : (
            <div className="team-decision-layout">
              <section className="team-decision-card team-decision-card--primary">
                <span className="team-card-kicker">Decision now</span>
                <h2>{attentionCount > 0 ? "Review pressure before accepting more work" : "No fresh signal currently needs escalation"}</h2>
                <p>
                  {attentionCount > 0
                    ? `${attentionCount} fresh approved ${attentionCount === 1 ? "signal crosses" : "signals cross"} the coordination threshold. ${staleCount} stale ${staleCount === 1 ? "snapshot is" : "snapshots are"} excluded.`
                    : `${sharingMembers.length} of ${managerMembers.length} members currently share approved summaries. Missing and stale evidence is never treated as capacity.`}
                </p>
                <div className="team-decision-metrics">
                  <div><span>Median reliable capacity</span><strong>{capacityMedian === null ? "Not shared" : `${Math.round(capacityMedian)}%`}</strong></div>
                  <div><span>Median review coverage</span><strong>{reviewMedian === null ? "Not shared" : `${Math.round(reviewMedian)}%`}</strong></div>
                  <div><span>Needs coordination</span><strong>{attentionCount}</strong></div>
                </div>
                <button className="primary-action" type="button" onClick={onOpenManagerWorkspace}>
                  Open manager workspace <ArrowRight size={15} aria-hidden />
                </button>
              </section>

              <aside className="team-decision-card">
                <span className="team-card-kicker">Trust boundary</span>
                <h2>You are included in the team data</h2>
                <p>
                  The roster includes the signed-in manager. Weekform loads only approved aggregate fields;
                  raw activity, notes, screenshots, and window titles are unavailable.
                </p>
                <div className="team-boundary-list">
                  <span><ShieldCheck size={14} aria-hidden /> Member-controlled sharing</span>
                  <span><CheckCircle2 size={14} aria-hidden /> Medians and ranges, never rankings</span>
                  <span><Clock3 size={14} aria-hidden /> Stale and missing values excluded</span>
                </div>
              </aside>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="team-evidence-rail" aria-label="Your team sharing status">
            <div><span>Membership</span><strong>Active</strong><small>{membership.role}</small></div>
            <div><span>Sharing</span><strong>{sharingForSelectedTeam ? "On" : "Off"}</strong><small>{sharingForSelectedTeam ? cloud.account.policy.shareLevel : "Nothing automatic"}</small></div>
            <div><span>Last sync</span><strong>{formatTimestamp(cloud.account.syncState.lastSuccessAt)}</strong><small>{cloud.sync.upToDate ? "Current" : "Review before sync"}</small></div>
            <div><span>Local evidence</span><strong>{hasWorkBlocks ? snapshot.week_id : "Not ready"}</strong><small>reviewed on this Mac</small></div>
          </div>

          <div className="team-decision-layout">
            <section className="team-decision-card team-decision-card--primary">
              <span className="team-card-kicker">Your coordination signal</span>
              <h2>{sharedSnapshot ? `What ${membership.teamName} can receive` : "Nothing is being sent"}</h2>
              {sharedSnapshot ? (
                <>
                  <p>
                    This is the exact allowlisted snapshot prepared from your reviewed week.
                    Omitted metrics never leave this Mac and are never represented as zero.
                  </p>
                  <div className="team-shared-metrics">
                    {Object.entries(sharedSnapshot.metrics).map(([key, value]) => (
                      <div key={key}><span>{METRIC_LABELS[key] ?? key}</span><strong>{typeof value === "number" ? `${Math.round(value)}${key.endsWith("Pct") ? "%" : ""}` : "Not shared"}</strong></div>
                    ))}
                    <div><span>Review coverage</span><strong>{sharedSnapshot.reviewCoverage.reviewedBlocks}/{sharedSnapshot.reviewCoverage.eligibleBlocks}</strong></div>
                  </div>
                  <div className="team-card-actions">
                    <button className="primary-action" type="button" disabled={cloud.sync.syncBusy} onClick={() => void syncApprovedSnapshot()}>
                      <RefreshCw className={cloud.sync.syncBusy ? "team-spin" : undefined} size={15} aria-hidden />
                      {syncStatus === "done" ? "Snapshot synced" : cloud.sync.upToDate ? "Sync current snapshot" : "Sync approved snapshot"}
                    </button>
                    <button className="secondary-action" type="button" onClick={onOpenSharingSettings}>
                      <Settings2 size={15} aria-hidden /> Change sharing
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>{buildRejectionMessage} Team membership alone never enables sharing.</p>
                  <button className="primary-action" type="button" onClick={onOpenSharingSettings}>
                    Review sharing choices <ArrowRight size={15} aria-hidden />
                  </button>
                </>
              )}
            </section>

            <aside className="team-decision-card">
              <span className="team-card-kicker">What this helps decide</span>
              <h2>Coordination without exposing your workday</h2>
              <p>
                Your approved capacity and load signal can help the team discuss commitments.
                It cannot reveal which apps you used, what you typed, or how you compare with another person.
              </p>
              <div className="team-boundary-list">
                <span><ShieldCheck size={14} aria-hidden /> You choose every shared metric</span>
                <span><CheckCircle2 size={14} aria-hidden /> You appear in your team’s roster</span>
                <span><Clock3 size={14} aria-hidden /> You can stop future sync at any time</span>
              </div>
            </aside>
          </div>
        </>
      )}

      {timelineState === "loading" ? (
        <div className="team-loading team-gantt-loading" role="status"><RefreshCw className="team-spin" size={18} aria-hidden /> Loading workload horizon…</div>
      ) : timelineState === "error" ? (
        <div className="team-error team-gantt-error" role="alert"><CircleAlert size={18} aria-hidden /><div><strong>Workload horizon unavailable</strong><p>{timelineError} No placeholder timeline is shown.</p></div></div>
      ) : (
        <TeamGantt
          anchorWeekId={timelineAnchorWeek}
          evidence={localCalendarEvidence}
          identities={timelineIdentities}
          points={timelinePoints}
          sourceStatus={{
            calendar: calendarConnected ? "connected" : calendarEvents.length > 0 ? "imported" : "not-connected",
            chat: chatConnected ? "connected" : chatEvents.length > 0 ? "imported" : "not-connected",
            email: "unavailable",
          }}
          teamRole={manager ? "manager" : "member"}
        />
      )}
    </section>
  );
}
