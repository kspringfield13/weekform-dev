import { useEffect, useMemo, useReducer, useState, type FormEvent, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileClock,
  Gauge,
  Globe2,
  History,
  LayoutDashboard,
  LogOut,
  Maximize2,
  Minus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Waypoints,
  X,
} from "lucide-react";
import { WeekformMark } from "../components/common/WeekformMark";
import { CapacityDetailModal } from "../components/common/CapacityDetailModal";
import {
  filterManagerMembers,
  buildManagerRosterMember,
  getIndividualWorkspaceUrl,
  getWeekformWebAppUrl,
  managerWorkspaceReducer,
  MAX_MANAGER_COMPARISONS,
  createInitialManagerWorkspaceState,
  toggleManagerComparison,
  type ManagerWorkspaceMode,
  type ManagerWorkspacePage,
  type ManagerRosterFilters,
  type LiveManagerRosterMember,
} from "../services/adminPortal";
import {
  fetchManagerTeamWorkspace,
  getCloudEnv,
  type CloudManagerWorkspaceData,
  type CloudResult,
  type CloudTeamMembership,
} from "../services/cloudClient";
import type { PersistedCloudSession } from "../services/cloudPolicy";
import { buildTeamCapacityDetail } from "../services/capacityDetail";
import "./span-simulator.css";

const NAV_ITEMS = [
  { id: "today" as const, label: "Today", description: "Daily review queue", icon: CalendarCheck },
  { id: "week" as const, label: "Week", description: "Capacity and summary", icon: BarChart3 },
  { id: "agent" as const, label: "Agent", description: "Ask, plan, and understand", icon: Sparkles },
  { id: "history" as const, label: "History", description: "Ledger and audit trail", icon: History },
];

const PAGE_COPY: Record<ManagerWorkspacePage, { individual: [string, string]; manager: [string, string] }> = {
  today: {
    individual: ["Today", "Review your evidence and decide what deserves attention."],
    manager: ["Today across your teams", "Triage shared workload signals without ranking people."],
  },
  week: {
    individual: ["Weekly capacity", "Understand what consumed your week and what reliably fits next."],
    manager: ["Team capacity", "Compare approved signals, coverage, and delivery pressure across the week."],
  },
  agent: {
    individual: ["Weekform Agent", "Ask a grounded question about your own reviewed week."],
    manager: ["Manager briefing", "Review approved team signals before an approval-gated coordination decision."],
  },
  history: {
    individual: ["History", "Inspect your reviewed activity and audit trail."],
    manager: ["Team history", "Review approved sync receipts and open the server audit trail."],
  },
  settings: {
    individual: ["Settings", "Manage your own account, sharing, and local data controls."],
    manager: ["Manager controls", "Manage access, sharing policy, invitations, and administration tools."],
  },
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function MetricCards({ individual = false, members = [] }: { individual?: boolean; members?: LiveManagerRosterMember[] }) {
  if (!members.length && !individual) {
    return <div className="manager-empty"><Search size={20} aria-hidden /><strong>No approved summaries match</strong><span>Adjust the filters to restore the team view. Missing values are never treated as zero.</span></div>;
  }
  const capacityValues = members.flatMap((member) => member.capacity === null ? [] : [member.capacity]);
  const reactiveValues = members.flatMap((member) => member.reactive === null ? [] : [member.reactive]);
  const reviewValues = members.flatMap((member) => member.review === null ? [] : [member.review]);
  const formatMedian = (values: number[]) => values.length ? `${Math.round(median(values))}%` : "Not shared";
  const formatRange = (values: number[]) => values.length
    ? `range ${Math.round(Math.min(...values))}–${Math.round(Math.max(...values))}%`
    : "No approved value";
  const items = individual ? [
    { label: "Reliable capacity", value: "31%", note: "12.4 hours can absorb new work", tone: "positive" },
    { label: "Reactive load", value: "24%", note: "2 pts lower than last week", tone: "neutral" },
    { label: "Protected focus", value: "15.6h", note: "Three uninterrupted blocks", tone: "positive" },
    { label: "Review coverage", value: "96%", note: "2 blocks still need review", tone: "watch" },
  ] : [
    { label: "Median reliable capacity", value: formatMedian(capacityValues), note: `${capacityValues.length} sharing · ${formatRange(capacityValues)}`, tone: "neutral" },
    { label: "Median reactive load", value: formatMedian(reactiveValues), note: `${reactiveValues.length} sharing · ${formatRange(reactiveValues)}`, tone: "watch" },
    { label: "Median review coverage", value: formatMedian(reviewValues), note: `${reviewValues.length} sharing · ${formatRange(reviewValues)}`, tone: "positive" },
    { label: "Needs attention", value: String(members.filter((member) => member.risk === "attention").length), note: "Fresh, member-approved signals", tone: "attention" },
  ];
  return <div className="manager-metric-grid">{items.map((item) => (
    <article className={`manager-metric is-${item.tone}`} key={item.label}>
      <span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small>
    </article>
  ))}</div>;
}

function ModeToggle({ mode, onChange }: { mode: ManagerWorkspaceMode; onChange: (mode: ManagerWorkspaceMode) => void }) {
  return (
    <div className="manager-mode-control" aria-label="Weekform view mode">
      <button aria-pressed={mode === "individual"} onClick={() => onChange("individual")} type="button">
        <UserRound size={13} aria-hidden /> Individual
      </button>
      <button aria-pressed={mode === "manager"} onClick={() => onChange("manager")} type="button">
        <Waypoints size={13} aria-hidden /> Manager mode
      </button>
    </div>
  );
}

function IndividualPage({
  agentAnswer,
  agentPrompt,
  page,
  settingsUrls,
  onAsk,
}: {
  agentAnswer: string | null;
  agentPrompt: string;
  page: ManagerWorkspacePage;
  settingsUrls: Record<"account" | "data-control" | "ai-assistance" | "notifications", string>;
  onAsk: (prompt: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!question.trim()) return;
    onAsk(question);
    setQuestion("");
  };

  if (page === "agent") return (
    <div className="manager-two-column">
      <section className="manager-card manager-agent-card">
        <span className="manager-kicker"><Bot size={13} aria-hidden /> Evidence-aware assistance</span>
        <h2>What can I help you decide?</h2>
        <div className="manager-prompt-list">
          {["What can I reliably commit to next week?", "Why was my focus fragmented?", "Draft my weekly summary."].map((prompt) => (
            <button key={prompt} onClick={() => onAsk(prompt)} type="button">{prompt}<ChevronRight size={15} /></button>
          ))}
        </div>
        <form className="manager-agent-input" onSubmit={submitQuestion}><label className="sr-only" htmlFor="individual-agent-question">Ask Weekform Agent</label><input id="individual-agent-question" onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your reviewed week…" value={question} /><button aria-label="Ask Weekform Agent" disabled={!question.trim()} type="submit"><ArrowRight size={15} /></button></form>
        {agentAnswer && <div className="manager-agent-response" aria-live="polite"><small>{agentPrompt}</small><p>{agentAnswer}</p></div>}
      </section>
      <aside className="manager-card"><span className="manager-kicker">Evidence available</span><h3>Strong grounding</h3><p>34 reviewed blocks · 96% coverage · 4 source types</p><div className="manager-evidence-bars"><span style={{ width: "96%" }} /><span style={{ width: "72%" }} /><span style={{ width: "84%" }} /></div></aside>
    </div>
  );

  if (page === "settings") return (
    <div className="manager-settings-list">
      {[
        ["Account & sharing", "Choose exactly what one team can see. Sharing remains off until you approve it.", settingsUrls.account],
        ["Data control", "Pause capture, set retention, export, or reset local prototype data.", settingsUrls["data-control"]],
        ["AI assistance", "Choose a provider and review when work metadata may leave this device.", settingsUrls["ai-assistance"]],
        ["Notifications", "Control local reminders and proactive capacity alerts.", settingsUrls.notifications],
      ].map(([title, copy, href]) => <section className="manager-settings-row" key={title}><div><h3>{title}</h3><p>{copy}</p></div><a href={href}>Open <ChevronRight size={14} /></a></section>)}
    </div>
  );

  return (
    <>
      <MetricCards individual />
      <div className="manager-two-column">
        <section className="manager-card">
          <div className="manager-card-heading"><div><span className="manager-kicker">{page === "history" ? "Reviewed truth" : "This week"}</span><h2>{page === "history" ? "Recent activity" : "Allocation"}</h2></div><button aria-expanded={detailOpen} onClick={() => setDetailOpen(!detailOpen)} type="button">{detailOpen ? "Hide detail" : "View detail"}</button></div>
          <div className="manager-allocation-list">
            {[ ["Planned delivery", 38], ["Analysis", 27], ["Reactive work", 24], ["Meetings", 11] ].map(([label, value]) => <div key={String(label)}><span>{label}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value}%</strong></div>)}
          </div>
          {detailOpen && <div className="manager-inline-detail"><strong>Allocation evidence</strong><p>34 reviewed blocks across calendar, foreground apps, local imports, and user corrections. Two reactive blocks remain provisional.</p></div>}
        </section>
        <section className="manager-card">
          <span className="manager-kicker">Decision support</span><h2>{page === "today" ? "Two items need review" : "Capacity is stabilizing"}</h2><p>Review the remaining reactive blocks before using this week as your next commitment baseline.</p>
          <button aria-expanded={reviewOpen} className="manager-primary-button" onClick={() => setReviewOpen(!reviewOpen)} type="button">{reviewOpen ? "Close weekly review" : "Open weekly review"} <ArrowRight size={14} /></button>
          {reviewOpen && <div className="manager-review-checklist" aria-live="polite"><span><Check size={13} /> 32 blocks reviewed</span><span><Clock3 size={13} /> 2 reactive blocks pending</span><span><ShieldCheck size={13} /> Sharing remains unchanged</span></div>}
        </section>
      </div>
    </>
  );
}

function ManagerFilters({ filters, members, onChange }: { filters: ManagerRosterFilters; members: LiveManagerRosterMember[]; onChange: (filters: ManagerRosterFilters) => void }) {
  const set = (key: keyof ManagerRosterFilters, value: string) => onChange({ ...filters, [key]: value });
  const teams = [...new Set(members.map((member) => member.team))].sort();
  const levels = [...new Set(members.map((member) => member.category))].sort();
  return (
    <div className="manager-filter-bar" aria-label="Manager filters">
      <label className="manager-search"><Search size={14} aria-hidden /><span className="sr-only">Find a team member</span><input onChange={(event) => set("query", event.target.value)} placeholder="Find a team member…" value={filters.query} /></label>
      <label><span className="sr-only">Team</span><select onChange={(event) => set("team", event.target.value)} value={filters.team}><option value="all">All teams</option>{teams.map((team) => <option key={team}>{team}</option>)}</select></label>
      <label><span className="sr-only">Sharing level</span><select onChange={(event) => set("category", event.target.value)} value={filters.category}><option value="all">All sharing levels</option>{levels.map((level) => <option key={level}>{level}</option>)}</select></label>
      <label><span className="sr-only">Signal</span><select onChange={(event) => set("risk", event.target.value)} value={filters.risk}><option value="all">All signals</option><option value="stable">Stable</option><option value="watch">Watch</option><option value="attention">Needs attention</option><option value="stale">Stale</option><option value="not-sharing">Not sharing</option></select></label>
    </div>
  );
}

function riskLabel(risk: LiveManagerRosterMember["risk"]): string {
  if (risk === "attention") return "Attention";
  if (risk === "not-sharing") return "Not sharing";
  return risk[0]!.toLocaleUpperCase() + risk.slice(1);
}

function metricValue(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function MemberRoster({ members, selectedIds, onToggle }: { members: LiveManagerRosterMember[]; selectedIds: string[]; onToggle: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="manager-card manager-roster-card">
      <button className="manager-roster-heading" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        <span><Users size={16} aria-hidden /><strong>Team members</strong><small>{members.length} matching · signed-in user included · select up to six</small></span><ChevronDown size={16} aria-hidden />
      </button>
      {expanded && <div className="manager-roster-scroll">{members.map((member) => {
        const selected = selectedIds.includes(member.id);
        const capReached = selectedIds.length >= MAX_MANAGER_COMPARISONS && !selected;
        return <button className={`manager-roster-row is-${member.risk}`} key={member.id} onClick={() => onToggle(member.id)} disabled={capReached} aria-pressed={selected} type="button">
          <span className="manager-avatar">{member.initials}</span>
          <span className="manager-member-name"><strong>{member.name}{member.isSelf ? " (You)" : ""}</strong><small>{member.email ? `${member.email} · ` : ""}{member.team} · {member.role} · {member.category}</small></span>
          <span className={`manager-risk-chip is-${member.risk}`}>{riskLabel(member.risk)}</span>
          <span className="manager-member-capacity"><strong>{metricValue(member.capacity)}</strong><small>{member.capacity === null ? "not shared" : "capacity"}</small></span>
          <span className="manager-select-box" aria-hidden>{selected && <Check size={12} />}</span>
        </button>;
      })}</div>}
    </section>
  );
}

function ComparisonRail({ selected, onRemove }: { selected: LiveManagerRosterMember[]; onRemove: (id: string) => void }) {
  return (
    <section className="manager-compare-rail" aria-label={`${selected.length} of ${MAX_MANAGER_COMPARISONS} comparison slots used`}>
      <div className="manager-compare-label"><span>Compare</span><strong>{selected.length}/{MAX_MANAGER_COMPARISONS}</strong></div>
      <div className="manager-compare-slots">{Array.from({ length: MAX_MANAGER_COMPARISONS }, (_, index) => {
        const member = selected[index];
        return member ? <button key={member.id} onClick={() => onRemove(member.id)} type="button" title={`Remove ${member.name}`}><span>{member.initials}</span><small>{member.name.split(" ")[0]}</small><X size={10} aria-hidden /></button> : <span className="manager-empty-slot" key={index}><i>{index + 1}</i><small>Open</small></span>;
      })}</div>
      {selected.length > 0 && <span className="manager-compare-hint">Click a selected IC to remove them</span>}
    </section>
  );
}

function ComparisonTable({ members }: { members: LiveManagerRosterMember[] }) {
  if (!members.length) return <div className="manager-empty"><Users size={20} aria-hidden /><strong>Select ICs to compare</strong><span>Choose up to six from the roster. Unknown or unshared values are never treated as zero.</span></div>;
  return (
    <section className="manager-card manager-comparison-card">
      <div className="manager-card-heading"><div><span className="manager-kicker">Side-by-side</span><h2>Selected IC comparison</h2></div><span>{members.length} contributors</span></div>
      <div className="manager-comparison-scroll"><table><thead><tr><th>Signal</th>{members.map((member) => <th key={member.id}><span className="manager-avatar">{member.initials}</span>{member.name.split(" ")[0]}</th>)}</tr></thead><tbody>
        {[
          ["Reliable capacity", "capacity"], ["Reactive load", "reactive"], ["Fragmented work", "fragmented"], ["Meeting load", "meetings"], ["Review coverage", "review"],
        ].map(([label, key]) => <tr key={label}><th>{label}</th>{members.map((member) => <td key={member.id}>{metricValue(member[key as "capacity" | "reactive" | "fragmented" | "meetings" | "review"])}</td>)}</tr>)}
      </tbody></table></div>
      <p className="manager-boundary-note"><ShieldCheck size={13} aria-hidden /> Only metrics each IC explicitly approved are comparable. This view does not calculate a productivity score or rank people.</p>
    </section>
  );
}

function ManagerWeek({ selectedMembers, scopeMembers }: { selectedMembers: LiveManagerRosterMember[]; scopeMembers: LiveManagerRosterMember[] }) {
  const healthy = scopeMembers.filter((member) => member.risk === "stable").length;
  const watch = scopeMembers.filter((member) => member.risk === "watch").length;
  const attention = scopeMembers.filter((member) => member.risk === "attention").length;
  const unknown = scopeMembers.filter((member) => member.risk === "stale" || member.risk === "not-sharing").length;
  const denominator = Math.max(scopeMembers.length, 1);
  const coverage = ["capacity", "reactive", "fragmented", "meetings", "review"] as const;
  return <><MetricCards members={scopeMembers} /><div className="manager-two-column manager-week-grid"><section className="manager-card"><div className="manager-card-heading"><div><span className="manager-kicker">Current approved state</span><h2>Signal bands</h2></div><span>{scopeMembers.filter((member) => member.syncedAt).length} sharing of {scopeMembers.length}</span></div><div className="manager-band-chart"><div><span>Stable</span><b><i style={{ width: `${healthy / denominator * 100}%` }} /></b><strong>{healthy}</strong></div><div><span>Watch</span><b><i style={{ width: `${watch / denominator * 100}%` }} /></b><strong>{watch}</strong></div><div><span>Needs attention</span><b><i style={{ width: `${attention / denominator * 100}%` }} /></b><strong>{attention}</strong></div><div><span>Stale or unknown</span><b><i style={{ width: `${unknown / denominator * 100}%` }} /></b><strong>{unknown}</strong></div></div></section><section className="manager-card"><span className="manager-kicker">Sharing coverage</span><h2>Metrics members approved</h2><div className="manager-band-chart">{coverage.map((key) => { const shared = scopeMembers.filter((member) => member[key] !== null).length; return <div key={key}><span>{key === "capacity" ? "Reliable capacity" : key[0]!.toLocaleUpperCase() + key.slice(1)}</span><b><i style={{ width: `${shared / denominator * 100}%` }} /></b><strong>{shared}</strong></div>; })}</div><p className="manager-boundary-note"><ShieldCheck size={13} /> Missing values remain unknown and do not enter medians or bands.</p></section></div><ComparisonTable members={selectedMembers} /></>;
}

function ManagerToday({ members, allMembers, selectedIds, onOpenBriefing, onToggle, webAppUrl }: { members: LiveManagerRosterMember[]; allMembers: LiveManagerRosterMember[]; selectedIds: string[]; onOpenBriefing: () => void; onToggle: (id: string) => void; webAppUrl: string }) {
  const attention = allMembers.filter((member) => member.risk === "attention");
  const teams = [...new Map(allMembers.map((member) => [member.teamId, member.team])).entries()];
  return <>{attention.length > 0 ? <div className="manager-alert-strip"><CircleAlert size={16} aria-hidden /><div><strong>{attention.length} fresh {attention.length === 1 ? "signal needs" : "signals need"} coordination</strong><span>{attention.slice(0, 3).map((member) => member.isSelf ? `${member.name} (you)` : member.name).join(", ")} shared approved values that crossed Weekform’s labeled prototype thresholds. Review context before proposing a change.</span></div><button onClick={onOpenBriefing} type="button">Open briefing</button></div> : <div className="manager-alert-strip"><ShieldCheck size={16} aria-hidden /><div><strong>No fresh approved signal currently needs attention</strong><span>Stale, missing, and unshared values remain unknown rather than being counted as headroom.</span></div></div>}<MetricCards members={allMembers} /><div className="manager-roster-layout"><MemberRoster members={allMembers} selectedIds={selectedIds} onToggle={onToggle} /><aside className="manager-card manager-priority-card"><span className="manager-kicker">Team workspaces</span><h2>Coordinate with full context</h2>{teams.map(([teamId, team]) => { const href = new URL(`/teams/${encodeURIComponent(teamId)}`, webAppUrl).toString(); const sharing = allMembers.filter((member) => member.teamId === teamId && member.syncedAt).length; const total = allMembers.filter((member) => member.teamId === teamId).length; return <a key={teamId} href={href} rel="noreferrer" target="_blank"><span><strong>{team}</strong><small>{sharing} of {total} sharing</small></span><em>Open Web</em><ChevronRight size={14} /></a>; })}</aside></div><ComparisonTable members={members} /></>;
}

function ManagerAgent({ members, webAppUrl }: { members: LiveManagerRosterMember[]; webAppUrl: string }) {
  const sharing = members.filter((member) => member.syncedAt);
  const attention = sharing.filter((member) => member.risk === "attention");
  const capacities = sharing.flatMap((member) => member.capacity === null ? [] : [member.capacity]);
  return <div className="manager-agent-layout"><section className="manager-card manager-briefing"><span className="manager-kicker"><Bot size={13} aria-hidden /> Grounded in {sharing.length} approved {sharing.length === 1 ? "snapshot" : "snapshots"}</span><h2>{attention.length ? "Review fresh low-headroom or high-load signals before changing commitments." : "No current approved signal crosses the attention threshold."}</h2><p>{attention.length ? `${attention.length} of ${members.length} team members currently share a fresh attention signal. This is coordination context, not a performance judgment.` : `${sharing.length} of ${members.length} team members have an approved snapshot. Missing and stale values remain excluded.`}</p><div className="manager-evidence-grid"><div><strong>{attention.length}</strong><span>attention signals</span></div><div><strong>{sharing.length}/{members.length}</strong><span>members sharing</span></div><div><strong>{capacities.length ? `${Math.round(median(capacities))}%` : "—"}</strong><span>median capacity</span></div></div><details open><summary>Evidence and uncertainty <ChevronDown size={14} /></summary><p>Only member-approved aggregate snapshot fields are loaded. Raw activity, notes, window titles, screenshots, and unshared values are unavailable.</p></details><div className="manager-briefing-actions"><a className="manager-primary-button" href={webAppUrl} rel="noreferrer" target="_blank">Open authenticated briefing <Globe2 size={14} /></a></div></section><aside className="manager-card"><span className="manager-kicker">Production boundary</span><h3>Approval-gated actions live on Web</h3><p>Open the authenticated team workspace to generate a team briefing, inspect evidence references, and approve a coordination action with its server audit trail.</p><p className="manager-boundary-note"><ShieldCheck size={13} /> This Mac summary is deterministic and contains no generated or placeholder claims.</p></aside></div>;
}

function ManagerHistory({ members, webAppUrl }: { members: LiveManagerRosterMember[]; webAppUrl: string }) {
  const receipts = members.filter((member) => member.syncedAt).sort((left, right) => (right.syncedAt ?? "").localeCompare(left.syncedAt ?? ""));
  return <><div className="manager-history-timeline">{receipts.length ? receipts.map((member) => <article key={member.id}><time>{member.syncedAt ? new Date(member.syncedAt).toLocaleString() : "—"}</time><span className="manager-timeline-dot" /><div><strong>{member.name}{member.isSelf ? " (You)" : ""} synced an approved snapshot</strong><p>{member.team} · week {member.weekId} · {member.category.toLocaleLowerCase()} sharing</p></div><em>Synced</em></article>) : <div className="manager-empty"><FileClock size={20} aria-hidden /><strong>No approved sync receipts yet</strong><span>Team members remain visible in Today even when they have not shared a snapshot.</span></div>}</div><section className="manager-card"><div className="manager-card-heading"><div><span className="manager-kicker">Server audit boundary</span><h2>Team actions and full history</h2></div><a href={webAppUrl} rel="noreferrer" target="_blank">Open Web <Globe2 size={14} /></a></div><p>The desktop surface shows the latest approved snapshot receipt for each member. Team-action history, follow-through, and approval records are loaded in the authenticated Web workspace; no local history is invented here.</p></section></>;
}

function ManagerSettings({ onOpenPreferences, webAppDashboardUrl }: { onOpenPreferences: () => void; webAppDashboardUrl: string }) {
  const cards = [
    { icon: Users, title: "People & access", copy: "Invite ICs, review roles, and manage team membership in the authenticated web app.", action: "Open team dashboard", href: webAppDashboardUrl, external: true },
    { icon: ShieldCheck, title: "Sharing policy", copy: "Narrow what future member-approved snapshots may include from the authenticated team workspace.", action: "Review team policy", href: webAppDashboardUrl, external: true },
    { icon: LayoutDashboard, title: "Workspace appearance", copy: "Set monochrome theme, density, and reduced ambient motion.", action: "Customize" },
  ];
  return <><div className="manager-settings-grid">{cards.map(({ icon: Icon, title, copy, action, href, external }) => <article className="manager-card" key={title}><span className="manager-settings-icon"><Icon size={18} /></span><h2>{title}</h2><p>{copy}</p>{href ? <a href={href} rel={external ? "noreferrer" : undefined} target={external ? "_blank" : undefined}>{action}{external ? <Globe2 size={14} /> : <ArrowRight size={14} />}</a> : <button type="button" onClick={onOpenPreferences}>{action}<ArrowRight size={14} /></button>}</article>)}</div><section className="manager-card manager-access-boundary"><ShieldCheck size={18} /><div><h2>Manager Access boundary</h2><p>Managers see approved summary snapshots only. Raw activity, window titles, notes, screenshots, and unshared fields stay unavailable.</p></div><span>Policy active</span></section></>;
}

export function ManagerAccessWorkspace({
  initialPage = "today",
  managerTeams = [],
  getFreshSession,
  onOpenIndividualWorkspace,
  onOpenPreferences,
  onSignOut,
  webAppDashboardUrl: configuredWebAppDashboardUrl,
}: {
  initialPage?: ManagerWorkspacePage;
  managerTeams?: CloudTeamMembership[];
  getFreshSession?: () => Promise<PersistedCloudSession | null>;
  onOpenIndividualWorkspace?: (page: ManagerWorkspacePage) => void;
  onOpenPreferences: () => void;
  onSignOut: () => void;
  webAppDashboardUrl?: string;
}) {
  const [workspace, dispatch] = useReducer(
    managerWorkspaceReducer,
    initialPage,
    createInitialManagerWorkspaceState,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<ManagerRosterFilters>({ query: "", team: "all", category: "all", risk: "all" });
  const [liveData, setLiveData] = useState<CloudManagerWorkspaceData | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "refreshing" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [capacityDetailOpen, setCapacityDetailOpen] = useState(false);
  const { mode, page } = workspace;
  const members = useMemo(
    () => (liveData?.members ?? []).map((member) => buildManagerRosterMember(member, new Date().toISOString())),
    [liveData],
  );
  const filteredMembers = useMemo(() => filterManagerMembers(members, filters), [filters, members]);
  const selectedMembers = selectedIds.map((id) => members.find((member) => member.id === id)).filter((member): member is LiveManagerRosterMember => Boolean(member));
  const copy = PAGE_COPY[page][mode];
  const toggleMember = (id: string) => setSelectedIds((current) => toggleManagerComparison(current, id));
  const webAppDashboardUrl = configuredWebAppDashboardUrl
    ?? getWeekformWebAppUrl("/manager-access", import.meta.env.VITE_WEEKFORM_WEB_URL);
  const settingsUrls = useMemo(() => ({
    account: getIndividualWorkspaceUrl("account", window.location.origin),
    "data-control": getIndividualWorkspaceUrl("data-control", window.location.origin),
    "ai-assistance": getIndividualWorkspaceUrl("ai-assistance", window.location.origin),
    notifications: getIndividualWorkspaceUrl("notifications", window.location.origin),
  }), []);
  const navigate = (nextPage: ManagerWorkspacePage) => dispatch({ type: "navigate", page: nextPage });
  const askAgent = (prompt: string) => dispatch({ type: "ask-agent", prompt });

  const refreshManagerData = async () => {
    const env = getCloudEnv();
    if (!env || !getFreshSession) {
      setLoadError("Manager Mode is not connected to this build's authenticated team service.");
      setLoadStatus("error");
      return;
    }
    setLoadStatus(liveData ? "refreshing" : "loading");
    const session = await getFreshSession();
    if (!session) {
      setLoadError("Your Weekform session expired. Sign in again before loading team data.");
      setLoadStatus("error");
      return;
    }
    const result: CloudResult<CloudManagerWorkspaceData> = await fetchManagerTeamWorkspace(env, session, managerTeams);
    if (!result.ok) {
      setLoadError(result.message);
      setLoadStatus("error");
      return;
    }
    setLiveData(result.value);
    setLoadError(null);
    setLoadStatus("ready");
  };

  useEffect(() => {
    void refreshManagerData();
    // Team membership changes produce a new array from useCloudAccount and
    // deliberately trigger a fresh RLS-scoped roster read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFreshSession, managerTeams]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => members.some((member) => member.id === id)));
  }, [members]);

  const attentionCount = members.filter((member) => member.risk === "attention").length;
  const sharingCount = members.filter((member) => member.syncedAt).length;
  const capacityValues = members.flatMap((member) => member.capacity === null ? [] : [member.capacity]);
  const teamCapacity = capacityValues.length ? Math.round(median(capacityValues)) : null;
  const capacityDetail = buildTeamCapacityDetail(members);
  const lastSyncedLabel = liveData?.latestSyncedAt
    ? new Date(liveData.latestSyncedAt).toLocaleString()
    : "No approved snapshots yet";

  const startToolbarDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, a")) return;
    void getCurrentWindow().startDragging().catch(() => undefined);
  };

  let content: ReactNode;
  if (mode === "individual") content = <IndividualPage agentAnswer={workspace.agentAnswer} agentPrompt={workspace.agentPrompt} page={page} settingsUrls={settingsUrls} onAsk={askAgent} />;
  else if (loadStatus === "loading") content = <div className="manager-empty" role="status"><RefreshCw className="manager-spin" size={20} aria-hidden /><strong>Loading approved team data</strong><span>Weekform is verifying your manager memberships through Supabase RLS.</span></div>;
  else if (loadStatus === "error") content = <div className="manager-empty" role="alert"><CircleAlert size={20} aria-hidden /><strong>Team data could not be loaded</strong><span>{loadError} No cached or placeholder team data is displayed.</span><button type="button" onClick={() => void refreshManagerData()}>Try again</button></div>;
  else if (members.length === 0) content = <div className="manager-empty"><Users size={20} aria-hidden /><strong>No active team members are visible</strong><span>Your manager roles were verified, but the RLS-scoped roster returned no rows.</span></div>;
  else if (page === "today") content = <ManagerToday members={selectedMembers} allMembers={filteredMembers} selectedIds={selectedIds} onOpenBriefing={() => dispatch({ type: "open-briefing" })} onToggle={toggleMember} webAppUrl={webAppDashboardUrl} />;
  else if (page === "week") content = <ManagerWeek selectedMembers={selectedMembers} scopeMembers={filteredMembers} />;
  else if (page === "agent") content = <ManagerAgent members={filteredMembers} webAppUrl={webAppDashboardUrl} />;
  else if (page === "history") content = <ManagerHistory members={filteredMembers} webAppUrl={webAppDashboardUrl} />;
  else content = <ManagerSettings onOpenPreferences={onOpenPreferences} webAppDashboardUrl={webAppDashboardUrl} />;

  return (
    <div
      className={`manager-access-app${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
      data-workspace-mode={mode}
    >
      <header className="manager-access-toolbar" onPointerDown={startToolbarDrag}>
        <span><Waypoints size={13} aria-hidden /> Team · Manager</span>
        <div><span className="manager-live-badge">Live approved data · {managerTeams.length} {managerTeams.length === 1 ? "team" : "teams"}</span><button aria-label="Refresh team data" disabled={loadStatus === "refreshing"} onClick={() => void refreshManagerData()} title={`Last team sync: ${lastSyncedLabel}`} type="button"><RefreshCw className={loadStatus === "refreshing" ? "manager-spin" : undefined} size={14} /></button><a aria-label="Open Manager Access in the authenticated Weekform web app" className="manager-web-app-link" href={webAppDashboardUrl} rel="noreferrer" target="_blank"><Globe2 size={14} /><span>Web app</span></a><button type="button" onClick={onOpenPreferences} aria-label="Open display preferences"><Settings size={15} /></button><button type="button" onClick={() => void getCurrentWindow().minimize().catch(() => undefined)} aria-label="Minimize window" title="Minimize window"><Minus size={15} /></button><button type="button" onClick={() => void getCurrentWindow().toggleMaximize().catch(() => undefined)} aria-label="Resize window" title="Resize window"><Maximize2 size={14} /></button><button type="button" onClick={onSignOut}><LogOut size={14} /> Sign out</button></div>
      </header>
      <aside className="manager-access-sidebar" aria-label="Manager Access navigation">
        <button className="manager-access-brand" onClick={() => navigate("today")} type="button"><WeekformMark /><span><strong>Weekform</strong><small>Team workspace</small></span></button>
        <nav>{NAV_ITEMS.map(({ id, label, description, icon: Icon }) => <button aria-current={page === id ? "page" : undefined} className={page === id ? "is-active" : ""} key={id} onClick={() => navigate(id)} type="button"><Icon size={18} /><span><strong>{label}</strong><small>{description}</small></span>{id === "today" && attentionCount > 0 && <b>{attentionCount}</b>}</button>)}</nav>
        <button className="manager-sidebar-signal capacity-summary-trigger" type="button" aria-haspopup="dialog" aria-expanded={capacityDetailOpen} onClick={() => setCapacityDetailOpen(true)}><div><span>Reliable capacity</span><Gauge size={14} /></div><span className="manager-sidebar-signal-value"><strong>{teamCapacity === null ? "—" : `${teamCapacity}%`}</strong><small>Team median</small></span><i><b style={{ width: `${teamCapacity ?? 0}%` }} /></i><p><ShieldCheck size={11} /> {sharingCount} of {members.length} sharing approved summaries</p></button>
        <button className={page === "settings" ? "manager-sidebar-settings is-active" : "manager-sidebar-settings"} onClick={() => navigate("settings")} type="button"><Settings size={17} /><span>Settings</span></button>
      </aside>
      <button className="manager-sidebar-collapse" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"} type="button"><ChevronLeft size={14} /></button>
      <main className="manager-access-main">
        <div className="manager-page-shell">
          <header className="manager-page-header"><div><div className="manager-page-context"><span className="manager-kicker">{mode === "manager" ? `Live team data · ${lastSyncedLabel}` : "Personal workspace"}</span>{mode === "manager" && <span className="manager-mode-indicator"><Waypoints size={12} aria-hidden />Manager · approved summaries</span>}</div><h1>{copy[0]}</h1><p>{copy[1]}</p></div><ModeToggle mode={mode} onChange={(nextMode) => {
            if (nextMode === "individual" && onOpenIndividualWorkspace) {
              onOpenIndividualWorkspace(page);
              return;
            }
            dispatch({ type: "set-mode", mode: nextMode });
          }} /></header>
          {mode === "manager" && loadStatus === "ready" && (page === "today" || page === "week") && <><ManagerFilters filters={filters} members={members} onChange={setFilters} /><ComparisonRail selected={selectedMembers} onRemove={toggleMember} /></>}
          <div className="manager-page-content">{content}</div>
        </div>
      </main>
      {capacityDetailOpen && <CapacityDetailModal model={capacityDetail} onClose={() => setCapacityDetailOpen(false)} />}
    </div>
  );
}
