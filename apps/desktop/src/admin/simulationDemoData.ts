import type { PersistedAppState, PersistedForecastRecord } from "../services/localStore";
import { createDemoState } from "../services/demoData";
import { getPersona } from "../../../../packages/simulator/src/personas";
import { getPersonaWorkCatalog } from "../../../../packages/simulator/src/workCatalog";

/**
 * Re-skins the product's rich, in-memory demo fixture with the selected
 * simulation persona. The base fixture keeps every real Weekform interaction
 * path intact; this adapter changes only synthetic labels and role rhythms.
 */
export function createSimulationDemoState(
  personaId: string,
  reference = new Date(),
): PersistedAppState {
  const persona = getPersona(personaId);
  const state = createDemoState(reference);
  if (!persona) return state;
  const workCatalog = getPersonaWorkCatalog(persona.id);
  const simulatedBlockId = (blockId: string) => `simulation-${persona.id}-${blockId}`;

  const blocks = state.blocks.map((block, index) => {
    const duty = workCatalog?.duties[index % workCatalog.duties.length];
    const category = duty?.category ?? persona.categoryWeights[index % persona.categoryWeights.length].value;
    const weightedMode = persona.modeWeights[index % persona.modeWeights.length].value;
    const blocked = category === "Blocked / waiting / dependency delay";
    const project = persona.projects[index % persona.projects.length];
    return {
      ...block,
      work_block_id: simulatedBlockId(block.work_block_id),
      category,
      mode: blocked ? "Blocked" as const : weightedMode,
      planned_status: blocked ? "blocked" as const : block.planned_status,
      project_name: project,
      stakeholder_group: persona.stakeholders[index % persona.stakeholders.length],
      blocker_flag: blocked || block.blocker_flag,
      notes: block.user_verified ? null : `SIMULATED — review ${duty?.title.toLowerCase() ?? `this ${persona.role.toLowerCase()} duty`}.`,
      evidence: [
        `SIMULATED ${persona.role} duty: ${duty?.title ?? persona.responsibilities[index % persona.responsibilities.length]}`,
        duty?.deliverable ? `Expected work product: ${duty.deliverable}` : "Synthetic work product staged for local review.",
        `Synthetic app context matched ${project}`,
      ],
    };
  });

  const activeWindowSamples = state.activeWindowSamples.map((sample, index) => {
    const duty = workCatalog?.duties[index % workCatalog.duties.length];
    const context = persona.appContexts.find((item) => item.family === duty?.preferredSurface)
      ?? persona.appContexts[index % persona.appContexts.length];
    return {
      ...sample,
      sample_id: `simulation-${persona.id}-${sample.sample_id}`,
      app_name: context.appName,
      window_title: duty ? `SIMULATED — ${duty.title}` : context.syntheticTitles[index % context.syntheticTitles.length],
    };
  });

  const calendarEvents = state.calendarEvents.map((event, index) => ({
    ...event,
    calendar_event_id: `simulation-${persona.id}-${event.calendar_event_id}`,
    uid: `simulation-${persona.id}-${index}@weekform.invalid`,
    title: `SIMULATED — ${persona.meetingBehavior.recurringMeetings[index % persona.meetingBehavior.recurringMeetings.length]}`,
    organizer: "simulator@weekform.invalid",
    location: "Weekform simulation room",
  }));

  const chatEvents = state.chatEvents.map((event, index) => ({
    ...event,
    event_id: `simulation-${persona.id}-${event.event_id}`,
    user_id: `simulation-${persona.id}`,
    app_name: "Slack Sandbox",
    project_hint: `SIMULATED — ${persona.projects[index % persona.projects.length]}`,
    metadata: {
      ...event.metadata,
      provider: "weekform-sandbox",
      channels: `SIMULATED ${persona.stakeholders[index % persona.stakeholders.length]}`,
    },
  }));

  const corrections = state.corrections.map((correction) => ({
    ...correction,
    correction_id: `simulation-${persona.id}-${correction.correction_id}`,
    work_block_id: simulatedBlockId(correction.work_block_id),
  }));
  const reviewSuggestions = state.reviewSuggestions.map((suggestion) => ({
    ...suggestion,
    suggestion_id: `simulation-${persona.id}-${suggestion.suggestion_id}`,
    work_block_ids: suggestion.work_block_ids.map(simulatedBlockId),
    title: `Review the ${persona.role.toLowerCase()} dependency`,
    rationale: `The synthetic dependency remains relevant to ${persona.projects[0]}.`,
  }));
  const reshapeForecast = (record: PersistedForecastRecord): PersistedForecastRecord => ({
    ...record,
    forecast: {
      ...record.forecast,
      headline: `Protect focused ${persona.role.toLowerCase()} work before accepting more commitments.`,
      summary_text: `SIMULATED ${persona.role} commitments across ${persona.projects.slice(0, 2).join(" and ")} define what fits next.`,
      key_constraints: [`Current ${persona.projects[0]} commitment`, `${persona.meetingBehavior.weeklyMinutes.typical} planned meeting minutes`],
      risk_flags: [`Reactive requests may displace ${persona.projects[1] ?? persona.projects[0]}`],
      recommended_actions: ["Protect one persona-appropriate focus block", "Review the remaining inferred work before committing"],
      assumptions: ["Synthetic meeting cadence stays stable", "No additional simulated incident"],
    },
  });

  return {
    ...state,
    blocks,
    activeWindowSamples,
    calendarEvents,
    chatEvents,
    corrections,
    reviewSuggestions,
    generatedForecast: state.generatedForecast ? reshapeForecast(state.generatedForecast) : null,
    forecastHistory: state.forecastHistory.map(reshapeForecast),
    savedSkills: [],
    actedOnPlayIds: [],
    accelerationHistory: [],
    managerSummaryText:
      `SIMULATED — This ${persona.role.toLowerCase()} session balanced ${persona.projects.slice(0, 2).join(" and ")} `
      + `while coordinating with ${persona.stakeholders.slice(0, 2).join(" and ")}. Review the remaining inferred blocks before deciding what fits next.`,
    auditEvents: state.auditEvents.map((event) => ({
      ...event,
      event_id: `simulation-${persona.id}-${event.event_id}`,
      source: "simulation_runtime",
      title: `SIMULATED — ${event.title}`,
      details: { ...event.details, is_synthetic: true, simulation_persona_id: persona.id },
    })),
    visualContextInsights: state.visualContextInsights.map((insight, index) => {
      const context = persona.appContexts[index % persona.appContexts.length];
      return {
        ...insight,
        insight_id: `simulation-${persona.id}-${insight.insight_id}`,
        app_name: context.appName,
        window_title: context.syntheticTitles[0],
        activity_summary: `SIMULATED — ${persona.responsibilities[index % persona.responsibilities.length]}.`,
        project_hint: persona.projects[index % persona.projects.length],
      };
    }),
  };
}
