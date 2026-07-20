import { simulationWeekStarts } from "./clock";
import { getPersona } from "./personas";
import { getPersonaWorkCatalog } from "./workCatalog";
import type { LocalPlaybackAction, LocalPlaybackPlan, SimulationConfig } from "./types";

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);
const ALLOWED_PORT = "5173";
const SANDBOX_PREFIX = "/simulator-sandbox/";
const ALLOWED_SURFACES = new Set(["bi", "chat", "code", "crm", "documents", "email", "meetings", "projects"]);
const ALLOWED_WEEKFORM_SCREENS = new Set(["daily", "weekly", "forecast", "ledger"]);

export function isAllowedPlaybackSurface(surface: string): boolean {
  return ALLOWED_SURFACES.has(surface);
}

function hasOnlyParameters(url: URL, expected: string[]) {
  const keys = [...url.searchParams.keys()];
  return keys.length === expected.length
    && new Set(keys).size === keys.length
    && expected.every((key) => keys.includes(key));
}

export function isAllowedPlaybackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:"
      || !ALLOWED_HOSTS.has(url.hostname)
      || url.port !== ALLOWED_PORT
      || Boolean(url.username)
      || Boolean(url.password)
      || Boolean(url.hash)
    ) {
      return false;
    }

    if (url.pathname.startsWith(SANDBOX_PREFIX)) {
      const surface = url.pathname.slice(SANDBOX_PREFIX.length);
      if (!isAllowedPlaybackSurface(surface)) return false;
      if (!url.search) return true;
      return hasOnlyParameters(url, ["persona"])
        && Boolean(getPersona(url.searchParams.get("persona") ?? ""));
    }

    if (url.pathname !== "/" || !hasOnlyParameters(url, ["demo", "simulator", "screen", "simulationPersona"])) {
      return false;
    }
    return url.searchParams.get("demo") === "1"
      && url.searchParams.get("simulator") === "1"
      && ALLOWED_WEEKFORM_SCREENS.has(url.searchParams.get("screen") ?? "")
      && Boolean(getPersona(url.searchParams.get("simulationPersona") ?? ""));
  } catch {
    return false;
  }
}

function action(
  personaId: string,
  ordinal: number,
  input: Omit<LocalPlaybackAction, "actionId" | "personaId">,
): LocalPlaybackAction {
  return {
    ...input,
    actionId: `playback-${personaId}-${String(ordinal).padStart(3, "0")}`,
    personaId,
  };
}

function resolvePlaybackOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:"
    || !ALLOWED_HOSTS.has(url.hostname)
    || url.port !== ALLOWED_PORT
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("Live simulation requires the exact local Weekform development origin.");
  }
  return url.origin;
}

export function buildLocalPlaybackPlan(
  config: SimulationConfig,
  origin = "http://127.0.0.1:5173",
): LocalPlaybackPlan {
  const base = resolvePlaybackOrigin(origin);
  const weekStart = simulationWeekStarts(config)[0] ?? config.startDate;
  const personaIds = config.members.flatMap((member) =>
    Array.from({ length: member.count }, () => member.personaId),
  );
  const actions: LocalPlaybackAction[] = [];

  personaIds.forEach((personaId, memberIndex) => {
    const persona = getPersona(personaId);
    const catalog = getPersonaWorkCatalog(personaId);
    if (!persona || !catalog) return;
    const duty = catalog.duties[memberIndex % catalog.duties.length];
    const workUrl = `${base}/simulator-sandbox/projects?persona=${encodeURIComponent(personaId)}`;
    const documentUrl = `${base}/simulator-sandbox/documents?persona=${encodeURIComponent(personaId)}`;
    const chatUrl = `${base}/simulator-sandbox/chat?persona=${encodeURIComponent(personaId)}`;
    const weekformUrl = `${base}/?demo=1&simulator=1&screen=daily&simulationPersona=${encodeURIComponent(personaId)}`;
    const memberPrefix = memberIndex * 11;

    actions.push(
      action(personaId, memberPrefix + 1, {
        type: "navigate", url: workUrl, surface: "business-app", appName: "Projects Sandbox",
        label: `Open ${persona.role} work queue`, detail: duty.title, durationMs: 700,
      }),
      action(personaId, memberPrefix + 2, {
        type: "click", url: workUrl, selector: "[data-synthetic-action='open-work-item']", surface: "business-app", appName: "Projects Sandbox",
        label: "Open the priority work item", detail: duty.deliverable, durationMs: 950,
      }),
      action(personaId, memberPrefix + 3, {
        type: "navigate", url: documentUrl, surface: "business-app", appName: "Documents Sandbox",
        label: "Move into focused work", detail: `Prepare ${duty.deliverable.toLowerCase()}.`, durationMs: 700,
      }),
      action(personaId, memberPrefix + 4, {
        type: "type", url: documentUrl, selector: "[data-synthetic-input='notes']",
        value: `SIMULATED — ${duty.title}; prepare ${duty.deliverable.toLowerCase()} for ${weekStart}.`,
        surface: "business-app", appName: "Documents Sandbox", label: "Draft a work note", detail: "Synthetic content only; no external save.", durationMs: 1300,
      }),
      action(personaId, memberPrefix + 5, {
        type: "switch-tab", url: chatUrl, surface: "business-app", appName: "Chat Sandbox",
        label: "Handle a stakeholder interruption", detail: catalog.communicationPatterns[0].subject, durationMs: 750,
      }),
      action(personaId, memberPrefix + 6, {
        type: "click", url: chatUrl, selector: "[data-synthetic-action='reply']", surface: "business-app", appName: "Chat Sandbox",
        label: "Acknowledge the request", detail: "A mock reply creates no network or workplace mutation.", durationMs: 900,
      }),
      action(personaId, memberPrefix + 7, {
        type: "navigate", url: weekformUrl, surface: "weekform", appName: "Weekform",
        label: "Return to Weekform", detail: "Review matching persona-shaped synthetic demo evidence.", durationMs: 950,
      }),
      action(personaId, memberPrefix + 8, {
        type: "click", url: weekformUrl, selector: ".block-confirm", surface: "weekform", appName: "Weekform Today",
        label: "Confirm a reviewed work block", detail: "Uses Weekform’s real demo-mode review handler.", durationMs: 1100,
      }),
      action(personaId, memberPrefix + 9, {
        type: "click", url: weekformUrl, selector: "[data-tour='week']", surface: "weekform", appName: "Weekform Week",
        label: "Inspect the weekly workload", detail: "Open the real Weekform capacity surface.", durationMs: 1150,
      }),
      action(personaId, memberPrefix + 10, {
        type: "click", url: weekformUrl, selector: "#tab-forecast", surface: "weekform", appName: "Weekform Forecast",
        label: "Check what fits next", detail: "Inspect the evidence-grounded forecast surface.", durationMs: 1200,
      }),
      action(personaId, memberPrefix + 11, {
        type: "wait", url: weekformUrl, surface: "weekform", appName: "Weekform",
        label: "Observe the decision", detail: "The live transcript links business activity to Weekform’s response.", durationMs: 900,
      }),
    );
  });

  return {
    actions,
    syntheticCredentialsOnly: true,
    externalMutationsAllowed: false,
    dedicatedProfile: false,
    embeddedSameOriginOnly: true,
    cancelable: true,
  };
}
