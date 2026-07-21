import { FormSubmitButton } from "@/components/FormSubmitButton";
import type {
  ActionFollowThrough,
  ActionRiskFlagKey,
  TeamAction,
} from "@/lib/actions";

import {
  createManagerAction,
  updateManagerActionStatus,
} from "./managerActionCommands";

export interface ActionRiskOption {
  key: ActionRiskFlagKey;
  label: string;
}

interface ManagerActionsPanelProps {
  teamId: string;
  actions: TeamAction[];
  followThrough: ActionFollowThrough[];
  riskOptions: ActionRiskOption[];
  loadError: string | null;
  actionError: string | null;
}

function statusLabel(status: TeamAction["status"]): string {
  return status === "done" ? "Resolved" : "Open";
}

const RISK_FLAG_LABELS: Record<ActionRiskFlagKey, string> = {
  "low-headroom": "Low reliable capacity",
  "high-reactive": "High reactive load",
  "high-meetings": "High meeting load",
  "high-fragmentation": "High fragmentation",
  "low-review-coverage": "Low review coverage",
  "stale-data": "Stale shared data",
};

function formatActionDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

export function ManagerActionsPanel({
  teamId,
  actions,
  followThrough,
  riskOptions,
  loadError,
  actionError,
}: ManagerActionsPanelProps) {
  const openActions = actions.filter((action) => action.status === "open");
  const closedActions = actions.filter((action) => action.status === "done");
  const followThroughByAction = new Map(
    followThrough.map((item) => [item.actionId, item]),
  );

  return (
    <section className="panel actions-panel" aria-labelledby="actions-title">
      <div className="actions-panel-head">
        <div>
          <h2 id="actions-title">Actions</h2>
          <p>
            Record a coordination decision tied to a shared briefing signal,
            then revisit what the team-level trend showed afterward. This is a
            follow-through log, not a measure of any individual.
          </p>
        </div>
        <span className="badge">{openActions.length} open</span>
      </div>

      {loadError ? (
        <div className="form-alert" role="alert">
          Actions could not be loaded right now. Reload the page to try again.
        </div>
      ) : null}
      {actionError ? (
        <div className="form-alert" role="alert">
          {actionError}
        </div>
      ) : null}

      <form action={createManagerAction} className="action-entry-form">
        <input type="hidden" name="team_id" value={teamId} />
        <div className="field">
          <label htmlFor="manager-action-text">Action</label>
          <textarea
            id="manager-action-text"
            name="action_text"
            rows={3}
            maxLength={500}
            required
            aria-describedby="manager-action-text-hint"
            placeholder="For example: Move Thursday status updates async and protect the shared focus block."
          />
          <span className="field-hint" id="manager-action-text-hint">Required · 500 characters maximum</span>
        </div>
        <div className="field">
          <label htmlFor="manager-action-risk">Briefing risk signal</label>
          <select id="manager-action-risk" name="risk_flag_key" defaultValue="" aria-describedby="manager-action-risk-hint">
            <option value="">No linked risk signal</option>
            {riskOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="field-hint" id="manager-action-risk-hint">
            Only deterministic, team-level briefing signals are available here.
          </span>
        </div>
        <FormSubmitButton
          className="button button-primary"
          pendingLabel="Logging action…"
        >
          Log action
        </FormSubmitButton>
      </form>

      <div className="actions-list-section" aria-labelledby="open-actions-title">
        <h3 id="open-actions-title">Open actions</h3>
        {loadError ? null : openActions.length === 0 ? (
          <div className="empty-state action-empty-state">
            No open actions. Log the next coordination decision when a shared
            briefing signal calls for follow-through.
          </div>
        ) : (
          <ul className="action-list">
            {openActions.map((action) => (
              <li className="action-card" key={action.id}>
                <div className="action-card-meta">
                  <span className="badge badge-ok">{statusLabel(action.status)}</span>
                  <span>Logged {formatActionDate(action.createdAt)}</span>
                </div>
                <p className="action-card-text">{action.text}</p>
                {action.riskFlagKey ? (
                  <p className="action-risk-link">
                    Briefing signal: {RISK_FLAG_LABELS[action.riskFlagKey]}
                  </p>
                ) : null}
                <div className="panel-actions">
                  <form action={updateManagerActionStatus}>
                    <input type="hidden" name="team_id" value={teamId} />
                    <input type="hidden" name="action_id" value={action.id} />
                    <input type="hidden" name="status" value="done" />
                    <FormSubmitButton
                      className="button button-primary"
                      pendingLabel="Resolving…"
                    >
                      Resolve
                    </FormSubmitButton>
                  </form>
                  <form action={updateManagerActionStatus}>
                    <input type="hidden" name="team_id" value={teamId} />
                    <input type="hidden" name="action_id" value={action.id} />
                    <input type="hidden" name="status" value="dropped" />
                    <FormSubmitButton
                      className="button button-secondary"
                      pendingLabel="Dropping…"
                      confirmMessage="Drop this action? It will be removed from follow-through."
                    >
                      Drop
                    </FormSubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="actions-list-section" aria-labelledby="follow-through-title">
        <h3 id="follow-through-title">What changed after</h3>
        <p>
          Team-level weekly medians are shown only after two later weeks exist.
          They describe correlation after the recorded decision, never cause or
          individual contribution.
        </p>
        {loadError ? null : closedActions.length === 0 ? (
          <div className="empty-state action-empty-state">
            No resolved actions to revisit yet. Resolve an action when the
            coordination step is complete; the later trend will remain hidden
            until there is enough shared history.
          </div>
        ) : (
          <ul className="action-list">
            {closedActions.map((action) => {
              const result = followThroughByAction.get(action.id);
              return (
                <li className="action-card action-card-resolved" key={action.id}>
                  <div className="action-card-meta">
                    <span className="badge">Resolved</span>
                    <span>
                      {action.resolvedAt
                        ? `Resolved ${formatActionDate(action.resolvedAt)}`
                        : "Resolution date unavailable"}
                    </span>
                  </div>
                  <p className="action-card-text">{action.text}</p>
                  {!result || result.status === "too-early" ? (
                    <p className="action-follow-through action-follow-through-early">
                      Too early to tell — this action needs at least two distinct
                      subsequent weeks of shared team data before Weekform shows
                      what changed after.
                    </p>
                  ) : result.status === "not-trackable" ? (
                    <p className="action-follow-through action-follow-through-early">
                      {result.label}
                    </p>
                  ) : (
                    <div className="action-follow-through">
                      <strong>What changed after</strong>
                      <span>{result.label}</span>
                      <span className="stat-note">
                        Correlation only · team-level approved snapshots · no
                        individual attribution.
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
