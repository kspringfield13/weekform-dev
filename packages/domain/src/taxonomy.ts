import type { WorkCategory, WorkMode, PlannedStatus } from "./models";

export const workCategories: WorkCategory[] = [
  "Planned analysis / project work",
  "Ad hoc stakeholder requests",
  "Recurring reporting",
  "Dashboard development / edits",
  "SQL / data modeling / query work",
  "QA / data validation",
  "Debugging / issue investigation",
  "Documentation / requirement clarification",
  "Meetings / stakeholder syncs",
  "Admin / coordination",
  "Blocked / waiting / dependency delay"
];

// Only "Deep work", "Fragmented", and "Reactive" drive the capacity math
// (`computeWeeklyCapacitySnapshot` in `packages/inference/src/capacity.ts` branches solely on
// those three for deep-work %, fragmentation, and the context-switch score). "Collaborative" and
// "Blocked" are DISPLAY-ONLY here: they colour the work-mode allocation grid (`modeColors`) but
// never enter a utilization/fragmentation calculation, so a collaborative week reads as all-zero
// deep/fragmented work. Don't add capacity logic that assumes those two carry weight.
export const workModes: WorkMode[] = [
  "Deep work",
  "Reactive",
  "Collaborative",
  "Fragmented",
  "Blocked"
];

export const plannedStatuses: PlannedStatus[] = ["planned", "unplanned", "fixed", "blocked"];

export const categoryColors: Record<WorkCategory, string> = {
  "Planned analysis / project work": "#2563eb",
  "Ad hoc stakeholder requests": "#dc2626",
  "Recurring reporting": "#0891b2",
  "Dashboard development / edits": "#7c3aed",
  "SQL / data modeling / query work": "#0f766e",
  "QA / data validation": "#ca8a04",
  "Debugging / issue investigation": "#ea580c",
  "Documentation / requirement clarification": "#6b7280",
  "Meetings / stakeholder syncs": "#16a34a",
  "Admin / coordination": "#64748b",
  "Blocked / waiting / dependency delay": "#be185d"
};

// Palette for the work-mode allocation split, mirroring `categoryColors`. Reuses the same
// hues so the two allocation grids read as one visual system: focus (blue), reactive (red),
// collaborative (green), fragmented (orange), blocked (pink).
export const modeColors: Record<WorkMode, string> = {
  "Deep work": "#2563eb",
  "Reactive": "#dc2626",
  "Collaborative": "#16a34a",
  "Fragmented": "#ea580c",
  "Blocked": "#be185d"
};
