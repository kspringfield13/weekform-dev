import { isoWeekday, simulationWeekStarts } from "./clock";
import type { LocalPlaybackAction, LocalPlaybackPlan, SimulationConfig } from "./types";

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);
const SANDBOX_PREFIX = "/simulator-sandbox/";
const ALLOWED_SURFACES = new Set(["bi", "chat", "code", "crm", "documents", "email", "meetings", "projects"]);

export function isAllowedPlaybackSurface(surface: string): boolean {
  return ALLOWED_SURFACES.has(surface);
}

export function isAllowedPlaybackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ALLOWED_HOSTS.has(url.hostname) &&
      url.pathname.startsWith(SANDBOX_PREFIX) &&
      isAllowedPlaybackSurface(url.pathname.slice(SANDBOX_PREFIX.length)) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function buildLocalPlaybackPlan(config: SimulationConfig): LocalPlaybackPlan {
  const base = "http://127.0.0.1:5173/simulator-sandbox";
  const weekStart = simulationWeekStarts(config)[0] ?? config.startDate;
  const actions: LocalPlaybackAction[] = [
    { actionId: "playback-001", type: "navigate", url: `${base}/bi` },
    {
      actionId: "playback-002",
      type: "click",
      url: `${base}/bi`,
      selector: "[data-synthetic-action='open-dashboard']",
    },
    {
      actionId: "playback-003",
      type: "type",
      url: `${base}/documents`,
      selector: "[data-synthetic-input='notes']",
      value: `SIMULATED — scenario notes for ${weekStart}`,
    },
    { actionId: "playback-004", type: "switch-tab", url: `${base}/chat` },
    {
      actionId: "playback-005",
      type: "wait",
      url: `${base}/chat`,
      durationMs: isoWeekday(weekStart) * 250,
    },
  ];
  return {
    actions,
    syntheticCredentialsOnly: true,
    externalMutationsAllowed: false,
    dedicatedProfile: true,
    cancelable: true,
  };
}
