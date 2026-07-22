import type { PersonalReplicaBlockV1 } from "../../../packages/domain/src/personalCloud";
import {
  reviewCategories,
  reviewPlannedStatuses,
  reviewWorkModes,
} from "@/lib/personalReviewTaxonomy";
import type { PersonalReplicaView, ReviewCommandView } from "@/lib/personalReplica";
import { formatDateTime } from "@/components/WorkloadSnapshot";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { WeekformDesktopLink } from "@/components/MacAppLink";
import {
  queuePersonalReviewConfirmBatch,
  queuePersonalReviewCommand,
} from "@/app/dashboard/personalActions";
import { presentPersonalToday } from "@/lib/personalTodayPresentation";
import {
  eligibleReviewConfirmTargets,
  reviewConfirmEligibility,
} from "@/lib/personalReplica";
function clampProgress(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function confidencePresentation(value: number): {
  className: string;
  label: string;
  title: string;
} {
  if (value === 0 || !Number.isFinite(value)) {
    return {
      className: "confidence unscored",
      label: "Unscored",
      title: "No classification confidence score",
    };
  }
  const pct = Math.round(value * 100);
  const level = pct >= 85 ? "High" : pct >= 74 ? "Medium" : "Needs review";
  return {
    className: `confidence ${level === "Needs review" ? "low" : level.toLowerCase()}`,
    label: `${level} ${pct}%`,
    title: `${pct}% classification confidence`,
  };
}

function plannedStatusLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function ReviewCommandFields({
  block,
  action,
}: {
  block: PersonalReplicaBlockV1;
  action: "confirm" | "exclude" | "relabel";
}) {
  return (
    <>
      <input type="hidden" name="block_id" value={block.blockId} />
      <input type="hidden" name="week_id" value={block.weekId} />
      <input type="hidden" name="expected_revision" value={block.revision} />
      <input type="hidden" name="action" value={action} />
    </>
  );
}

const COMMAND_STATUS = {
  pending: { label: "Pending Mac approval", detail: "This request is waiting for review on your Mac." },
  applied: { label: "Applied on Mac", detail: "Your Mac applied this request. The next replica will refresh this block." },
  rejected: { label: "Rejected on Mac", detail: "No local truth changed. Review the block and request again if needed." },
  conflict: { label: "Replica changed", detail: "This request no longer matched the local block. Wait for the latest replica before requesting another change." },
} as const;

const COMMAND_ACTION = {
  confirm: "Confirmation",
  exclude: "Exclusion",
  relabel: "Relabel",
} as const;

function PersonalReviewBlock({
  block,
  command,
  demoReadOnly = false,
}: {
  block: PersonalReplicaBlockV1;
  command: ReviewCommandView | null;
  demoReadOnly?: boolean;
}) {
  const confidence = confidencePresentation(block.confidence);
  const status = command?.status ?? null;
  const requestLocked = status !== null && status !== "rejected";

  return (
    <article className="block-card web-review-block">
      <div className="block-topline">
        <span className="block-time">
          {formatDateTime(block.startTime)} — {formatDateTime(block.endTime)}
        </span>
        <div className="block-chips">
          {block.blockerFlag ? <span className="blocker-badge">Blocker</span> : null}
          <span className={confidence.className} title={confidence.title}>{confidence.label}</span>
        </div>
      </div>

      <div className="block-main">
        <div>
          <h3>{block.category}</h3>
          <p>{block.mode} · {plannedStatusLabel(block.plannedStatus)}</p>
        </div>
        <div className="block-capacity" title="Share of a standard week's modeled capacity this review-safe block accounts for">
          <strong>{Math.round(block.estimatedCapacityPct)}%</strong>
          <span className="capacity-caption">of week</span>
        </div>
      </div>

      {command ? (
        <div className={`web-review-command-status is-${status}`} role={status === "rejected" || status === "conflict" ? "alert" : "status"}>
          <strong>{COMMAND_ACTION[command.action]} · {COMMAND_STATUS[command.status].label}</strong>
          <span>{COMMAND_STATUS[command.status].detail}</span>
        </div>
      ) : null}

      {demoReadOnly ? (
        <div className="web-demo-review-fields" aria-label="Review fields shown without edit controls">
          <div><span>Work category</span><strong>{block.category}</strong></div>
          <div><span>Planned status</span><strong>{plannedStatusLabel(block.plannedStatus)}</strong></div>
          <div><span>Work mode</span><strong>{block.mode}</strong></div>
        </div>
      ) : (
      <form action={queuePersonalReviewCommand} className="tag-grid web-review-relabel-form">
        <ReviewCommandFields block={block} action="relabel" />
        <label className="tag-field">
          <span className="tag-field-label">Work category</span>
          <select
            aria-label={`Work category — ${block.category}`}
            name="category"
            defaultValue={block.category}
          >
            {reviewCategories.map((category) => (
              <option value={category} key={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="tag-field">
          <span className="tag-field-label">Planned status</span>
          <select
            aria-label={`Planned status — ${block.category}`}
            name="planned_status"
            defaultValue={block.plannedStatus}
          >
            {reviewPlannedStatuses.map((statusOption) => (
              <option value={statusOption} key={statusOption}>
                {plannedStatusLabel(statusOption)}
              </option>
            ))}
          </select>
        </label>
        <label className="tag-field">
          <span className="tag-field-label">Work mode</span>
          <select
            aria-label={`Work mode — ${block.category}`}
            name="mode"
            defaultValue={block.mode}
          >
            {reviewWorkModes.map((modeOption) => (
              <option value={modeOption} key={modeOption}>{modeOption}</option>
            ))}
          </select>
        </label>
        <FormSubmitButton className="button button-secondary" pendingLabel="Sending request…" disabled={requestLocked}>
          {status === "rejected" ? "Request relabel again" : "Request relabel"}
        </FormSubmitButton>
      </form>
      )}

      <p className="web-review-private-note">
        Private project, stakeholder, and evidence details stay on your Mac.
      </p>

      {demoReadOnly ? (
        <div className="web-demo-review-receipt" role="note">
          <span aria-hidden="true">✓</span>
          <p><strong>Preview only</strong><small>Review requests are disabled in the local demo.</small></p>
        </div>
      ) : (
      <div className="block-actions">
        <form action={queuePersonalReviewCommand}>
          <ReviewCommandFields block={block} action="confirm" />
          <FormSubmitButton className="button button-primary" pendingLabel="Sending request…" disabled={requestLocked}>
            {status === "rejected" ? "Request confirmation again" : "Request confirmation"}
          </FormSubmitButton>
        </form>
        <form action={queuePersonalReviewCommand}>
          <ReviewCommandFields block={block} action="exclude" />
          <FormSubmitButton className="button button-secondary web-review-exclude" pendingLabel="Sending request…" disabled={requestLocked}>
            {status === "rejected" ? "Request exclusion again" : "Request exclusion"}
          </FormSubmitButton>
        </form>
      </div>
      )}
    </article>
  );
}

export function PersonalTodayScreen({
  replicas,
  error,
  reviewCommands,
  reviewCommandsError,
  demoReadOnly = false,
}: {
  replicas: PersonalReplicaView[];
  error: string | null;
  reviewCommands: ReviewCommandView[];
  reviewCommandsError: string | null;
  demoReadOnly?: boolean;
}) {
  const current = replicas[0] ?? null;
  const blocks = current?.payload.blocks ?? [];
  const {
    reviewQueue,
    verifiedCount,
    totalCount,
    progressPct,
    heading,
  } = presentPersonalToday(blocks);
  const allDone = totalCount > 0 && reviewQueue.length === 0;
  const eligibleConfirmTargets = eligibleReviewConfirmTargets(reviewQueue, reviewCommands);
  const { totalCount: totalEligibleConfirmCount } = reviewConfirmEligibility(
    reviewQueue,
    reviewCommands,
  );
  const remainingConfirmCount = totalEligibleConfirmCount - eligibleConfirmTargets.length;

  return (
    <section className="web-desktop-screen web-today-screen review-screen" aria-labelledby="web-today-title">
      <header className="screen-header compact web-today-header">
        <div>
          <p className="eyebrow">Daily review</p>
          <h1 id="web-today-title">
            {!current ? "No review-safe week connected." : heading}
          </h1>
          <p className="screen-subhead">
            {demoReadOnly
              ? "Explore a realistic review queue with every edit and approval path safely disabled."
              : "Confirm the obvious blocks, relabel the odd ones, or exclude anything sensitive. Web requests return to your Mac for approval."}
          </p>
        </div>
        {!error && !reviewCommandsError && current && reviewQueue.length > 0 ? (
          <div className="review-header-actions">
            <span className="web-today-approval-chip">{demoReadOnly ? "Read-only preview" : "Approval required on Mac"}</span>
            {!demoReadOnly && eligibleConfirmTargets.length > 0 && !reviewCommandsError ? (
              <form action={queuePersonalReviewConfirmBatch}>
                <input
                  name="targets"
                  type="hidden"
                  value={JSON.stringify(eligibleConfirmTargets)}
                />
                <FormSubmitButton
                  className="button button-primary primary-action web-confirm-all-action"
                  pendingLabel="Sending requests…"
                >
                  <span aria-hidden="true">✓</span>
                  <span>
                    {remainingConfirmCount > 0
                      ? "Confirm next 50"
                      : <>Confirm all {eligibleConfirmTargets.length}</>}
                  </span>
                </FormSubmitButton>
                {remainingConfirmCount > 0 ? (
                  <span className="web-confirm-batch-limit" role="status">
                    <strong>50 of {totalEligibleConfirmCount}</strong> eligible blocks will be requested now; {remainingConfirmCount} will remain.
                  </span>
                ) : null}
              </form>
            ) : null}
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="form-alert web-today-state" role="alert">
          <h2>Your review queue could not be loaded.</h2>
          <p>Reload the page to try again. No review request was sent.</p>
        </div>
      ) : reviewCommandsError ? (
        <div className="form-alert web-today-state" role="alert">
          <h2>Review request status could not be validated.</h2>
          <p>{reviewCommandsError} Actions are unavailable until status can be loaded safely.</p>
        </div>
      ) : !current ? (
        <div className="panel web-screen-empty web-today-state" role="status">
          <h2>Your review queue is not connected.</h2>
          <p>Turn on Private Web workspace in Weekform for Mac to publish review-safe derived blocks.</p>
          <WeekformDesktopLink className="button button-primary" />
        </div>
      ) : (
        <>
          <div
            className="review-progress"
            role="status"
            aria-label={`${verifiedCount} of ${totalCount} block${totalCount === 1 ? "" : "s"} verified`}
          >
            <span><b>{verifiedCount}</b> of {totalCount} verified</span>
            <div
              className="review-progress-track"
              role="progressbar"
              aria-label="Review progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct}
            >
              <span className="review-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          <div className="web-today-sync-line">
            <span>{current.weekId} · Received {formatDateTime(current.syncedAt)}</span>
            <span>Review-safe replica · private evidence remains local</span>
          </div>

          {blocks.length === 0 ? (
            <div className="panel web-screen-empty web-today-state" role="status">
              <h2>Your review queue is empty.</h2>
              <p>New review-safe blocks will appear after your Mac publishes an updated replica.</p>
            </div>
          ) : allDone ? (
            <div className="panel web-screen-empty web-today-state web-today-complete" role="status">
              <span className="web-today-complete-mark" aria-hidden="true">✓</span>
              <h2>Everything is confirmed.</h2>
              <p>New blocks will appear here when they need review. Your Mac remains the source of truth.</p>
            </div>
          ) : (
            <div className="ledger-list web-review-ledger">
              <h2 className="visually-hidden">Blocks to review</h2>
              {reviewQueue.map((block) => (
                <PersonalReviewBlock
                  block={block}
                  demoReadOnly={demoReadOnly}
                  command={reviewCommands.find((command) => (
                    command.blockId === block.blockId
                    && command.weekId === block.weekId
                    && command.expectedRevision === block.revision
                  )) ?? null}
                  key={block.blockId}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
