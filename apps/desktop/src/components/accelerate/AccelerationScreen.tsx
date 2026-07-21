import { useMemo, useState } from "react";
import {
  Check,
  Circle,
  CircleCheck,
  Copy,
  Library,
  Lightbulb,
  Repeat,
  Rocket,
  RotateCcw,
  Settings,
  Upload,
  Wrench,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AccelerationPlay, AccelerationSignal, AccelerationPlayType } from "../../../../../packages/domain/src/models";
import type { RealizedSavingsEntry, RealizedSavingsSummary } from "../../../../../packages/inference/src/accelerate";
import { MIN_ACCELERATION_MINUTES_SAVED_PER_WEEK } from "../../../../../packages/inference/src/accelerate";
import type { Screen, SettingsTab } from "../../lib/types";
import { accelerationTypeGloss, accelerationTypeLabel, formatAuditTime, formatDurationMinutes } from "../../lib/format";
import { AI_UNAVAILABLE_HINT } from "../../lib/constants";
import type { PushToast } from "../../hooks/useToasts";
import { EmptyState } from "../common/EmptyState";
import { EvidenceDetails } from "../common/EvidenceDetails";
import { InlineError } from "../common/InlineError";
import { AgentMark } from "../common/AgentMark";
import { AccelerationTrackRecord } from "./AccelerationTrackRecord";

const TYPE_ICONS: Record<AccelerationPlayType, LucideIcon> = {
  automate: Workflow,
  tool: Wrench,
  technique: Lightbulb,
};

function PlayCard({
  signal,
  isInLibrary,
  isActedOn,
  onSaveSkill,
  onRemoveSkill,
  onMarkActedOn,
  onUnmarkActedOn,
  onDismiss,
  pushToast,
}: {
  signal: AccelerationPlay;
  isInLibrary: boolean;
  isActedOn: boolean;
  onSaveSkill: (play: AccelerationPlay) => void;
  onRemoveSkill: (signalId: string) => void;
  onMarkActedOn: (signal: AccelerationSignal) => void;
  onUnmarkActedOn: (signalId: string) => void;
  onDismiss: (signal: AccelerationSignal) => void;
  pushToast: PushToast;
}) {
  // Fall back to Lightbulb for an off-enum play type — `<Icon>` with an undefined component
  // throws "Element type is invalid" and (no ErrorBoundary) white-screens the whole app.
  // Mirrors the sibling SkillsLibraryScreen SavedSkillCard guard and the `?? type` graceful
  // degradation the accelerationTypeLabel/Gloss helpers already do for the raw string below.
  const Icon = TYPE_ICONS[signal.type] ?? Lightbulb;
  const savedLabel = `~${formatDurationMinutes(signal.estimated_minutes_saved_per_week)}`;
  const confidencePct = Math.round(signal.confidence * 100);
  const recurrenceWeeks = signal.recurrence_weeks ?? 0;
  const [recipeCopied, setRecipeCopied] = useState(false);

  async function copyRecipe() {
    if (!signal.recipe) return;
    try {
      // Non-optional so a missing clipboard (insecure webview) throws into the catch
      // rather than silently no-op'ing while we falsely announce success.
      await navigator.clipboard.writeText(signal.recipe);
      setRecipeCopied(true);
      window.setTimeout(() => setRecipeCopied(false), 1200);
      pushToast({ tone: "success", message: "Recipe copied to clipboard" });
    } catch {
      pushToast({ tone: "error", message: "Couldn't copy to the clipboard" });
    }
  }

  return (
    <article className="play-card">
      <div className="play-header">
        <div className="play-header-tags">
          <span className={`play-type-chip ${signal.type}`} title={accelerationTypeGloss(signal.type)}>
            <Icon size={13} aria-hidden />
            <span>{accelerationTypeLabel(signal.type)}</span>
            <span className="sr-only">. {accelerationTypeGloss(signal.type)}</span>
          </span>
          {signal.authored && (
            <span
              className="play-ai-badge"
              title="Your configured AI wrote this play's description, recipe, and tool picks. The reclaimable estimate, confidence, and cited evidence stay derived from your observed work."
            >
              <AgentMark size={12} aria-hidden />
              <span>AI-authored</span>
              <span className="sr-only">
                . The description, recipe, and tool picks were written by your configured AI; the
                reclaimable estimate, confidence, and cited evidence stay derived from your observed
                work.
              </span>
            </span>
          )}
          {recurrenceWeeks > 0 && (
            <span
              className="play-recurring-badge"
              title={`This signal has also surfaced in ${recurrenceWeeks} earlier ${recurrenceWeeks === 1 ? "week" : "weeks"} — a persistent pattern, so it's ranked a little higher.`}
            >
              <Repeat size={12} aria-hidden />
              <span>
                Recurring {recurrenceWeeks} {recurrenceWeeks === 1 ? "week" : "weeks"}
              </span>
              <span className="sr-only">
                . This signal has also surfaced in {recurrenceWeeks} earlier{" "}
                {recurrenceWeeks === 1 ? "week" : "weeks"}, a persistent pattern, so it's ranked a
                little higher.
              </span>
            </span>
          )}
        </div>
        <span
          className="play-confidence"
          title="How confident the deterministic miner is in this signal, from the strength and recurrence of the evidence"
        >
          {confidencePct}% confidence
          <span className="sr-only">
            {" "}
            — how confident the deterministic miner is, based on the strength and recurrence of the evidence
          </span>
        </span>
      </div>
      <h3 className="play-title">{signal.title}</h3>
      <p className="play-detail">{signal.detail}</p>
      <div
        className="play-saving"
        title="Estimated time this could reclaim each week — a conservative planning aid, reviewable below, not a guarantee"
      >
        <Zap size={14} aria-hidden className="play-saving-icon" />
        <strong>{savedLabel}</strong>
        <span>est. saved / week</span>
        <span className="sr-only">
          {" "}
          — estimated time this could reclaim each week, a conservative planning aid you can review below, not a guarantee
        </span>
      </div>
      {signal.recommended_tools.length > 0 && (
        <div className="play-tools">
          <span className="play-tools-label">Recommended tools</span>
          <ul className="play-tool-chips">
            {signal.recommended_tools.map((tool) => (
              <li key={tool} className="play-tool-chip">
                {tool}
              </li>
            ))}
          </ul>
        </div>
      )}
      {signal.recipe && (
        <details className="play-recipe">
          <summary>Skill recipe</summary>
          <div className="play-recipe-body">{signal.recipe}</div>
          <div className="play-recipe-actions">
            <button
              type="button"
              className="play-recipe-action"
              title={recipeCopied ? "Copied" : "Copy this recipe to the clipboard"}
              aria-label={
                recipeCopied
                  ? `Recipe copied to clipboard — ${signal.title}`
                  : `Copy this recipe to the clipboard — ${signal.title}`
              }
              onClick={() => void copyRecipe()}
            >
              {recipeCopied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
              <span>{recipeCopied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </details>
      )}
      <EvidenceDetails
        summary="Why this play?"
        evidence={signal.evidence}
        derivedFrom={signal.derived_from}
        emptyText="No evidence recorded for this play."
        className="play-evidence"
      />
      <div className="play-actions">
        {signal.recipe && (
          <button
            type="button"
            className={`play-action play-action-save${isInLibrary ? " is-saved" : ""}`}
            aria-pressed={isInLibrary}
            aria-label={
              isInLibrary
                ? `In library — ${signal.title}. Select again to remove`
                : `Save to library — ${signal.title}`
            }
            title={
              isInLibrary
                ? "Saved to your Skills library — select again to remove"
                : "Save this recipe to your Skills library so it survives regeneration"
            }
            onClick={() => {
              if (isInLibrary) {
                onRemoveSkill(signal.signal_id);
                pushToast({ tone: "info", message: `Removed "${signal.title}" from your Skills library` });
              } else {
                onSaveSkill(signal);
                pushToast({ tone: "success", message: "Saved — find it in your Skills library" });
              }
            }}
          >
            <Library size={14} aria-hidden />
            <span>{isInLibrary ? "In library" : "Save to library"}</span>
          </button>
        )}
        <button
          type="button"
          className={`play-action play-action-acted${isActedOn ? " is-acted" : ""}`}
          aria-pressed={isActedOn}
          aria-label={
            isActedOn
              ? `Acted on — ${signal.title}. Select again to undo`
              : `I acted on this — ${signal.title}`
          }
          title={
            isActedOn
              ? "You marked this play as acted on — select again to undo"
              : "Mark this play as acted on so its impact can be tracked over time"
          }
          onClick={() => (isActedOn ? onUnmarkActedOn(signal.signal_id) : onMarkActedOn(signal))}
        >
          {isActedOn ? <CircleCheck size={14} aria-hidden /> : <Circle size={14} aria-hidden />}
          <span>{isActedOn ? "Acted on" : "I acted on this"}</span>
        </button>
        <button
          type="button"
          className="play-action play-action-dismiss"
          aria-label={`Dismiss — ${signal.title}`}
          title="Dismiss this play — hide it from your acceleration list"
          onClick={() => onDismiss(signal)}
        >
          <X size={14} aria-hidden />
          <span>Dismiss</span>
        </button>
      </div>
    </article>
  );
}

export function AccelerationScreen({
  signals,
  realizedSavings,
  realizedSavingsSummary,
  dismissedPlayIds,
  actedOnPlayIds,
  savedSkillIds,
  onDismissPlay,
  onMarkPlayActedOn,
  onUnmarkPlayActedOn,
  onSaveSkill,
  onRemoveSkill,
  onRestoreDismissedPlays,
  hasWorkBlocks,
  onOpenScreen,
  onOpenSettingsTab,
  generateStatus,
  generateError,
  onGenerateSkills,
  aiConfigured,
  generatedAt,
  hasAuthoredPlays,
  pushToast,
}: {
  signals: AccelerationPlay[];
  realizedSavings: RealizedSavingsEntry[];
  realizedSavingsSummary: RealizedSavingsSummary | null;
  dismissedPlayIds: string[];
  actedOnPlayIds: string[];
  savedSkillIds: string[];
  onDismissPlay: (signal: AccelerationSignal) => void;
  onMarkPlayActedOn: (signal: AccelerationSignal) => void;
  onUnmarkPlayActedOn: (signalId: string) => void;
  onSaveSkill: (play: AccelerationPlay) => void;
  onRemoveSkill: (signalId: string) => void;
  onRestoreDismissedPlays: () => void;
  hasWorkBlocks: boolean;
  onOpenScreen: (screen: Screen) => void;
  onOpenSettingsTab: (tab: SettingsTab) => void;
  generateStatus: "idle" | "generating" | "error";
  generateError: string | null;
  onGenerateSkills: () => void;
  aiConfigured: boolean;
  generatedAt: string | null;
  hasAuthoredPlays: boolean;
  pushToast: PushToast;
}) {
  const dismissed = useMemo(() => new Set(dismissedPlayIds), [dismissedPlayIds]);
  const actedOn = useMemo(() => new Set(actedOnPlayIds), [actedOnPlayIds]);
  const inLibrary = useMemo(() => new Set(savedSkillIds), [savedSkillIds]);
  // Humanize via formatDurationMinutes (as the play cards do at :60) so the gate copy reads "1h/week"
  // for the 60-min floor instead of "60 min/week" — matching the "~1h" every card shows on this screen.
  const minimumSavingsLabel = `${formatDurationMinutes(MIN_ACCELERATION_MINUTES_SAVED_PER_WEEK)}/week`;
  // Hide dismissed plays. Dismiss is keyed by the deterministic `signal_id`, so a hidden
  // play stays hidden as the miner re-derives — until the user restores it.
  const visibleSignals = useMemo(
    () => signals.filter((signal) => !dismissed.has(signal.signal_id)),
    [signals, dismissed]
  );
  // Only counts dismissed ids that still map to a currently-mined play (so "Restore N"
  // reflects what would actually reappear).
  const dismissedCount = signals.length - visibleSignals.length;
  // Total reclaimable minutes across the surfaced plays — the headline "what's the prize" figure.
  const totalSaved = useMemo(
    () => visibleSignals.reduce((sum, signal) => sum + signal.estimated_minutes_saved_per_week, 0),
    [visibleSignals]
  );
  // Name still-mined plays in the realized-savings track record; entries for retired signals fall
  // back to their type label (the persisted history stores no title — id/type/minutes only).
  const titleBySignalId = useMemo(
    () => new Map(signals.map((signal) => [signal.signal_id, signal.title])),
    [signals]
  );

  // No plays mined at all (nothing recurred enough, or no reviewed work yet).
  if (signals.length === 0) {
    return (
      <section className="screen acceleration-screen">
        <div className="screen-header">
          <div>
            <p className="eyebrow">Acceleration</p>
            <h1>No acceleration plays mined yet.</h1>
          </div>
        </div>
        <EmptyState
          icon={Rocket}
          title="Nothing high-impact to accelerate yet."
          description={
            hasWorkBlocks
              ? `The Acceleration engine only surfaces plays estimated to save at least ${minimumSavingsLabel}. Keep reviewing this week's blocks and higher-leverage patterns will appear here automatically.`
              : "The Acceleration engine mines your reviewed work for repetitive workflows, tool-able time-sinks, and context-switch hotspots. Import calendar events or classify active-window sessions first, then revisit this screen."
          }
        >
          <button className="primary-action" type="button" onClick={() => onOpenScreen("setup")}>
            <Upload size={16} aria-hidden />
            <span>Import calendar in Settings</span>
          </button>
          <button className="secondary-action" type="button" onClick={() => onOpenScreen("daily")}>
            <span>Review today</span>
          </button>
        </EmptyState>
        <AccelerationTrackRecord
          entries={realizedSavings}
          summary={realizedSavingsSummary}
          titleBySignalId={titleBySignalId}
        />
      </section>
    );
  }

  // Plays exist but the user dismissed them all — offer a way back rather than implying
  // none were ever found.
  if (visibleSignals.length === 0) {
    return (
      <section className="screen acceleration-screen">
        <div className="screen-header">
          <div>
            <p className="eyebrow">Acceleration</p>
            <h1>All plays dismissed.</h1>
          </div>
        </div>
        <EmptyState
          icon={Rocket}
          title="You've dismissed every play."
          description={`${dismissedCount} acceleration ${dismissedCount === 1 ? "play is" : "plays are"} hidden. Restore them to take another look, or keep reviewing your work for new ones.`}
        >
          <button className="primary-action" type="button" onClick={onRestoreDismissedPlays}>
            <RotateCcw size={16} aria-hidden />
            <span>Restore dismissed plays</span>
          </button>
          <button className="secondary-action" type="button" onClick={() => onOpenScreen("daily")}>
            <span>Review today</span>
          </button>
        </EmptyState>
        <AccelerationTrackRecord
          entries={realizedSavings}
          summary={realizedSavingsSummary}
          titleBySignalId={titleBySignalId}
        />
      </section>
    );
  }

  return (
    <section className="screen acceleration-screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Acceleration</p>
          <h1>Ways to reclaim your week.</h1>
          <p className="screen-subhead">
            Mined locally from your observed work — no AI, no network. {visibleSignals.length}{" "}
            {visibleSignals.length === 1 ? "play" : "plays"}, each citing the evidence it was derived
            from; review before you act.
          </p>
          {dismissedCount > 0 && (
            <button type="button" className="acceleration-restore" onClick={onRestoreDismissedPlays}>
              <RotateCcw size={13} aria-hidden />
              <span>
                Restore {dismissedCount} dismissed {dismissedCount === 1 ? "play" : "plays"}
              </span>
            </button>
          )}
        </div>
        <div className="acceleration-total" title="Combined estimated time the plays below could reclaim each week">
          <Zap size={16} aria-hidden />
          <div>
            <strong>~{formatDurationMinutes(totalSaved)}</strong>
            <small>est. saved / week</small>
          </div>
          <span className="sr-only">
            Combined estimated time the plays below could reclaim each week
          </span>
        </div>
      </div>
      <div className="acceleration-synth">
        <button
          type="button"
          className="primary-action"
          disabled={generateStatus === "generating" || !aiConfigured}
          aria-busy={generateStatus === "generating"}
          onClick={onGenerateSkills}
          title={
            aiConfigured
              ? "Send the derived signals above (app-name flows and counts only — never window titles) to your configured AI to author step-by-step skill recipes and tool picks"
              : AI_UNAVAILABLE_HINT
          }
        >
          <AgentMark size={16} animated={generateStatus === "generating"} aria-hidden />
          <span>
            {generateStatus === "generating"
              ? "Authoring Skills…"
              : hasAuthoredPlays
                ? "Regenerate Skills"
                : "Generate Skills"}
          </span>
        </button>
        {aiConfigured ? (
          <p className="acceleration-synth-note">
            {generatedAt
              ? `AI skills generated ${formatAuditTime(generatedAt)}. Only derived signals are sent — never raw window titles.`
              : "Optional: author runnable skill recipes and tool picks from the plays above. Only derived signals are sent — never raw window titles."}
          </p>
        ) : (
          <div className="acceleration-synth-hint">
            <p>
              Add an AI key in Settings to author runnable skill recipes and tool picks from these
              plays. The plays above are always available without AI.
            </p>
            <button type="button" className="secondary-action" onClick={() => onOpenSettingsTab("ai-assistance")}>
              <Settings size={16} aria-hidden />
              <span>Open Settings</span>
            </button>
          </div>
        )}
      </div>
      {generateError && <InlineError message={generateError} onRetry={aiConfigured ? onGenerateSkills : undefined} />}
      <AccelerationTrackRecord
        entries={realizedSavings}
        summary={realizedSavingsSummary}
        titleBySignalId={titleBySignalId}
      />
      <div className="play-grid">
        <h2 className="sr-only">Acceleration plays</h2>
        {visibleSignals.map((signal) => (
          <PlayCard
            key={signal.signal_id}
            signal={signal}
            isInLibrary={inLibrary.has(signal.signal_id)}
            isActedOn={actedOn.has(signal.signal_id)}
            onSaveSkill={onSaveSkill}
            onRemoveSkill={onRemoveSkill}
            onMarkActedOn={onMarkPlayActedOn}
            onUnmarkActedOn={onUnmarkPlayActedOn}
            onDismiss={onDismissPlay}
            pushToast={pushToast}
          />
        ))}
      </div>
    </section>
  );
}
