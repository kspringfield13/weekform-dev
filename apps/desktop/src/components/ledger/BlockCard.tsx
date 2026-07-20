import { useState } from "react";
import { Check, Clock, GraduationCap, ShieldCheck, X } from "lucide-react";
import type { WorkBlock, WorkCategory, PlannedStatus, WorkMode } from "../../../../../packages/domain/src/models";
import { workCategories, plannedStatuses, workModes } from "../../../../../packages/domain/src/taxonomy";
import { applyLocalTime, fieldLabel, formatRange, humanizeCorrectionValue, pct, plannedStatusLabel, toLocalTimeInput } from "../../lib/format";
import { blockOrigin } from "../../lib/blockOrigin";
import type { LearnedLabelMatch } from "../../lib/learnedLabels";
import { ConfidenceChip } from "../common/ConfidenceChip";
import { EvidenceDetails } from "../common/EvidenceDetails";

export function BlockCard({
  block,
  onConfirm,
  onExclude,
  onRelabel,
  learnedLabels = [],
  revealIndex
}: {
  block: WorkBlock;
  onConfirm: (blockId: string) => void;
  onExclude: (blockId: string) => void;
  onRelabel: (blockId: string, field: keyof WorkBlock, value: WorkBlock[keyof WorkBlock]) => void;
  learnedLabels?: LearnedLabelMatch[];
  revealIndex?: number;
}) {
  const [editingTime, setEditingTime] = useState(false);
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [timeError, setTimeError] = useState(false);
  const origin = blockOrigin(block);

  function handleStartTimeEdit() {
    setDraftStart(toLocalTimeInput(block.start_time));
    setDraftEnd(toLocalTimeInput(block.end_time));
    setTimeError(false);
    setEditingTime(true);
  }

  function handleSaveTime() {
    if (!draftStart || !draftEnd) {
      setTimeError(true);
      return;
    }
    const [sh, sm] = draftStart.split(":").map(Number);
    const [eh, em] = draftEnd.split(":").map(Number);
    if (eh * 60 + em <= sh * 60 + sm) {
      setTimeError(true);
      return;
    }
    // Anchor BOTH new timestamps to the START's calendar date. Passing block.end_time
    // for the end kept the end timestamp's ORIGINAL date, so editing a block that crosses
    // midnight (end on the next day) preserved that later date and ballooned the span by
    // ~24h — a 40-min overnight block edited to 2–3pm became a 25-hour, multi-day block.
    // The clock-of-day guard above already ensures end > start within that single day, so
    // anchoring the end to the start's date always yields a valid same-day span. Byte-
    // identical for a same-day block (start_time and end_time already share a date); it
    // changes only the cross-midnight case, replacing the corrupt multi-day result.
    onRelabel(block.work_block_id, "start_time", applyLocalTime(block.start_time, draftStart));
    onRelabel(block.work_block_id, "end_time", applyLocalTime(block.start_time, draftEnd));
    setEditingTime(false);
  }

  return (
    <article
      className={`${block.user_verified ? "block-card verified" : "block-card"}${revealIndex === undefined ? "" : " is-newly-classified"}`}
    >
      <div className="block-topline">
        <div className="block-time">
          {editingTime ? (
            <div
              className={`time-range-editor${timeError ? " time-range-editor--error" : ""}`}
              aria-label="Time range editor"
              onKeyDown={(e) => { if (e.key === "Escape") setEditingTime(false); }}
            >
              <input
                type="time"
                value={draftStart}
                aria-label="Start time"
                aria-invalid={timeError}
                autoFocus
                onChange={(e) => { setDraftStart(e.target.value); setTimeError(false); }}
              />
              <span aria-hidden="true">–</span>
              <input
                type="time"
                value={draftEnd}
                aria-label="End time"
                aria-invalid={timeError}
                onChange={(e) => { setDraftEnd(e.target.value); setTimeError(false); }}
              />
              <button
                type="button"
                className="time-edit-btn"
                title={timeError ? "End must be after start" : "Save time"}
                aria-label={`Save time changes — ${block.project_name}`}
                onClick={handleSaveTime}
              >
                <Check size={13} aria-hidden />
              </button>
              <button
                type="button"
                className="time-edit-btn"
                title="Cancel"
                aria-label={`Cancel time edit — ${block.project_name}`}
                onClick={() => setEditingTime(false)}
              >
                <X size={13} aria-hidden />
              </button>
              {timeError && (
                <span role="alert" className="sr-only">End time must be after start time</span>
              )}
            </div>
          ) : (
            <>
              <span>{formatRange(block)}</span>
              <button
                type="button"
                className="time-edit-btn"
                title="Edit time range"
                aria-label={`Edit block time range — ${block.project_name}`}
                onClick={handleStartTimeEdit}
              >
                <Clock size={12} aria-hidden />
              </button>
            </>
          )}
        </div>
        <div className="block-chips">
          {block.user_verified && (
            <span className="verified-chip" title="You verified this block">
              <ShieldCheck size={12} aria-hidden />
              <span>Verified</span>
            </span>
          )}
          <span className="block-origin" title={origin.title}>{origin.label}</span>
          {block.blocker_flag && (
            <span className="blocker-badge" title="Flagged as a blocker — this work is stalled waiting on someone or something">
              Blocker
            </span>
          )}
          <ConfidenceChip value={block.confidence} />
        </div>
      </div>
      {learnedLabels.length > 0 && (
        <div
          className="block-learned-note"
          title={`Pre-applied from labels you repeatedly correct: ${learnedLabels
            .map((match) => `${fieldLabel(match.field)} → ${humanizeCorrectionValue(match.field, match.to_value)}`)
            .join(", ")}`}
        >
          <GraduationCap size={13} aria-hidden />
          <span>Learned from your edits</span>
        </div>
      )}
      <div className="block-main">
        <div>
          <h3 title={block.project_name}>{block.project_name}</h3>
          <p title={block.stakeholder_group}>{block.stakeholder_group}</p>
        </div>
        <div className="block-capacity" title="Share of a standard week's modeled capacity this block accounts for">
          <strong>{pct(block.estimated_capacity_pct)}</strong>
          <span className="capacity-caption">of week</span>
          <span className="sr-only">Share of a standard week's modeled capacity this block accounts for</span>
        </div>
      </div>
      <div className="tag-grid">
        <label className="tag-field">
          <span className="tag-field-label">Work category</span>
          <select aria-label={`Work category — ${block.project_name}`} title={block.category} value={block.category} onChange={(event) => onRelabel(block.work_block_id, "category", event.target.value as WorkCategory)}>
            {workCategories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="tag-field">
          <span className="tag-field-label">Planned status</span>
          <select aria-label={`Planned status — ${block.project_name}`} title={plannedStatusLabel(block.planned_status)} value={block.planned_status} onChange={(event) => onRelabel(block.work_block_id, "planned_status", event.target.value as PlannedStatus)}>
            {plannedStatuses.map((status) => (
              <option key={status} value={status}>{plannedStatusLabel(status)}</option>
            ))}
          </select>
        </label>
        <label className="tag-field">
          <span className="tag-field-label">Work mode</span>
          <select aria-label={`Work mode — ${block.project_name}`} title={block.mode} value={block.mode} onChange={(event) => onRelabel(block.work_block_id, "mode", event.target.value as WorkMode)}>
            {workModes.map((mode) => (
              <option key={mode}>{mode}</option>
            ))}
          </select>
        </label>
      </div>
      <EvidenceDetails
        summary="Why this estimate?"
        evidence={block.evidence}
        derivedFrom={block.derived_from}
        emptyText="No inference detail recorded for this block."
      />
      <div className="block-actions">
        {block.user_verified ? (
          <span className="block-verified-status" title="You verified this block">
            <Check size={16} aria-hidden />
            <span>Verified</span>
          </span>
        ) : (
          <button type="button" className="block-confirm" aria-label={`Confirm — ${block.project_name}`} onClick={() => onConfirm(block.work_block_id)}>
            <Check size={16} aria-hidden />
            <span>Confirm</span>
          </button>
        )}
        <button type="button" className="block-exclude" aria-label={`Exclude — ${block.project_name}`} onClick={() => onExclude(block.work_block_id)}>
          <X size={16} aria-hidden />
          <span>Exclude</span>
        </button>
      </div>
    </article>
  );
}
