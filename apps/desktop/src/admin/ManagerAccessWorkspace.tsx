import { useMemo, useState, type ReactNode } from "react";
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
  FlaskConical,
  Gauge,
  History,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { WeekformMark } from "../components/common/WeekformMark";
import {
  filterManagerMembers,
  MAX_MANAGER_COMPARISONS,
  toggleManagerComparison,
  type ManagerRosterFilters,
  type ManagerRosterMember,
} from "../services/adminPortal";

type ManagerPage = "today" | "week" | "agent" | "history" | "settings";
type AccessMode = "individual" | "manager";

interface DemoMember extends ManagerRosterMember {
  initials: string;
  capacity: number;
  reactive: number;
  fragmented: number;
  meetings: number;
  review: number;
  trend: number;
  focusHours: number;
}

const MEMBERS: DemoMember[] = [
  { id: "maya", name: "Maya Chen", initials: "MC", team: "Insights", category: "Analysis", risk: "watch", capacity: 24, reactive: 31, fragmented: 22, meetings: 19, review: 94, trend: -4, focusHours: 12.4 },
  { id: "owen", name: "Owen Brooks", initials: "OB", team: "Platform", category: "Delivery", risk: "stable", capacity: 38, reactive: 18, fragmented: 14, meetings: 16, review: 100, trend: 6, focusHours: 17.8 },
  { id: "ines", name: "Ines Duarte", initials: "ID", team: "Insights", category: "Research", risk: "attention", capacity: 12, reactive: 42, fragmented: 37, meetings: 24, review: 88, trend: -11, focusHours: 8.2 },
  { id: "jordan", name: "Jordan Ellis", initials: "JE", team: "Operations", category: "Coordination", risk: "watch", capacity: 21, reactive: 34, fragmented: 28, meetings: 33, review: 97, trend: -3, focusHours: 9.8 },
  { id: "priya", name: "Priya Nair", initials: "PN", team: "Platform", category: "Engineering", risk: "stable", capacity: 41, reactive: 16, fragmented: 11, meetings: 14, review: 92, trend: 8, focusHours: 19.1 },
  { id: "theo", name: "Theo Martin", initials: "TM", team: "Insights", category: "Analysis", risk: "stable", capacity: 35, reactive: 21, fragmented: 18, meetings: 17, review: 95, trend: 3, focusHours: 16.2 },
  { id: "amina", name: "Amina Yusuf", initials: "AY", team: "Operations", category: "Delivery", risk: "attention", capacity: 9, reactive: 48, fragmented: 32, meetings: 29, review: 91, trend: -13, focusHours: 7.4 },
  { id: "leo", name: "Leo Park", initials: "LP", team: "Platform", category: "Engineering", risk: "watch", capacity: 23, reactive: 29, fragmented: 26, meetings: 18, review: 86, trend: -5, focusHours: 11.6 },
  { id: "sofia", name: "Sofia Reyes", initials: "SR", team: "Operations", category: "Coordination", risk: "stable", capacity: 36, reactive: 20, fragmented: 16, meetings: 22, review: 100, trend: 4, focusHours: 14.9 },
  { id: "nolan", name: "Nolan Kim", initials: "NK", team: "Insights", category: "Research", risk: "watch", capacity: 26, reactive: 28, fragmented: 24, meetings: 15, review: 83, trend: -2, focusHours: 13.5 },
  { id: "farah", name: "Farah Ali", initials: "FA", team: "Platform", category: "Delivery", risk: "stable", capacity: 44, reactive: 14, fragmented: 10, meetings: 13, review: 98, trend: 10, focusHours: 20.3 },
  { id: "evan", name: "Evan Grant", initials: "EG", team: "Operations", category: "Analysis", risk: "watch", capacity: 19, reactive: 36, fragmented: 29, meetings: 21, review: 90, trend: -6, focusHours: 10.1 },
];

const NAV_ITEMS = [
  { id: "today" as const, label: "Today", description: "Daily review queue", icon: CalendarCheck },
  { id: "week" as const, label: "Week", description: "Capacity and summary", icon: BarChart3 },
  { id: "agent" as const, label: "Agent", description: "Ask, plan, and understand", icon: Sparkles },
  { id: "history" as const, label: "History", description: "Ledger and audit trail", icon: History },
];

const PAGE_COPY: Record<ManagerPage, { individual: [string, string]; manager: [string, string] }> = {
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
    manager: ["Manager briefing", "Turn approved team signals into an explainable coordination decision."],
  },
  history: {
    individual: ["History", "Inspect your reviewed activity and audit trail."],
    manager: ["Team history", "Follow workload movement and approval-gated manager actions over time."],
  },
  settings: {
    individual: ["Settings", "Manage your own account, sharing, and local data controls."],
    manager: ["Manager controls", "Manage access, sharing policy, invitations, and administration tools."],
  },
};

const METRICS = [
  { label: "Median reliable capacity", value: "27%", note: "12 sharing · range 9–44%", tone: "neutral" },
  { label: "Reactive load", value: "28%", note: "+3 pts from last week", tone: "watch" },
  { label: "Protected focus", value: "13.0h", note: "Median · range 7.4–20.3h", tone: "positive" },
  { label: "Needs attention", value: "2", note: "Fresh, member-approved signals", tone: "attention" },
];

function MetricCards({ individual = false }: { individual?: boolean }) {
  const items = individual ? [
    { label: "Reliable capacity", value: "31%", note: "12.4 hours can absorb new work", tone: "positive" },
    { label: "Reactive load", value: "24%", note: "2 pts lower than last week", tone: "neutral" },
    { label: "Protected focus", value: "15.6h", note: "Three uninterrupted blocks", tone: "positive" },
    { label: "Review coverage", value: "96%", note: "2 blocks still need review", tone: "watch" },
  ] : METRICS;
  return <div className="manager-metric-grid">{items.map((item) => (
    <article className={`manager-metric is-${item.tone}`} key={item.label}>
      <span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small>
    </article>
  ))}</div>;
}

function ModeToggle({ mode, onChange }: { mode: AccessMode; onChange: (mode: AccessMode) => void }) {
  return (
    <div className="manager-mode-control" aria-label="Weekform view mode">
      <button aria-pressed={mode === "individual"} onClick={() => onChange("individual")} type="button">
        <UserRound size={13} aria-hidden /> Individual
      </button>
      <button aria-pressed={mode === "manager"} onClick={() => onChange("manager")} type="button">
        <Users size={13} aria-hidden /> Manager mode
      </button>
    </div>
  );
}

function IndividualPage({ page }: { page: ManagerPage }) {
  if (page === "agent") return (
    <div className="manager-two-column">
      <section className="manager-card manager-agent-card">
        <span className="manager-kicker"><Bot size={13} aria-hidden /> Evidence-aware assistance</span>
        <h2>What can I help you decide?</h2>
        <div className="manager-prompt-list">
          <button type="button">What can I reliably commit to next week?<ChevronRight size={15} /></button>
          <button type="button">Why was my focus fragmented?<ChevronRight size={15} /></button>
          <button type="button">Draft my weekly summary.<ChevronRight size={15} /></button>
        </div>
        <label className="manager-agent-input"><span className="sr-only">Ask Weekform Agent</span><input placeholder="Ask about your reviewed week…" /><button type="button"><ArrowRight size={15} /></button></label>
      </section>
      <aside className="manager-card"><span className="manager-kicker">Evidence available</span><h3>Strong grounding</h3><p>34 reviewed blocks · 96% coverage · 4 source types</p><div className="manager-evidence-bars"><span style={{ width: "96%" }} /><span style={{ width: "72%" }} /><span style={{ width: "84%" }} /></div></aside>
    </div>
  );

  if (page === "settings") return (
    <div className="manager-settings-list">
      {[
        ["Account & sharing", "Choose exactly what one team can see. Sharing remains off until you approve it."],
        ["Data control", "Pause capture, set retention, export, or reset local prototype data."],
        ["AI assistance", "Choose a provider and review when work metadata may leave this device."],
        ["Notifications", "Control local reminders and proactive capacity alerts."],
      ].map(([title, copy]) => <section className="manager-settings-row" key={title}><div><h3>{title}</h3><p>{copy}</p></div><button type="button">Open <ChevronRight size={14} /></button></section>)}
    </div>
  );

  return (
    <>
      <MetricCards individual />
      <div className="manager-two-column">
        <section className="manager-card">
          <div className="manager-card-heading"><div><span className="manager-kicker">{page === "history" ? "Reviewed truth" : "This week"}</span><h2>{page === "history" ? "Recent activity" : "Allocation"}</h2></div><button type="button">View detail</button></div>
          <div className="manager-allocation-list">
            {[ ["Planned delivery", 38], ["Analysis", 27], ["Reactive work", 24], ["Meetings", 11] ].map(([label, value]) => <div key={String(label)}><span>{label}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value}%</strong></div>)}
          </div>
        </section>
        <section className="manager-card">
          <span className="manager-kicker">Decision support</span><h2>{page === "today" ? "Two items need review" : "Capacity is stabilizing"}</h2><p>Review the remaining reactive blocks before using this week as your next commitment baseline.</p>
          <button className="manager-primary-button" type="button">Open weekly review <ArrowRight size={14} /></button>
        </section>
      </div>
    </>
  );
}

function ManagerFilters({ filters, onChange }: { filters: ManagerRosterFilters; onChange: (filters: ManagerRosterFilters) => void }) {
  const set = (key: keyof ManagerRosterFilters, value: string) => onChange({ ...filters, [key]: value });
  return (
    <div className="manager-filter-bar" aria-label="Manager filters">
      <label className="manager-search"><Search size={14} aria-hidden /><span className="sr-only">Find a team member</span><input onChange={(event) => set("query", event.target.value)} placeholder="Find an IC…" value={filters.query} /></label>
      <label><span className="sr-only">Team</span><select onChange={(event) => set("team", event.target.value)} value={filters.team}><option value="all">All teams</option><option>Insights</option><option>Platform</option><option>Operations</option></select></label>
      <label><span className="sr-only">Category</span><select onChange={(event) => set("category", event.target.value)} value={filters.category}><option value="all">All categories</option><option>Analysis</option><option>Research</option><option>Delivery</option><option>Engineering</option><option>Coordination</option></select></label>
      <label><span className="sr-only">Risk</span><select onChange={(event) => set("risk", event.target.value)} value={filters.risk}><option value="all">All signals</option><option value="stable">Stable</option><option value="watch">Watch</option><option value="attention">Needs attention</option></select></label>
    </div>
  );
}

function MemberRoster({ members, selectedIds, onToggle }: { members: DemoMember[]; selectedIds: string[]; onToggle: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="manager-card manager-roster-card">
      <button className="manager-roster-heading" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        <span><Users size={16} aria-hidden /><strong>Individual contributors</strong><small>{members.length} matching · select up to six</small></span><ChevronDown size={16} aria-hidden />
      </button>
      {expanded && <div className="manager-roster-scroll">{members.map((member) => {
        const selected = selectedIds.includes(member.id);
        const capReached = selectedIds.length >= MAX_MANAGER_COMPARISONS && !selected;
        return <button className={`manager-roster-row is-${member.risk}`} key={member.id} onClick={() => onToggle(member.id)} disabled={capReached} aria-pressed={selected} type="button">
          <span className="manager-avatar">{member.initials}</span>
          <span className="manager-member-name"><strong>{member.name}</strong><small>{member.team} · {member.category}</small></span>
          <span className={`manager-risk-chip is-${member.risk}`}>{member.risk === "attention" ? "Attention" : member.risk}</span>
          <span className="manager-member-capacity"><strong>{member.capacity}%</strong><small>capacity</small></span>
          <span className="manager-select-box" aria-hidden>{selected && <Check size={12} />}</span>
        </button>;
      })}</div>}
    </section>
  );
}

function ComparisonRail({ selected, onRemove }: { selected: DemoMember[]; onRemove: (id: string) => void }) {
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

function ComparisonTable({ members }: { members: DemoMember[] }) {
  if (!members.length) return <div className="manager-empty"><Users size={20} aria-hidden /><strong>Select ICs to compare</strong><span>Choose up to six from the roster. Unknown or unshared values are never treated as zero.</span></div>;
  return (
    <section className="manager-card manager-comparison-card">
      <div className="manager-card-heading"><div><span className="manager-kicker">Side-by-side</span><h2>Selected IC comparison</h2></div><span>{members.length} contributors</span></div>
      <div className="manager-comparison-scroll"><table><thead><tr><th>Signal</th>{members.map((member) => <th key={member.id}><span className="manager-avatar">{member.initials}</span>{member.name.split(" ")[0]}</th>)}</tr></thead><tbody>
        {[
          ["Reliable capacity", "capacity", "%"], ["Reactive load", "reactive", "%"], ["Fragmented work", "fragmented", "%"], ["Meeting load", "meetings", "%"], ["Protected focus", "focusHours", "h"], ["Review coverage", "review", "%"],
        ].map(([label, key, suffix]) => <tr key={label}><th>{label}</th>{members.map((member) => <td key={member.id}>{member[key as keyof DemoMember]}{suffix}</td>)}</tr>)}
      </tbody></table></div>
      <p className="manager-boundary-note"><ShieldCheck size={13} aria-hidden /> Only metrics each IC explicitly approved are comparable. This view does not calculate a productivity score or rank people.</p>
    </section>
  );
}

function ManagerWeek({ members }: { members: DemoMember[] }) {
  return <><MetricCards /><div className="manager-two-column manager-week-grid"><section className="manager-card"><div className="manager-card-heading"><div><span className="manager-kicker">Distribution</span><h2>Capacity bands</h2></div><span>12 fresh snapshots</span></div><div className="manager-band-chart"><div><span>Healthy headroom</span><b><i style={{ width: "33%" }} /></b><strong>4</strong></div><div><span>Watch</span><b><i style={{ width: "50%" }} /></b><strong>6</strong></div><div><span>Needs attention</span><b><i style={{ width: "17%" }} /></b><strong>2</strong></div></div></section><section className="manager-card"><span className="manager-kicker">Allocation mix</span><h2>What consumed the team’s week</h2><div className="manager-donut-layout"><div className="manager-donut" aria-label="Allocation: delivery 36%, analysis 27%, coordination 22%, research 15%"><span><strong>12</strong><small>sharing</small></span></div><ul><li><i className="one" />Delivery <b>36%</b></li><li><i className="two" />Analysis <b>27%</b></li><li><i className="three" />Coordination <b>22%</b></li><li><i className="four" />Research <b>15%</b></li></ul></div></section></div><ComparisonTable members={members} /></>;
}

function ManagerToday({ members, allMembers, selectedIds, onToggle }: { members: DemoMember[]; allMembers: DemoMember[]; selectedIds: string[]; onToggle: (id: string) => void }) {
  return <><div className="manager-alert-strip"><CircleAlert size={16} aria-hidden /><div><strong>Two fresh signals need coordination</strong><span>Ines and Amina share low reliable capacity with rising reactive load. Review context before proposing a change.</span></div><button type="button">Open briefing</button></div><MetricCards /><div className="manager-roster-layout"><MemberRoster members={allMembers} selectedIds={selectedIds} onToggle={onToggle} /><aside className="manager-card manager-priority-card"><span className="manager-kicker">Coordination queue</span><h2>Three decisions today</h2>{[["Protect Thursday focus block", "Insights", "High leverage"], ["Re-sequence launch support", "Operations", "Needs owner"], ["Review Platform intake", "Platform", "By 3 PM"]].map(([title, team, note]) => <button key={title} type="button"><span><strong>{title}</strong><small>{team}</small></span><em>{note}</em><ChevronRight size={14} /></button>)}</aside></div><ComparisonTable members={members} /></>;
}

function ManagerAgent() {
  return <div className="manager-agent-layout"><section className="manager-card manager-briefing"><span className="manager-kicker"><Bot size={13} aria-hidden /> Grounded in 12 approved snapshots</span><h2>Protect focus before accepting the new reporting request.</h2><p>Two contributors show fresh low-headroom signals, while Insights has the widest reactive-load spread. The team median still supports a small commitment if Thursday focus blocks remain protected.</p><div className="manager-evidence-grid"><div><strong>2</strong><span>low-headroom signals</span></div><div><strong>+6 pts</strong><span>Insights reactive spread</span></div><div><strong>27%</strong><span>team median capacity</span></div></div><details open><summary>Evidence and uncertainty <ChevronDown size={14} /></summary><p>Based on member-approved weekly summaries from 12 of 14 ICs. Two non-sharing members are excluded; their values remain unknown.</p></details><div className="manager-briefing-actions"><button className="manager-primary-button" type="button">Propose coordination action</button><button type="button">Ask a follow-up</button></div></section><aside className="manager-card"><span className="manager-kicker">Suggested questions</span><div className="manager-prompt-list"><button type="button">What can this team absorb next week?<ChevronRight size={14} /></button><button type="button">Where is reactive load rising?<ChevronRight size={14} /></button><button type="button">Compare the selected ICs.<ChevronRight size={14} /></button><button type="button">Draft a team summary.<ChevronRight size={14} /></button></div><p className="manager-boundary-note"><ShieldCheck size={13} /> Agent output is guidance, not observed fact. Actions remain approval-gated.</p></aside></div>;
}

function ManagerHistory() {
  return <><div className="manager-history-timeline">{[
    ["Today · 10:42", "Manager action proposed", "Protect Thursday focus block", "Awaiting approval"],
    ["Today · 09:15", "Team snapshots refreshed", "12 of 14 members sharing", "Completed"],
    ["Friday · 16:30", "Weekly review closed", "Median capacity rose 3 points", "Observed"],
    ["Thursday · 14:05", "Share policy updated", "Projects narrowed to categories", "Audited"],
  ].map(([time, title, detail, status]) => <article key={time}><time>{time}</time><span className="manager-timeline-dot" /><div><strong>{title}</strong><p>{detail}</p></div><em>{status}</em></article>)}</div><section className="manager-card"><div className="manager-card-heading"><div><span className="manager-kicker">What changed after</span><h2>Coordination follow-through</h2></div><select aria-label="History period"><option>Last 4 weeks</option><option>Last 12 weeks</option></select></div><div className="manager-followthrough"><div><strong>Protect Insights focus window</strong><span>Reliable capacity median</span><b>+5 pts</b><small>Correlation across 3 later weeks</small></div><div><strong>Rotate launch support</strong><span>Reactive load median</span><b>−4 pts</b><small>Correlation across 2 later weeks</small></div></div><p className="manager-boundary-note">These are correlations after recorded actions, never claims that the action caused the change.</p></section></>;
}

function ManagerSettings({ onOpenPreferences }: { onOpenPreferences: () => void }) {
  const cards = [
    { icon: Users, title: "People & access", copy: "Invite ICs, review roles, and manage team membership.", action: "Manage members" },
    { icon: ShieldCheck, title: "Sharing policy", copy: "Narrow what future member-approved snapshots may include.", action: "Review policy" },
    { icon: FlaskConical, title: "Span Simulator", copy: "Generate and audit isolated synthetic spans for product testing.", action: "Open simulator", href: "/admin/span-simulator" },
    { icon: LayoutDashboard, title: "Workspace appearance", copy: "Set theme, accent, density, and reduced ambient motion.", action: "Customize" },
  ];
  return <><div className="manager-settings-grid">{cards.map(({ icon: Icon, title, copy, action, href }) => <article className="manager-card" key={title}><span className="manager-settings-icon"><Icon size={18} /></span><h2>{title}</h2><p>{copy}</p>{href ? <a href={href}>{action}<ArrowRight size={14} /></a> : <button type="button" onClick={title === "Workspace appearance" ? onOpenPreferences : undefined}>{action}<ArrowRight size={14} /></button>}</article>)}</div><section className="manager-card manager-access-boundary"><ShieldCheck size={18} /><div><h2>Manager Access boundary</h2><p>Managers see approved summary snapshots only. Raw activity, window titles, notes, screenshots, and unshared fields stay unavailable.</p></div><span>Policy active</span></section></>;
}

export function ManagerAccessWorkspace({ onOpenPreferences, onSignOut }: { onOpenPreferences: () => void; onSignOut: () => void }) {
  const [page, setPage] = useState<ManagerPage>("today");
  const [mode, setMode] = useState<AccessMode>("manager");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(["maya", "ines"]);
  const [filters, setFilters] = useState<ManagerRosterFilters>({ query: "", team: "all", category: "all", risk: "all" });
  const filteredMembers = useMemo(() => filterManagerMembers(MEMBERS, filters), [filters]);
  const selectedMembers = selectedIds.map((id) => MEMBERS.find((member) => member.id === id)).filter((member): member is DemoMember => Boolean(member));
  const copy = PAGE_COPY[page][mode];
  const toggleMember = (id: string) => setSelectedIds((current) => toggleManagerComparison(current, id));

  let content: ReactNode;
  if (mode === "individual") content = <IndividualPage page={page} />;
  else if (page === "today") content = <ManagerToday members={selectedMembers} allMembers={filteredMembers} selectedIds={selectedIds} onToggle={toggleMember} />;
  else if (page === "week") content = <ManagerWeek members={selectedMembers} />;
  else if (page === "agent") content = <ManagerAgent />;
  else if (page === "history") content = <ManagerHistory />;
  else content = <ManagerSettings onOpenPreferences={onOpenPreferences} />;

  return (
    <div className={`manager-access-app${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
      <header className="manager-access-toolbar">
        <span><i aria-hidden /> Manager Access</span>
        <div><span className="manager-synthetic-badge">Synthetic demo</span><button type="button" onClick={onOpenPreferences} aria-label="Open display preferences"><Settings size={15} /></button><button type="button" onClick={onSignOut}><LogOut size={14} /> Sign out</button></div>
      </header>
      <aside className="manager-access-sidebar" aria-label="Manager Access navigation">
        <button className="manager-access-brand" onClick={() => setPage("today")} type="button"><WeekformMark /><span><strong>Weekform</strong><small>Manager Access</small></span></button>
        <nav>{NAV_ITEMS.map(({ id, label, description, icon: Icon }) => <button aria-current={page === id ? "page" : undefined} className={page === id ? "is-active" : ""} key={id} onClick={() => setPage(id)} type="button"><Icon size={18} /><span><strong>{label}</strong><small>{description}</small></span>{id === "today" && <b>2</b>}</button>)}</nav>
        <div className="manager-sidebar-signal"><div><span>Team headroom</span><Gauge size={14} /></div><strong>27%</strong><small>12 of 14 sharing</small><i><b style={{ width: "27%" }} /></i><p><ShieldCheck size={11} /> Approved summaries only</p></div>
        <button className={page === "settings" ? "manager-sidebar-settings is-active" : "manager-sidebar-settings"} onClick={() => setPage("settings")} type="button"><Settings size={17} /><span>Settings</span></button>
      </aside>
      <button className="manager-sidebar-collapse" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"} type="button"><ChevronLeft size={14} /></button>
      <main className="manager-access-main">
        <div className="manager-page-shell">
          <header className="manager-page-header"><div><span className="manager-kicker">{mode === "manager" ? "Manager view · approved team signals" : "Individual contributor view"}</span><h1>{copy[0]}</h1><p>{copy[1]}</p></div><ModeToggle mode={mode} onChange={setMode} /></header>
          {mode === "manager" && page !== "settings" && <><ManagerFilters filters={filters} onChange={setFilters} /><ComparisonRail selected={selectedMembers} onRemove={toggleMember} /></>}
          <div className="manager-page-content">{content}</div>
        </div>
      </main>
    </div>
  );
}
