import type { SimulationConfig } from "./types";

/**
 * Canonical acceptance fixture from the Span Simulator mission. The date is a
 * Monday and the 26-week span ends exclusively on 2026-07-06. No implicit
 * holiday or PTO calendar is applied: every input that can affect replay is
 * represented directly in this object.
 */
export const GOLDEN_SIMULATION_CONFIG: SimulationConfig = {
  schemaVersion: 1,
  generatorVersion: "1.0.0",
  members: [{ personaId: "data-analyst", count: 1 }],
  startDate: "2026-01-05",
  span: { value: 26, unit: "weeks" },
  timezone: "America/New_York",
  workDays: [1, 2, 3, 4, 5],
  workingHours: { start: "09:00", end: "17:30" },
  holidays: [],
  pto: [],
  scenario: {
    version: "1.0.0",
    kind: "quarter-end",
    title: "Quarter-end reporting plus an urgent dashboard migration",
    direction:
      "Begin with a stable senior data-analyst baseline, introduce an urgent dashboard migration, ramp recurring reporting and stakeholder pressure into quarter end, create one migration incident, then show a credible post-deadline recovery before the next quarter-end cycle.",
    meetingDensity: 38,
    reactiveLoad: 42,
    fragmentation: 36,
    projectCount: 4,
    overtime: 18,
    interruptions: 44,
  },
  seed: "20260718",
  sharingPolicy: { level: "summary+categories" },
  executionMode: "fast-forward",
};
