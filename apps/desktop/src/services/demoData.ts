import type {
  ActiveWindowSample,
  AuditEvent,
  OutlookCalendarEvent,
  RawEvent,
  ReviewCopilotSuggestion,
  UserCorrection,
  VisualContextInsight,
  WeeklyCapacitySnapshot,
  WorkBlock
} from "../../../../packages/domain/src/models";
import type { PersistedAccelerationSnapshot, PersistedAppState, PersistedSnapshotRecord } from "./localStore";
import { DEFAULT_PROACTIVE_ALERT_SETTINGS, EMPTY_PROACTIVE_ALERT_RUNTIME } from "../lib/proactiveAlerts";
import { humanizeCorrectionValue } from "../lib/format";
import { getLocalDateKey } from "../lib/date";

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function weekStart(reference: Date) {
  const date = new Date(reference);
  date.setDate(date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1));
  date.setHours(9, 0, 0, 0);
  return date;
}

function weekId(reference: Date) {
  const date = new Date(Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function demoSnapshot(week: string, overrides: Partial<WeeklyCapacitySnapshot>): WeeklyCapacitySnapshot {
  return {
    week_id: week,
    allocated_pct: 92,
    deep_work_pct: 38,
    fragmented_work_pct: 18,
    meeting_pct: 22,
    reactive_pct: 20,
    planned_pct: 58,
    blocked_pct: 6,
    recurring_pct: 24,
    reliable_new_work_capacity_pct: 28,
    committed_utilization_pct: 52,
    carryover_risk_pct: 18,
    wip_load_score: 0.52,
    context_switch_score: 0.34,
    fragmentation_penalty_pct: 5,
    wip_penalty_pct: 5,
    summary_confidence: 0.82,
    category_allocation: [],
    work_mode_allocation: [],
    ...overrides
  };
}

function at(start: Date, day: number, minute: number) {
  const date = new Date(start);
  date.setDate(date.getDate() + day);
  return addMinutes(date, minute);
}

function workBlock(
  start: Date,
  id: string,
  day: number,
  minute: number,
  input: Omit<WorkBlock, "work_block_id" | "week_id" | "start_time" | "end_time">
): WorkBlock {
  const blockStart = at(start, day, minute);
  return {
    ...input,
    work_block_id: id,
    week_id: weekId(start),
    start_time: blockStart.toISOString(),
    end_time: addMinutes(blockStart, Math.max(45, input.estimated_capacity_pct * 12)).toISOString()
  };
}

// Metadata-only workplace-chat burst (no message text), shaped exactly like the chat
// importer's output so the interruption-load panel renders in demo mode.
function chatEvent(
  start: Date,
  id: string,
  day: number,
  minute: number,
  durationMinutes: number,
  input: { messages: number; mentions: number; channel?: string; surface: "channel" | "dm" | "thread" }
): RawEvent {
  const begin = at(start, day, minute);
  const received = Math.max(0, input.messages - 1);
  // Mirror the chat parser's privacy rule (SHAREABLE_LABEL_SURFACES = ["channel"]):
  // only a `channel`-surface name is a shared topic label. A dm/thread name is the
  // counterpart's display name (PII), so it never reaches project_hint/channels — the
  // burst falls back to a null label and buckets into "Direct & untagged" downstream,
  // exactly as a real DM export would after the DM-PII fix.
  const shareableLabel = input.surface === "channel" ? input.channel ?? null : null;
  const metadata: Record<string, string> = {
    provider: "slack",
    messages: String(input.messages),
    received: String(received),
    sent: String(input.messages - received),
    mentions: String(input.mentions),
    surfaces: input.surface
  };
  if (shareableLabel) {
    metadata.channels = shareableLabel;
  }
  return {
    event_id: id,
    user_id: "local-user",
    timestamp_start: begin.toISOString(),
    timestamp_end: addMinutes(begin, durationMinutes).toISOString(),
    source_type: "chat",
    app_name: "Slack",
    window_title: null,
    domain: null,
    file_path: null,
    project_hint: shareableLabel,
    metadata,
    privacy_level: "derived_only"
  };
}

function samples(app: string, title: string, start: Date, minutes: number): ActiveWindowSample[] {
  return Array.from({ length: minutes + 1 }, (_, index) => ({
    sample_id: `demo-${app}-${start.getTime()}-${index}`,
    timestamp: addMinutes(start, index).toISOString(),
    app_name: app,
    window_title: title,
    source_type: "macos_active_window",
    privacy_level: "local_only"
  }));
}

function audit(
  type: AuditEvent["type"],
  timestamp: Date,
  title: string,
  summary: string,
  source: string,
  privacy_level: AuditEvent["privacy_level"] = "derived_only"
): AuditEvent {
  return {
    event_id: `demo-${type}-${timestamp.getTime()}`,
    timestamp: timestamp.toISOString(),
    type,
    source,
    title,
    summary,
    privacy_level,
    details: { simulated_demo_data: true, user_review_required: true }
  };
}

export function createDemoState(reference = new Date()): PersistedAppState {
  const monday = weekStart(reference);
  const currentWeek = weekId(reference);
  const now = new Date(reference);
  const importedAt = addMinutes(now, -180);
  const generatedAt = addMinutes(now, -24);
  const common = {
    stakeholder_group: "Analytics",
    blocker_flag: false,
    notes: null
  };
  const blocks: WorkBlock[] = [
    workBlock(monday, "demo-capacity-model", 0, 15, {
      ...common, estimated_capacity_pct: 12, category: "SQL / data modeling / query work", mode: "Deep work",
      planned_status: "planned", project_name: "Capacity model v2", derived_from: ["demo-session-codex"],
      evidence: ["Sustained Codex and Terminal session", "Repository context matched the capacity model"],
      confidence: 0.95, user_verified: true
    }),
    workBlock(monday, "demo-dashboard", 1, 25, {
      ...common, estimated_capacity_pct: 11, category: "Dashboard development / edits", mode: "Deep work",
      planned_status: "planned", project_name: "Capacity model v2", derived_from: ["demo-session-figma"],
      evidence: ["Figma prototype and implementation files were active"], confidence: 0.92, user_verified: true
    }),
    workBlock(monday, "demo-reporting", 2, 0, {
      ...common, estimated_capacity_pct: 12, category: "Recurring reporting", mode: "Deep work",
      planned_status: "fixed", project_name: "Weekly operating metrics", derived_from: ["demo-session-excel"],
      evidence: ["Recurring workbook and SQL export were active"], confidence: 0.97, user_verified: true
    }),
    workBlock(monday, "demo-retention", 2, 180, {
      ...common, estimated_capacity_pct: 5, category: "Ad hoc stakeholder requests", mode: "Reactive",
      planned_status: "unplanned", project_name: "Customer retention deep dive", stakeholder_group: "Customer Success",
      derived_from: ["demo-session-slack"], evidence: ["Slack request preceded a sustained SQL investigation"],
      confidence: 0.86, user_verified: true, notes: "Unplanned request received Wednesday."
    }),
    workBlock(monday, "demo-attribution", 3, 10, {
      ...common, estimated_capacity_pct: 6, category: "Debugging / issue investigation", mode: "Reactive",
      planned_status: "unplanned", project_name: "Revenue attribution mismatch", stakeholder_group: "Data Platform",
      derived_from: ["demo-session-datagrip"], evidence: ["Query and issue-tracker context followed a data alert"],
      confidence: 0.89, user_verified: true
    }),
    workBlock(monday, "calendar-outlook-demo-planning", 0, 245, {
      ...common, estimated_capacity_pct: 8, category: "Meetings / stakeholder syncs", mode: "Collaborative",
      planned_status: "fixed", project_name: "Weekly operating metrics", derived_from: ["demo-calendar-planning"],
      evidence: ["Imported from Outlook calendar", "Six attendee records found"], confidence: 0.98, user_verified: true
    }),
    workBlock(monday, "calendar-outlook-demo-product-review", 1, 285, {
      ...common, estimated_capacity_pct: 8, category: "Meetings / stakeholder syncs", mode: "Collaborative",
      planned_status: "fixed", project_name: "Weekly operating metrics", stakeholder_group: "Product",
      derived_from: ["demo-calendar-product"], evidence: ["Imported from Outlook calendar"], confidence: 0.96,
      user_verified: true
    }),
    workBlock(monday, "demo-requirements", 4, 15, {
      ...common, estimated_capacity_pct: 9, category: "Documentation / requirement clarification", mode: "Fragmented",
      planned_status: "planned", project_name: "Self-service analytics requirements", stakeholder_group: "Business Operations",
      derived_from: ["demo-session-notion"], evidence: ["Notion document and Slack thread crossed two workstreams"],
      confidence: 0.76, user_verified: false, notes: "Needs confirmation."
    }),
    workBlock(monday, "demo-blocker", 4, 130, {
      ...common, estimated_capacity_pct: 8, category: "Blocked / waiting / dependency delay", mode: "Blocked",
      planned_status: "blocked", project_name: "Revenue attribution mismatch", stakeholder_group: "Marketing Analytics",
      derived_from: ["demo-session-jira"], evidence: ["Warehouse permission dependency remained unresolved"],
      confidence: 0.72, user_verified: false, blocker_flag: true, notes: "Waiting for warehouse role approval."
    }),
    // Three recurring, non-deep SQL/data-modeling chores — the manual query cleanup that repeats
    // before every report. They give the deterministic Acceleration miner a recurring, tool-able
    // time-sink to surface (the TOOL play): 6+2+2 pct = 240 non-deep minutes, so the 25% savings
    // estimate meets MIN_ACCELERATION_MINUTES_SAVED_PER_WEEK (60). The reactive block above was
    // trimmed (8→5) to absorb this load, so the curated weekly capacity (24% reliable / 56%
    // committed) holds — both blocks sit in the same reactive committed bucket.
    workBlock(monday, "demo-sql-cleanup-1", 0, 420, {
      ...common, estimated_capacity_pct: 6, category: "SQL / data modeling / query work", mode: "Fragmented",
      planned_status: "unplanned", project_name: "Weekly operating metrics", derived_from: ["demo-session-sql-cleanup-mon"],
      evidence: ["Reformatting and re-running the same metrics queries before the report", "DataGrip and a SQL export were active"],
      confidence: 0.8, user_verified: true, notes: "Recurring manual query cleanup before the weekly report."
    }),
    workBlock(monday, "demo-sql-cleanup-2", 2, 360, {
      ...common, estimated_capacity_pct: 2, category: "SQL / data modeling / query work", mode: "Fragmented",
      planned_status: "unplanned", project_name: "Customer retention deep dive", stakeholder_group: "Customer Success",
      derived_from: ["demo-session-sql-cleanup-wed"], evidence: ["Hand-formatting ad hoc retention queries", "Repeated edits to the same query template"],
      confidence: 0.78, user_verified: true
    }),
    workBlock(monday, "demo-sql-cleanup-3", 3, 420, {
      ...common, estimated_capacity_pct: 2, category: "SQL / data modeling / query work", mode: "Fragmented",
      planned_status: "unplanned", project_name: "Revenue attribution mismatch", stakeholder_group: "Data Platform",
      derived_from: ["demo-session-sql-cleanup-thu"], evidence: ["Rewriting attribution queries by hand to match the report layout"],
      confidence: 0.78, user_verified: true
    })
  ];

  const activeStart = new Date(now);
  activeStart.setHours(Math.max(8, now.getHours() - 3), 5, 0, 0);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(9, 0, 0, 0);

  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  twoDaysAgo.setHours(10, 30, 0, 0);

  const threeDaysAgo = new Date(now);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  threeDaysAgo.setHours(9, 15, 0, 0);

  // Revenue-report rebuild: the user pulls numbers in Hex, refreshes the Looker dashboard, then
  // posts to Teams — the same three-app handoff every reporting day. Unique apps (not used elsewhere)
  // so the deterministic Acceleration miner surfaces exactly one AUTOMATE play. Each instance lands in
  // a free slot on a fixed-hour past day, so it never overlaps the `now`-relative "today" samples
  // (an overlap would interleave samples minute-by-minute and corrupt sessionization).
  const reportRebuild = (day: Date, hour: number): ActiveWindowSample[] => {
    const slot = new Date(day);
    slot.setHours(hour, 0, 0, 0);
    return [
      ...samples("Hex", "Weekly revenue report - query", slot, 38),
      ...samples("Looker", "Revenue dashboard refresh", addMinutes(slot, 42), 27),
      ...samples("Teams", "Finance leadership - report post", addMinutes(slot, 73), 16)
    ];
  };

  // 2pm reactive churn on yesterday: rapid app-hopping between a query, Slack, and Mail, all
  // concentrated in the 14:00 hour — the evidence behind the TECHNIQUE play (a 2pm batching/focus tip).
  const afternoonChurn = (() => {
    const slot = (minute: number) => {
      const date = new Date(yesterday);
      date.setHours(14, minute, 0, 0);
      return date;
    };
    return [
      ...samples("DataGrip", "Attribution hotfix query", slot(0), 4),
      ...samples("Slack", "#data-requests", slot(6), 3),
      ...samples("Mail", "Stakeholder follow-ups", slot(12), 3),
      ...samples("DataGrip", "Attribution hotfix query", slot(18), 4),
      ...samples("Slack", "#exec-dashboard", slot(25), 3),
      ...samples("Mail", "Stakeholder follow-ups", slot(31), 3),
      ...samples("Slack", "#exec-dashboard", slot(37), 3)
    ];
  })();

  const activeWindowSamples = [
    // Today
    ...samples("Codex", "Weekform - capacity model", activeStart, 47),
    ...samples("Figma", "Executive capacity dashboard", addMinutes(activeStart, 58), 31),
    ...samples("Slack", "Customer Success - retention request", addMinutes(activeStart, 99), 18),
    // Yesterday — spread across morning and afternoon for visual depth
    ...samples("DataGrip", "Revenue attribution query", yesterday, 52),
    ...samples("Notion", "Self-service analytics requirements", addMinutes(yesterday, 70), 28),
    // Two days ago
    ...samples("Excel", "Weekly operating metrics workbook", twoDaysAgo, 63),
    ...samples("Slack", "Data Platform - attribution mismatch", addMinutes(twoDaysAgo, 80), 22),
    // Three days ago
    ...samples("Codex", "Capacity model v2", threeDaysAgo, 38),
    ...samples("Figma", "Executive capacity dashboard", addMinutes(threeDaysAgo, 50), 25),
    // Acceleration seeds: a recurring report-rebuild workflow (AUTOMATE) + a 2pm churn (TECHNIQUE).
    ...reportRebuild(threeDaysAgo, 11),
    ...reportRebuild(twoDaysAgo, 13),
    ...reportRebuild(yesterday, 15),
    ...afternoonChurn
  ];

  const calendarEvents: OutlookCalendarEvent[] = [
    ["demo-calendar-planning", "Weekly planning sync", 0, 245, 60, "planning@example.com", 6],
    ["demo-calendar-product", "Product metrics review", 1, 285, 60, "product@example.com", 8],
    // A daily 15-min standup recurring Mon–Fri — the recurring low-value meeting the E5 miner turns
    // into a "make it async" TECHNIQUE Play (a distinct meeting card on ?demo=1&screen=accelerate).
    ["demo-calendar-standup-0", "Daily analytics standup", 0, 0, 15, "standup@example.com", 5],
    ["demo-calendar-standup-1", "Daily analytics standup", 1, 0, 15, "standup@example.com", 5],
    ["demo-calendar-standup-2", "Daily analytics standup", 2, 0, 15, "standup@example.com", 5],
    ["demo-calendar-standup-3", "Daily analytics standup", 3, 0, 15, "standup@example.com", 5],
    ["demo-calendar-standup-4", "Daily analytics standup", 4, 0, 15, "standup@example.com", 5]
  ].map(([id, title, day, minute, duration, organizer, attendeeCount]) => ({
    calendar_event_id: String(id),
    uid: `${id}@example.com`,
    title: String(title),
    start_time: at(monday, Number(day), Number(minute)).toISOString(),
    end_time: at(monday, Number(day), Number(minute) + Number(duration)).toISOString(),
    location: "Zoom",
    organizer: String(organizer),
    attendee_count: Number(attendeeCount),
    source: "outlook_ics",
    imported_at: importedAt.toISOString()
  }));

  // Reactive chat bursts spread across the week. Two overlap the deep-work blocks above
  // (capacity model Monday, dashboard Tuesday) so the interruption panel shows real interleave.
  const chatEvents: RawEvent[] = [
    chatEvent(monday, "demo-chat-1", 0, 60, 18, { messages: 9, mentions: 3, channel: "#data-requests", surface: "channel" }),
    chatEvent(monday, "demo-chat-2", 1, 120, 18, { messages: 7, mentions: 2, channel: "#exec-dashboard", surface: "channel" }),
    // 19:00 (9:00 + 600m) — an after-hours DM so the after-hours reactive-load footnote renders in
    // demo. A DM carries no shareable label (parser drops counterpart names), so this burst buckets
    // into the honest "Direct & untagged" stakeholder group. Same day/volume as before, so peak/calm-
    // day and stakeholder shares are unchanged — only the chip label differs.
    chatEvent(monday, "demo-chat-3", 2, 600, 12, { messages: 5, mentions: 1, surface: "dm" }),
    chatEvent(monday, "demo-chat-4", 3, 40, 15, { messages: 4, mentions: 0, channel: "#team-ops", surface: "channel" })
  ];

  const corrections: UserCorrection[] = [
    {
      correction_id: "demo-correction-1", work_block_id: "demo-retention", field: "planned_status",
      old_value: "planned", new_value: "unplanned", timestamp: addMinutes(now, -68).toISOString(),
      reason: "User confirmed the request interrupted planned work."
    },
    {
      correction_id: "demo-correction-2", work_block_id: "demo-dashboard", field: "project_name",
      old_value: "Dashboard work", new_value: "Capacity model v2",
      timestamp: addMinutes(now, -55).toISOString(), reason: "User applied a more specific label."
    },
    // A repeated planned→unplanned drift (the model keeps over-counting planned work) plus a
    // recurring category mislabel — both surface as "Model bias" notes on the Forecast screen.
    {
      correction_id: "demo-correction-3", work_block_id: "demo-attribution", field: "planned_status",
      old_value: "planned", new_value: "unplanned", timestamp: addMinutes(now, -52).toISOString(),
      reason: "Triggered by a data alert, not on the plan."
    },
    {
      correction_id: "demo-correction-4", work_block_id: "demo-requirements", field: "planned_status",
      old_value: "planned", new_value: "unplanned", timestamp: addMinutes(now, -47).toISOString(),
      reason: "Pulled in mid-week by a stakeholder."
    },
    {
      correction_id: "demo-correction-5", work_block_id: "demo-retention", field: "category",
      old_value: "Planned analysis / project work", new_value: "Ad hoc stakeholder requests",
      timestamp: addMinutes(now, -44).toISOString(), reason: "It was a support request, not project analysis."
    },
    {
      correction_id: "demo-correction-6", work_block_id: "demo-attribution", field: "category",
      old_value: "Planned analysis / project work", new_value: "Ad hoc stakeholder requests",
      timestamp: addMinutes(now, -40).toISOString(), reason: "Reactive investigation off a fresh alert."
    },
    {
      correction_id: "demo-correction-7", work_block_id: "demo-blocker", field: "category",
      old_value: "Planned analysis / project work", new_value: "Ad hoc stakeholder requests",
      timestamp: addMinutes(now, -36).toISOString(), reason: "Unblocking work, not the planned analysis."
    }
  ];

  const reviewSuggestions: ReviewCopilotSuggestion[] = [{
    suggestion_id: "demo-suggestion-1", action: "note", work_block_ids: ["demo-blocker"],
    title: "Keep the dependency visible",
    rationale: "The warehouse permission is a concrete carryover risk for next week.", confidence: 0.91,
    proposed_category: null, proposed_mode: null, proposed_planned_status: null, proposed_project_name: null,
    proposed_stakeholder_group: null, proposed_blocker_flag: true,
    proposed_notes: "Waiting for warehouse role approval; follow up Monday morning."
  }];

  const visualContextInsights: VisualContextInsight[] = [{
    insight_id: "demo-visual-1", captured_at: addMinutes(activeStart, 25).toISOString(), session_id: null,
    app_name: "Codex", window_title: "Weekform - capacity model",
    activity_summary: "Editing capacity logic and reviewing the desktop interface.", visible_tool: "Codex",
    likely_work_category: "SQL / data modeling / query work", likely_mode: "Deep work",
    project_hint: "Capacity model v2", sensitive_content_detected: false, confidence: 0.9,
    evidence: ["Code editor and capacity terminology were visible"], privacy_level: "derived_only",
    model: "OpenAI vision", raw_screenshot_retained: false
  }, {
    insight_id: "demo-visual-2", captured_at: addMinutes(activeStart, 70).toISOString(), session_id: null,
    app_name: "Mail", window_title: "Compensation review - Q3 planning",
    activity_summary: "Reviewing a document that appears to contain personnel and compensation details.", visible_tool: "Mail",
    likely_work_category: "Admin / coordination", likely_mode: "Reactive",
    project_hint: null, sensitive_content_detected: true, confidence: 0.72,
    evidence: ["Document headings referenced confidential HR information"], privacy_level: "derived_only",
    model: "OpenAI vision", raw_screenshot_retained: false
  }];

  const auditEvents = [
    audit("calendar_import", importedAt, "Outlook calendar imported", "2 events parsed from outlook-export.ics", "outlook_ics", "local_only"),
    audit("work_block_classification", addMinutes(now, -94), "Work sessions classified", "10 sessions became explainable work blocks", "openai_classifier"),
    audit("visual_context", addMinutes(now, -82), "Visual context derived", "Capacity model implementation context added", "openai_vision"),
    audit("user_correction", addMinutes(now, -68), "Planned status", `${humanizeCorrectionValue("planned_status", "planned")} → ${humanizeCorrectionValue("planned_status", "unplanned")}`, "review_layer", "local_only"),
    audit("review_copilot", addMinutes(now, -41), "Review suggestions generated", "1 suggestion prepared for approval", "openai_review_copilot"),
    audit("forecast_agent", addMinutes(now, -31), "Capacity forecast generated", "Scenarios project 26% likely capacity around a 24% reliable estimate", "openai_forecast_agent"),
    audit("narrative_generation", generatedAt, "Weekly narrative generated", "Analyst and manager summaries created", "openai_narrative"),
    audit("privacy_resume", addMinutes(now, -10), "Tracking resumed", "Active-window sampling resumed locally", "privacy_control", "local_only")
  ];

  // Three prior completed weeks of retained snapshots so cross-week trends and
  // personal baselines have history to read in demo mode (the live current-week
  // snapshot is computed from the seeded blocks). Each week also varies
  // allocated_pct + deep_work_pct (NOT just reactive/reliable) because the Trends
  // chart plots allocated/reactive/deep-work/reliable — leaving the first two at
  // the base default rendered two of the four flagship lines dead-flat. The story:
  // a calm earlier week (high deep work, high reliable), a busy middle week (load
  // up, deep work + reliable down), then a recovering week.
  const snapshotHistory: PersistedSnapshotRecord[] = [
    { week_id: weekId(addMinutes(now, -30_240)), computed_at: addMinutes(now, -30_240).toISOString(), snapshot: demoSnapshot(weekId(addMinutes(now, -30_240)), { reliable_new_work_capacity_pct: 33, reactive_pct: 16, meeting_pct: 19, context_switch_score: 0.27, allocated_pct: 86, deep_work_pct: 44 }) },
    { week_id: weekId(addMinutes(now, -20_160)), computed_at: addMinutes(now, -20_160).toISOString(), snapshot: demoSnapshot(weekId(addMinutes(now, -20_160)), { reliable_new_work_capacity_pct: 26, reactive_pct: 24, meeting_pct: 25, context_switch_score: 0.42, allocated_pct: 95, deep_work_pct: 31 }) },
    { week_id: weekId(addMinutes(now, -10_080)), computed_at: addMinutes(now, -10_080).toISOString(), snapshot: demoSnapshot(weekId(addMinutes(now, -10_080)), { reliable_new_work_capacity_pct: 29, reactive_pct: 21, meeting_pct: 22, context_switch_score: 0.37, allocated_pct: 90, deep_work_pct: 39 }) }
  ];

  // Prior-week acceleration snapshots so the cross-week recurrence badge (E2) has memory to read in
  // demo AND the realized-savings track record (E3) has a week-over-week trend to score. The three
  // currently-mined demo signals recur a DIFFERENT number of prior weeks so each card shows a
  // distinct recurrence badge: the 2pm context-switch hotspot is the most entrenched habit
  // (3 weeks), the SQL time-sink next (2 weeks), and the Hex→Looker→Teams automation newest
  // (1 week). The per-week `estimated_minutes_saved_per_week` values are ALSO tuned so the two
  // acted-on plays (see `actedOnPlayIds`) produce a rich track record: the SQL time-sink's estimate
  // falls sharply (44 → 24) → its observed load reduction BEATS the conservative projection; the 2pm
  // hotspot drops steeply late (18 → 3) → MET, but barely moved early (21 → 18) → BELOW estimate.
  // Signal_ids match the deterministic miner's output over the seeded demo work; only the derived
  // id/type/minutes summary is stored (privacy-trivial, no window titles).
  const accelerationHistory: PersistedAccelerationSnapshot[] = [
    {
      week_id: weekId(addMinutes(now, -30_240)),
      generated_at: addMinutes(now, -30_240).toISOString(),
      signals: [{ signal_id: "technique-10enw6p", type: "technique", estimated_minutes_saved_per_week: 21 }],
    },
    {
      week_id: weekId(addMinutes(now, -20_160)),
      generated_at: addMinutes(now, -20_160).toISOString(),
      signals: [
        { signal_id: "technique-10enw6p", type: "technique", estimated_minutes_saved_per_week: 18 },
        { signal_id: "tool-1a0pqj3", type: "tool", estimated_minutes_saved_per_week: 44 },
      ],
    },
    {
      week_id: weekId(addMinutes(now, -10_080)),
      generated_at: addMinutes(now, -10_080).toISOString(),
      signals: [
        { signal_id: "technique-10enw6p", type: "technique", estimated_minutes_saved_per_week: 3 },
        { signal_id: "tool-1a0pqj3", type: "tool", estimated_minutes_saved_per_week: 24 },
        { signal_id: "automate-1vwqzqr", type: "automate", estimated_minutes_saved_per_week: 36 },
      ],
    },
  ];

  const managerSummary = "I spent most of this week moving the capacity model and executive dashboard forward while keeping the weekly operating metrics on schedule. I also handled two unplanned investigations that pulled some time away from the analysis I had planned. The main thing holding up the next phase is warehouse access, so clearing that dependency is my immediate priority. If that is resolved, I have room to take on another focused piece of work next week while protecting time for the dashboard and recurring reporting.";

  return {
    version: 1, blocks, calendarEvents, chatEvents, activeWindowSamples, auditEvents, corrections, reviewSuggestions,
    visualContextEnabled: true, visualContextInsights, dismissedPlayIds: [],
    // The 2pm hotspot + SQL time-sink are marked acted-on so the realized-savings track record (E3)
    // has plays to score against `accelerationHistory` above (beat / met / below-estimate rows).
    actedOnPlayIds: ["technique-10enw6p", "tool-1a0pqj3"], generatedPlays: null,
    savedSkills: [
      {
        signal_id: "automate-demo-revenue-report",
        play_type: "automate",
        title: "Automate the weekly revenue-report rebuild",
        detail: "The Hex → Looker → Teams handoff recurs every Monday — a saved skill can regenerate the draft before you sit down.",
        recipe:
          "1. Pull the week's revenue rows from the Hex notebook (query: weekly_revenue_v3).\n2. Refresh the Looker dashboard tiles and export the summary block.\n3. Draft the Teams update: headline number, WoW delta, and the two biggest movers.\n4. Flag anything outside ±10% for a human check before sending.",
        recommended_tools: ["Hex scheduled runs", "Looker API export"],
        estimated_minutes_saved_per_week: 37,
        saved_at: addMinutes(now, -240).toISOString(),
        skill_name: "weekly-revenue-report",
        skill_description:
          "Rebuilds the weekly revenue report from the Hex → Looker → Teams handoff. Use at the start of each week to draft the update before the Monday review.",
      },
    ],
    managerSummaryText: managerSummary,
    generatedForecast: {
      generated_at: addMinutes(now, -31).toISOString(), generated_for_week: weekId(addMinutes(now, 10_080)),
      trigger: "manual", model: "OpenAI forecast agent", prompt_version: "weekform-forecast-agent-v1",
      forecast: {
        forecast_week_label: "Next week", reliable_new_work_capacity_pct: 24, confidence: 0.88,
        headline: "Protect one deep-work block before accepting additional analysis.",
        summary_text: "Recurring commitments and reactive support remain the main constraints. One focused new project is realistic if the access blocker clears.",
        key_constraints: ["36% fixed and recurring load", "Two recent reactive investigations", "One unresolved access dependency"],
        risk_flags: ["Reactive requests may displace dashboard work", "Blocked attribution work could carry over"],
        recommended_actions: ["Reserve two 90-minute focus blocks", "Resolve access before Monday planning", "Batch new ad hoc requests"],
        assumptions: ["Meeting cadence stays stable", "No new production incident", "Access is restored by Tuesday"],
        optimistic_capacity_pct: 34, likely_capacity_pct: 26, conservative_capacity_pct: 14
      }
    },
    forecastHistory: [
      {
        // Targets a snapshot three weeks back (actual 33) — predicted 26, off by 7 → "Close".
        // A SETTLED week so the track record shows all three chips (On target / Close / Off)
        // without leaning on the current, still-accumulating week (which useDerived excludes).
        generated_at: addMinutes(now, -40_320 - 31).toISOString(), generated_for_week: weekId(addMinutes(now, -30_240)),
        trigger: "manual", model: "OpenAI forecast agent", prompt_version: "clear-capacity-forecast-agent-v1",
        forecast: {
          forecast_week_label: "That week", reliable_new_work_capacity_pct: 26, confidence: 0.79,
          headline: "A lighter week if reactive load stays contained.",
          summary_text: "An earlier projection retained so the forecast can be scored against what actually materialized.",
          key_constraints: ["Recurring reporting baseline", "Standing meeting cadence"],
          risk_flags: ["Reactive requests may displace planned analysis"],
          recommended_actions: ["Reserve a focus block", "Batch ad hoc requests"],
          assumptions: ["No new production incident", "Meeting cadence stays stable"],
          optimistic_capacity_pct: 34, likely_capacity_pct: 28, conservative_capacity_pct: 16
        }
      },
      {
        // Targets a snapshot two weeks back (actual 26) — predicted 24, off by 2 → "On target".
        generated_at: addMinutes(now, -30_240 - 31).toISOString(), generated_for_week: weekId(addMinutes(now, -20_160)),
        trigger: "manual", model: "OpenAI forecast agent", prompt_version: "weekform-forecast-agent-v1",
        forecast: {
          forecast_week_label: "That week", reliable_new_work_capacity_pct: 24, confidence: 0.8,
          headline: "Recurring load looks heavy; protect one focus block.",
          summary_text: "An earlier projection retained so the forecast can be scored against what actually materialized.",
          key_constraints: ["Recurring reporting baseline", "Standing meeting cadence"],
          risk_flags: ["Reactive requests may displace planned analysis"],
          recommended_actions: ["Reserve a focus block", "Batch ad hoc requests"],
          assumptions: ["No new production incident", "Meeting cadence stays stable"],
          optimistic_capacity_pct: 30, likely_capacity_pct: 26, conservative_capacity_pct: 13
        }
      },
      {
        // Targets last week's snapshot (actual 29) — predicted 15, off by 14 → "Off".
        generated_at: addMinutes(now, -20_160 - 31).toISOString(), generated_for_week: weekId(addMinutes(now, -10_080)),
        trigger: "manual", model: "OpenAI forecast agent", prompt_version: "weekform-forecast-agent-v1",
        forecast: {
          forecast_week_label: "That week", reliable_new_work_capacity_pct: 15, confidence: 0.82,
          headline: "Two new analyses are realistic if the access blocker clears.",
          summary_text: "An earlier projection retained so the forecast can be scored against what actually materialized.",
          key_constraints: ["Recurring reporting baseline", "One access dependency"],
          risk_flags: ["Blocked attribution work could carry over"],
          recommended_actions: ["Resolve access early", "Reserve two focus blocks"],
          assumptions: ["Access restored by Tuesday", "Meeting cadence stays stable"],
          optimistic_capacity_pct: 23, likely_capacity_pct: 17, conservative_capacity_pct: 9
        }
      },
      {
        generated_at: addMinutes(now, -10_080 - 31).toISOString(), generated_for_week: currentWeek,
        trigger: "manual", model: "OpenAI forecast agent", prompt_version: "weekform-forecast-agent-v1",
        forecast: {
          forecast_week_label: "This week", reliable_new_work_capacity_pct: 31, confidence: 0.84,
          headline: "One new analysis is realistic if reactive load stays contained.",
          summary_text: "Last week's projection for the current week, retained so the forecast can be scored against what actually materialized.",
          key_constraints: ["Recurring reporting baseline", "Standing meeting cadence"],
          risk_flags: ["Reactive requests may displace planned analysis"],
          recommended_actions: ["Reserve two focus blocks", "Batch ad hoc requests"],
          assumptions: ["No new production incident", "Meeting cadence stays stable"],
          optimistic_capacity_pct: 39, likely_capacity_pct: 33, conservative_capacity_pct: 21
        }
      }
    ],
    snapshotHistory,
    accelerationHistory,
    generatedNarrative: {
      generated_at: generatedAt.toISOString(), generated_for_date: now.toISOString().slice(0, 10),
      trigger: "manual", model: "OpenAI narrative", prompt_version: "weekform-weekly-narrative-v4",
      narrative: {
        week_id: currentWeek, headline: "Unplanned investigations narrowed an otherwise productive week.",
        summary_text: "The week was anchored by the capacity model, executive dashboard, and recurring operating metrics. Planned deep work moved forward, but retention and attribution investigations created meaningful reactive load. Fixed meetings and reporting absorbed a substantial portion of the baseline. Two remaining blocks need review before the story is final.",
        key_drivers: ["Capacity model and dashboard work received the strongest focus windows", "Reactive investigations displaced planned analysis", "Fixed reporting and meetings created a durable baseline", "Warehouse access remains the main carryover risk", "Two blocks still need confirmation"],
        manager_ready_summary: managerSummary
      }
    },
    lastNarrativeAutoRunDate: now.toISOString().slice(0, 10),
    paused: false,
    aiConfig: null,
    retentionDays: 30,
    onboardingDismissed: false,
    walkthroughCompleted: true,
    gettingStartedStatus: "complete",
    defaultWindowMode: "large",
    proactiveAlertSettings: DEFAULT_PROACTIVE_ALERT_SETTINGS,
    proactiveAlertRuntime: EMPTY_PROACTIVE_ALERT_RUNTIME,
    // AI-usage showcase: a few exact OpenAI CSV days plus one row carrying an
    // authoritative imported cost. Proxy estimates derive live from the demo sessions.
    tokenUsageDays: [
      {
        date: getLocalDateKey(addMinutes(now, -2_880)),
        source_type: "csv_import", provider: "openai", model: "gpt-5.6-sol", measurement: "exact",
        input_tokens: 48_200, output_tokens: 96_400, cache_read_tokens: 512_000, cache_creation_tokens: 118_000,
        prompt_count: 42, session_minutes: 0, cost_usd: null
      },
      {
        date: getLocalDateKey(addMinutes(now, -1_440)),
        source_type: "csv_import", provider: "openai", model: "gpt-5.6-sol", measurement: "exact",
        input_tokens: 31_500, output_tokens: 64_100, cache_read_tokens: 388_000, cache_creation_tokens: 92_000,
        prompt_count: 28, session_minutes: 0, cost_usd: null
      },
      {
        date: getLocalDateKey(now),
        source_type: "csv_import", provider: "openai", model: "gpt-5.6-sol", measurement: "exact",
        input_tokens: 12_900, output_tokens: 25_300, cache_read_tokens: 141_000, cache_creation_tokens: 36_000,
        prompt_count: 11, session_minutes: 0, cost_usd: null
      },
      {
        date: getLocalDateKey(addMinutes(now, -1_440)),
        source_type: "csv_import", provider: "openai", model: "gpt-4.1", measurement: "exact",
        input_tokens: 210_000, output_tokens: 54_000, cache_read_tokens: 0, cache_creation_tokens: 0,
        prompt_count: 96, session_minutes: 0, cost_usd: 1.87
      }
    ],
    tokenUsageSettings: {
      observed_proxy_enabled: true,
      include_in_manager_summary: false,
      price_map: {}
    },
    usageCsvRowHashes: []
  };
}
