"use client";

import { useActionState } from "react";

import { generateBriefingAction } from "./actions";
import { AI_DISCLOSURE, INITIAL_BRIEFING_STATE, fallbackReasonLabel } from "./briefingState";

/**
 * Manager-only Team Briefing panel. Client component so the "Generate"
 * button can show pending state; the actual OpenAI/fallback call happens
 * entirely in the server action (generateBriefingAction) — no API key or
 * model logic ever ships to this component's client bundle.
 */
export function BriefingPanel({ teamId }: { teamId: string }) {
  const [state, formAction, pending] = useActionState(
    generateBriefingAction,
    INITIAL_BRIEFING_STATE,
  );

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="team_id" value={teamId} />
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending
            ? "Generating briefing…"
            : state.status === "success"
              ? "Regenerate briefing"
              : "Generate briefing"}
        </button>
      </form>

      {state.status === "error" && state.message ? (
        <div className="form-alert" role="alert" style={{ marginTop: 14 }}>
          {state.message}
        </div>
      ) : null}

      {state.status === "success" && state.result ? (
        <div style={{ marginTop: 16 }} aria-live="polite">
          <div className="form-notice" role="status">
            {AI_DISCLOSURE}
            {state.mode === "fallback" ? (
              <>
                {" "}
                <strong>Deterministic fallback:</strong> {fallbackReasonLabel(state.fallbackReason)}
              </>
            ) : (
              <> Generated with {state.model ?? "the configured model"}.</>
            )}
          </div>

          <section className="panel" aria-labelledby="briefing-headline">
            <h2 id="briefing-headline">{state.result.headline}</h2>
            <p>{state.result.summary}</p>

            <h3>Evidence coverage</h3>
            <p>{state.result.sharedEvidenceCoverage}</p>

            <h3>Risks</h3>
            {state.result.risks.length === 0 ? (
              <p>No risks were raised.</p>
            ) : (
              <ul>
                {state.result.risks.map((risk, index) => (
                  <li key={`${risk.title}-${index}`} style={{ marginBottom: 10 }}>
                    <strong>{risk.title}.</strong> {risk.explanation}
                    {risk.evidenceRefs.length > 0 ? (
                      <div className="stat-note">Evidence: {risk.evidenceRefs.join(", ")}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <h3>Coordination opportunities</h3>
            {state.result.coordinationOpportunities.length === 0 ? (
              <p>No coordination opportunities were identified.</p>
            ) : (
              <ul>
                {state.result.coordinationOpportunities.map((opportunity, index) => (
                  <li key={`${opportunity.title}-${index}`} style={{ marginBottom: 10 }}>
                    <strong>{opportunity.title}.</strong> {opportunity.action}
                    {opportunity.evidenceRefs.length > 0 ? (
                      <div className="stat-note">Evidence: {opportunity.evidenceRefs.join(", ")}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <h3>Questions for the team</h3>
            {state.result.questionsForTheTeam.length === 0 ? (
              <p>No questions were suggested.</p>
            ) : (
              <ul>
                {state.result.questionsForTheTeam.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            )}

            <h3>Limitations</h3>
            <ul>
              {state.result.limitations.map((limitation, index) => (
                <li key={index}>{limitation}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
