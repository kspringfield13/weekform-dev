export type SourceType =
  | "window"
  | "calendar"
  | "browser"
  | "chat"
  | "task"
  | "git"
  | "manual";

export type PrivacyLevel = "local_only" | "derived_only" | "excluded";

export type WorkCategory =
  | "Planned analysis / project work"
  | "Ad hoc stakeholder requests"
  | "Recurring reporting"
  | "Dashboard development / edits"
  | "SQL / data modeling / query work"
  | "QA / data validation"
  | "Debugging / issue investigation"
  | "Documentation / requirement clarification"
  | "Meetings / stakeholder syncs"
  | "Admin / coordination"
  | "Blocked / waiting / dependency delay";

export type WorkMode = "Deep work" | "Reactive" | "Collaborative" | "Fragmented" | "Blocked";

export type PlannedStatus = "planned" | "unplanned" | "fixed" | "blocked";

export interface RawEvent {
  event_id: string;
  user_id: string;
  timestamp_start: string;
  timestamp_end: string;
  source_type: SourceType;
  app_name: string | null;
  window_title: string | null;
  domain: string | null;
  file_path: string | null;
  project_hint: string | null;
  metadata: Record<string, string | null>;
  privacy_level: PrivacyLevel;
}

export interface ActiveWindowSample {
  sample_id: string;
  timestamp: string;
  app_name: string;
  window_title: string | null;
  source_type: "macos_active_window";
  privacy_level: PrivacyLevel;
}

export interface ActivitySession {
  session_id: string;
  start_time: string;
  end_time: string;
  app_name: string;
  window_title: string | null;
  duration_minutes: number;
  sample_count: number;
  evidence: string[];
}

export type AuditEventType =
  | "active_window_sample"
  | "activity_session"
  | "calendar_import"
  | "chat_import"
  | "user_correction"
  | "narrative_generation"
  | "work_block_classification"
  | "review_copilot"
  | "forecast_agent"
  | "visual_context"
  | "privacy_pause"
  | "privacy_resume"
  | "retention_policy"
  | "visual_context_policy"
  | "data_reset"
  | "data_export"
  | "proactive_alert"
  | "acceleration_engine"
  | "onboarding";

export interface AuditEvent {
  event_id: string;
  timestamp: string;
  type: AuditEventType;
  source: string;
  title: string;
  summary: string;
  privacy_level: PrivacyLevel;
  details: Record<string, unknown>;
}

export interface NormalizedActivity {
  activity_id: string;
  start_time: string;
  end_time: string;
  source_cluster: string[];
  activity_label_candidate: string;
  project_candidate: string | null;
  evidence: string[];
  confidence: number;
}

export interface WorkBlock {
  work_block_id: string;
  week_id: string;
  start_time: string;
  end_time: string;
  estimated_capacity_pct: number;
  category: WorkCategory;
  mode: WorkMode;
  planned_status: PlannedStatus;
  project_name: string;
  stakeholder_group: string;
  derived_from: string[];
  evidence: string[];
  confidence: number;
  user_verified: boolean;
  blocker_flag: boolean;
  notes: string | null;
}

export interface OutlookCalendarEvent {
  calendar_event_id: string;
  uid: string;
  title: string;
  start_time: string;
  end_time: string;
  location: string | null;
  organizer: string | null;
  attendee_count: number;
  /** True for RFC 5545 `VALUE=DATE` all-day events (PTO/OOO/reminders). */
  all_day?: boolean;
  /**
   * Note recorded when a `RRULE` was present but not fully expanded — e.g. a
   * monthly/yearly series where only the first occurrence was imported. Surfaced
   * in the derived work block's evidence for explainability. Absent/null on
   * non-recurring or fully-expanded daily/weekly events.
   */
  recurrence_note?: string | null;
  source: "outlook_ics";
  imported_at: string;
}

export interface UserCorrection {
  correction_id: string;
  work_block_id: string;
  field:
    | "category"
    | "mode"
    | "planned_status"
    | "project_name"
    | "stakeholder_group"
    | "blocker_flag"
    | "notes"
    | "exclude"
    | "verification"
    | "manager_summary"
    | "calendar_import"
    | "start_time"
    | "end_time";
  old_value: string;
  new_value: string;
  timestamp: string;
  reason: string;
}

export type ReviewCopilotAction = "confirm" | "relabel" | "exclude" | "merge" | "split" | "note";

export interface ReviewCopilotSuggestion {
  suggestion_id: string;
  action: ReviewCopilotAction;
  work_block_ids: string[];
  title: string;
  rationale: string;
  confidence: number;
  proposed_category: WorkCategory | null;
  proposed_mode: WorkMode | null;
  proposed_planned_status: PlannedStatus | null;
  proposed_project_name: string | null;
  proposed_stakeholder_group: string | null;
  proposed_blocker_flag: boolean | null;
  proposed_notes: string | null;
}

export interface ForecastAgentResult {
  forecast_week_label: string;
  reliable_new_work_capacity_pct: number;
  confidence: number;
  headline: string;
  summary_text: string;
  key_constraints: string[];
  risk_flags: string[];
  recommended_actions: string[];
  assumptions: string[];
  optimistic_capacity_pct: number;
  likely_capacity_pct: number;
  conservative_capacity_pct: number;
}

export type AccelerationPlayType = "automate" | "tool" | "technique";

/**
 * Output of the deterministic acceleration miner (`packages/inference/src/accelerate.ts`).
 * Derived locally from observed work — app-name sequences, category/duration/time-of-day
 * stats, and counts — with full evidence and a conservative estimate of time it could save.
 * Privacy: `evidence` carries derived signals only (app names, counts, minutes), NEVER raw
 * window titles; `derived_from` lists the source ids (session/work-block ids) it was mined from.
 */
export interface AccelerationSignal {
  signal_id: string;
  type: AccelerationPlayType;
  title: string;
  detail: string;
  evidence: string[];
  estimated_minutes_saved_per_week: number;
  confidence: number;
  derived_from: string[];
  /**
   * Count of prior ISO weeks this same `signal_id` was mined, from persisted acceleration
   * history (E2). Emphasis only — a recurring signal is nudged higher in the ranking and shows
   * a "recurring" badge; the `estimated_minutes_saved_per_week` estimate is left unchanged so it
   * stays deterministic and explainable. Absent (or 0) for a first-seen / one-off signal.
   */
  recurrence_weeks?: number;
}

/**
 * A presentable Acceleration "Play" card. Extends a mined signal with the optional AI-authored
 * payload: a generated skill `recipe` (AUTOMATE), `recommended_tools` (TOOL), and the user's
 * dismissed state. Deterministic-rendered cards leave `recipe` null and `recommended_tools` empty.
 * `authored` is true when an opt-in AI synthesis pass overlaid this play's guidance (its
 * description/recipe/tool picks) — the deterministic estimate, confidence, and evidence stay
 * model-derived either way, so the UI can attribute the AI prose without implying the facts moved.
 */
export interface AccelerationPlay extends AccelerationSignal {
  recipe: string | null;
  recommended_tools: string[];
  /**
   * Agent Skills authoring fields (`SKILL.md` format). When the opt-in AI pass
   * authors an AUTOMATE play it also proposes a hyphenated `skill_name` and a trigger-oriented
   * `skill_description` ("what it does + when to use it"), so a saved recipe can be exported as a
   * runnable Agent Skill. Null for TOOL/TECHNIQUE and for deterministic (unauthored) plays; the
   * exporter derives safe fallbacks from the title/detail when these are absent.
   */
  skill_name: string | null;
  skill_description: string | null;
  authored: boolean;
  dismissed: boolean;
}

/**
 * A user-saved acceleration skill: a durable snapshot of an AUTOMATE Play's AI-authored
 * `recipe` captured into a small library so it survives regeneration and the miner
 * re-deriving (which can retire a signal). Snapshotting the recipe TEXT — not just the
 * `signal_id` — is what makes generated skills reusable beyond the session. Identity is the
 * source `signal_id` (re-saving upserts). Privacy: carries only derived fields (title,
 * detail, recipe, tool names, minutes) — never raw window titles.
 */
export interface SavedSkill {
  signal_id: string;
  play_type: AccelerationPlayType;
  title: string;
  detail: string;
  recipe: string;
  recommended_tools: string[];
  estimated_minutes_saved_per_week: number;
  saved_at: string;
  /**
   * Optional Agent Skills authoring fields snapshotted from the play (`SKILL.md`
   * standard): a hyphenated `skill_name` and a trigger-oriented `skill_description`. Optional so
   * skills saved before this feature (and any without an AI-authored name/description) still
   * parse; the SKILL.md exporter falls back to deriving them from `title`/`detail`.
   */
  skill_name?: string | null;
  skill_description?: string | null;
}

export interface VisualContextInsight {
  insight_id: string;
  captured_at: string;
  session_id: string | null;
  app_name: string;
  window_title: string | null;
  activity_summary: string;
  visible_tool: string | null;
  likely_work_category: WorkCategory | null;
  likely_mode: WorkMode | null;
  project_hint: string | null;
  sensitive_content_detected: boolean;
  confidence: number;
  evidence: string[];
  privacy_level: PrivacyLevel;
  model: string;
  raw_screenshot_retained: boolean;
}

export interface WeeklyCapacitySnapshot {
  week_id: string;
  allocated_pct: number;
  deep_work_pct: number;
  fragmented_work_pct: number;
  meeting_pct: number;
  reactive_pct: number;
  planned_pct: number;
  blocked_pct: number;
  recurring_pct: number;
  reliable_new_work_capacity_pct: number;
  /**
   * Forward-committed load treated as the week's current utilization (recurring commitments,
   * carryover, discounted reactive load, and the fragmentation/WIP drag). The reliable new-work
   * estimate is the headroom that brings total utilization toward the ~80% queueing knee: new
   * work is offered only up to `80 - committed_utilization_pct` (capped at 40%, floored at 0), so
   * no new work is promised once this already exceeds the knee.
   */
  committed_utilization_pct: number;
  carryover_risk_pct: number;
  wip_load_score: number;
  context_switch_score: number;
  /**
   * Concrete percentage-point cost the `context_switch_score` / `wip_load_score` indices
   * contribute to `committed_utilization_pct` (fragmentation = score × 12, WIP = score × 10).
   * Surfaced so the abstract 0–100 index reads as "context-switching is costing ~N% of your
   * committed week" rather than a bare "/100".
   */
  fragmentation_penalty_pct: number;
  wip_penalty_pct: number;
  summary_confidence: number;
  category_allocation: Array<{ label: WorkCategory; value: number }>;
  work_mode_allocation: Array<{ label: WorkMode; value: number }>;
}

export interface WeeklyNarrative {
  week_id: string;
  headline: string;
  summary_text: string;
  key_drivers: string[];
  manager_ready_summary: string;
}

export type AIProvider = "openai" | "grok" | "deepseek" | "custom";

export interface AIConfig {
  provider: AIProvider;
  apiKey: string; // stored locally, not sent to cloud except for the chosen provider
  baseUrl?: string; // for custom or overrides
  model: string;
  visionModel?: string;
  // future: temperature, etc.
}
