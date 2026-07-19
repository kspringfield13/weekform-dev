import { isDateKey, isIanaTimezone, isWallTime, simulationEndDate } from "./clock";
import { getPersona } from "./personas";
import type {
  RealismViolation,
  SimulationConfig,
  SimulationDataset,
  SimulationValidationResult,
} from "./types";

function configError(errors: string[], condition: boolean, message: string) {
  if (!condition) errors.push(message);
}

export function validateSimulationConfig(config: SimulationConfig): SimulationValidationResult {
  const errors: string[] = [];
  configError(errors, config.schemaVersion === 1, "Unsupported simulation schema version.");
  configError(errors, Boolean(config.generatorVersion.trim()), "Generator version is required.");
  configError(errors, config.members.length > 0, "Select at least one persona.");
  for (const member of config.members) {
    configError(errors, Boolean(getPersona(member.personaId)), `Unknown persona: ${member.personaId}`);
    configError(errors, Number.isInteger(member.count) && member.count >= 1 && member.count <= 100, "Member count must be between 1 and 100.");
  }
  configError(errors, isDateKey(config.startDate), "Start date must use YYYY-MM-DD.");
  configError(errors, Number.isInteger(config.span.value) && config.span.value >= 1, "Span must be a positive integer.");
  configError(errors, config.span.unit !== "years" || config.span.value <= 10, "Spans longer than 10 years are not supported.");
  configError(errors, isIanaTimezone(config.timezone), "Timezone must be a valid IANA timezone.");
  configError(errors, config.workDays.length > 0 && config.workDays.every((day) => day >= 1 && day <= 7), "Select valid working days.");
  configError(errors, isWallTime(config.workingHours.start) && isWallTime(config.workingHours.end), "Working hours must use HH:MM.");
  configError(errors, config.workingHours.start < config.workingHours.end, "Working hours must end after they start.");
  configError(errors, config.holidays.every(isDateKey), "Holiday dates must use YYYY-MM-DD.");
  for (const pto of config.pto) {
    configError(errors, isDateKey(pto.startDate) && isDateKey(pto.endDateExclusive), "PTO dates must use YYYY-MM-DD.");
    configError(errors, pto.startDate < pto.endDateExclusive, "PTO must end after it starts.");
  }
  for (const [name, value] of Object.entries({
    meetingDensity: config.scenario.meetingDensity,
    reactiveLoad: config.scenario.reactiveLoad,
    fragmentation: config.scenario.fragmentation,
    overtime: config.scenario.overtime,
    interruptions: config.scenario.interruptions,
  })) {
    configError(errors, Number.isInteger(value) && value >= 0 && value <= 100, `${name} must be between 0 and 100.`);
  }
  configError(errors, Number.isInteger(config.scenario.projectCount) && config.scenario.projectCount >= 1 && config.scenario.projectCount <= 12, "Project count must be between 1 and 12.");
  configError(errors, Boolean(config.seed.trim()), "Seed is required.");
  if (isDateKey(config.startDate)) {
    configError(errors, simulationEndDate(config) > config.startDate, "Simulation end must follow its start.");
  }
  return { valid: errors.length === 0, errors, violations: [] };
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const PATH_PATTERN = /(?:\/Users\/|\/home\/|[A-Za-z]:\\)/;

function inspectValue(value: unknown, artifactId: string, violations: RealismViolation[], key = "") {
  if (typeof value === "string") {
    for (const match of value.matchAll(EMAIL_PATTERN)) {
      if (!match[0].toLowerCase().endsWith(".invalid")) {
        violations.push({ code: "forbidden-pii", severity: "error", message: "Real-looking email address found in synthetic output.", artifactId });
      }
    }
    if (PATH_PATTERN.test(value)) {
      violations.push({ code: "forbidden-path", severity: "error", message: "Local filesystem path found in synthetic output.", artifactId });
    }
    if (key === "window_title" && value && !value.startsWith("SIMULATED —")) {
      violations.push({ code: "unsafe-window-title", severity: "error", message: "Synthetic window title lacks the SIMULATED prefix.", artifactId });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => inspectValue(entry, artifactId, violations, key));
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, entry] of Object.entries(value as Record<string, unknown>)) {
      inspectValue(entry, artifactId, violations, childKey);
    }
  }
}

export function validateSimulationDataset(dataset: SimulationDataset): SimulationValidationResult {
  const violations: RealismViolation[] = [];
  const memberIds = new Set(dataset.members.map((member) => member.memberId));
  const artifactIds = new Set<string>();
  for (const group of Object.values(dataset.artifacts)) {
    for (const artifact of group) {
      const id = artifact.stamp.canonicalArtifactId;
      if (!artifact.stamp.isSynthetic || artifact.stamp.simulationRunId !== dataset.runId) {
        violations.push({ code: "missing-synthetic-stamp", severity: "error", message: "Artifact synthetic provenance is incomplete.", artifactId: id });
      }
      if (!memberIds.has(artifact.stamp.memberId)) {
        violations.push({ code: "member-isolation", severity: "error", message: "Artifact references a member outside this run.", artifactId: id });
      }
      if (artifactIds.has(id)) {
        violations.push({ code: "duplicate-artifact", severity: "error", message: "Canonical artifact ID is duplicated.", artifactId: id });
      }
      artifactIds.add(id);
      inspectValue(artifact.payload, id, violations);
    }
  }
  const end = simulationEndDate(dataset.config);
  for (const artifact of dataset.artifacts.rawEvents) {
    const date = artifact.payload.timestamp_start.slice(0, 10);
    if (date < dataset.config.startDate || date > end) {
      violations.push({ code: "outside-span", severity: "error", message: "Raw event falls outside the configured span.", artifactId: artifact.stamp.canonicalArtifactId });
    }
  }
  const errors = violations.filter((item) => item.severity === "error").map((item) => item.message);
  return { valid: errors.length === 0, errors, violations };
}
