export const reviewCategories = [
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
  "Blocked / waiting / dependency delay",
] as const;

export const reviewWorkModes = [
  "Deep work",
  "Reactive",
  "Collaborative",
  "Fragmented",
  "Blocked",
] as const;

export const reviewPlannedStatuses = [
  "planned",
  "unplanned",
  "fixed",
  "blocked",
] as const;
