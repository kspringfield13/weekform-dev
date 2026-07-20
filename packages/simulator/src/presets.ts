import type { ScenarioKind, SimulationConfig, SimulationScenario } from "./types";

export type ScenarioPreset = Pick<
  SimulationScenario,
  | "kind"
  | "title"
  | "direction"
  | "meetingDensity"
  | "reactiveLoad"
  | "fragmentation"
  | "projectCount"
  | "overtime"
  | "interruptions"
>;

export const SCENARIO_PRESETS: Record<ScenarioKind, ScenarioPreset> = {
  normal: {
    kind: "normal",
    title: "Steady operating week",
    direction: "Model a sustainable mix of planned delivery, routine meetings, and ordinary reactive work.",
    meetingDensity: 30,
    reactiveLoad: 24,
    fragmentation: 22,
    projectCount: 3,
    overtime: 8,
    interruptions: 26,
  },
  quiet: {
    kind: "quiet",
    title: "Protected focus window",
    direction: "Reduce meetings and reactive demand so longer focus blocks and recovery become visible.",
    meetingDensity: 12,
    reactiveLoad: 10,
    fragmentation: 9,
    projectCount: 2,
    overtime: 2,
    interruptions: 10,
  },
  busy: {
    kind: "busy",
    title: "High-volume operating week",
    direction: "Increase simultaneous work, meetings, and incoming requests without a single acute incident.",
    meetingDensity: 58,
    reactiveLoad: 48,
    fragmentation: 55,
    projectCount: 6,
    overtime: 32,
    interruptions: 60,
  },
  "deadline-heavy": {
    kind: "deadline-heavy",
    title: "Competing delivery deadlines",
    direction: "Concentrate due dates and handoffs to expose carryover, overtime, and delivery-risk pressure.",
    meetingDensity: 44,
    reactiveLoad: 38,
    fragmentation: 50,
    projectCount: 7,
    overtime: 68,
    interruptions: 48,
  },
  incident: {
    kind: "incident",
    title: "Operational incident response",
    direction: "Introduce an acute incident, elevated interrupts, and a credible recovery after the spike.",
    meetingDensity: 52,
    reactiveLoad: 88,
    fragmentation: 84,
    projectCount: 5,
    overtime: 76,
    interruptions: 92,
  },
  launch: {
    kind: "launch",
    title: "Cross-functional launch",
    direction: "Ramp coordination, launch work, stakeholder communication, and post-launch stabilization.",
    meetingDensity: 66,
    reactiveLoad: 54,
    fragmentation: 61,
    projectCount: 6,
    overtime: 52,
    interruptions: 64,
  },
  "quarter-end": {
    kind: "quarter-end",
    title: "Quarter-end reporting",
    direction: "Ramp recurring reporting and stakeholder pressure, then show a credible post-deadline recovery.",
    meetingDensity: 38,
    reactiveLoad: 42,
    fragmentation: 36,
    projectCount: 4,
    overtime: 18,
    interruptions: 44,
  },
};

export function getScenarioPreset(kind: ScenarioKind): ScenarioPreset {
  return SCENARIO_PRESETS[kind];
}

export function applyScenarioPreset(config: SimulationConfig, kind: ScenarioKind): SimulationConfig {
  return {
    ...config,
    scenario: {
      ...config.scenario,
      ...SCENARIO_PRESETS[kind],
    },
  };
}
