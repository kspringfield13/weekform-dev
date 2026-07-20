import { openUrl } from "@tauri-apps/plugin-opener";
import type { SettingsTab } from "../lib/types";
import type { CloudTeamMembership } from "./cloudClient";

export const DEFAULT_WEEKFORM_WEB_APP_URL = "https://weekform.dev";
export const LOCAL_ADMIN_PORTAL_SESSION_KEY = "weekform.admin-portal.local-session.v1";
export const LOCAL_ADMIN_PORTAL_PREFERENCES_KEY = "weekform.admin-portal.preferences.v1";
const LOCAL_ADMIN_PORTAL_SESSION_VALUE = "simulator_admin";
export const MAX_MANAGER_COMPARISONS = 6;

export interface ManagerRosterMember {
  id: string;
  name: string;
  team: string;
  category: string;
  risk: "stable" | "watch" | "attention";
}

export interface ManagerRosterFilters {
  query: string;
  team: string;
  category: string;
  risk: string;
}

export type ManagerWorkspacePage = "today" | "week" | "agent" | "history" | "settings";
export type ManagerWorkspaceMode = "individual" | "manager";
export type ManagerWorkspaceHistoryPeriod = "4-weeks" | "12-weeks";

export interface ManagerWorkspaceActivity {
  id: string;
  time: string;
  title: string;
  detail: string;
  status: string;
}

export interface ManagerWorkspaceState {
  page: ManagerWorkspacePage;
  mode: ManagerWorkspaceMode;
  agentPrompt: string;
  agentAnswer: string | null;
  pendingAction: string | null;
  historyPeriod: ManagerWorkspaceHistoryPeriod;
  activity: ManagerWorkspaceActivity[];
}

export type ManagerWorkspaceEvent =
  | { type: "navigate"; page: ManagerWorkspacePage }
  | { type: "set-mode"; mode: ManagerWorkspaceMode }
  | { type: "open-briefing" }
  | { type: "ask-agent"; prompt: string }
  | { type: "stage-action"; action: string }
  | { type: "cancel-action" }
  | { type: "approve-action" }
  | { type: "set-history-period"; period: ManagerWorkspaceHistoryPeriod };

const INITIAL_MANAGER_ACTIVITY: ManagerWorkspaceActivity[] = [
  { id: "proposed-focus", time: "Today · 10:42", title: "Manager action proposed", detail: "Protect Thursday focus block", status: "Awaiting approval" },
  { id: "snapshots-refreshed", time: "Today · 09:15", title: "Team snapshots refreshed", detail: "12 of 14 members sharing", status: "Completed" },
  { id: "weekly-review", time: "Friday · 16:30", title: "Weekly review closed", detail: "Median capacity rose 3 points", status: "Observed" },
  { id: "policy-updated", time: "Thursday · 14:05", title: "Share policy updated", detail: "Projects narrowed to categories", status: "Audited" },
  { id: "intake-reviewed", time: "3 weeks ago", title: "Platform intake reviewed", detail: "One reporting request moved to the next cycle", status: "Observed" },
  { id: "support-rotated", time: "7 weeks ago", title: "Launch support rotated", detail: "Reactive coverage moved across Operations", status: "Completed" },
];

export function createInitialManagerWorkspaceState(): ManagerWorkspaceState {
  return {
    page: "today",
    mode: "manager",
    agentPrompt: "",
    agentAnswer: null,
    pendingAction: null,
    historyPeriod: "4-weeks",
    activity: INITIAL_MANAGER_ACTIVITY.map((item) => ({ ...item })),
  };
}

export function getManagerWorkspaceAgentAnswer(
  prompt: string,
  mode: ManagerWorkspaceMode,
): string {
  const normalized = prompt.trim().toLocaleLowerCase();
  if (!normalized) return "Ask a specific workload question to inspect the synthetic reviewed evidence.";

  if (mode === "individual") {
    if (normalized.includes("commit")) {
      return "The reviewed week supports one focused commitment of about 12 hours. Keep two hours unallocated because two reactive blocks still need review.";
    }
    if (normalized.includes("fragment")) {
      return "Focus was split by three reactive blocks and two meeting handoffs. The evidence supports protecting one uninterrupted afternoon before adding work.";
    }
    if (normalized.includes("summary") || normalized.includes("draft")) {
      return "You protected 15.6 focus hours, reduced reactive load by 2 points, and still have two blocks to review before this week becomes a reliable baseline.";
    }
    return "Your reviewed week shows 31% reliable capacity, 24% reactive load, and 96% review coverage. Refine the question to compare a commitment, focus pattern, or allocation change.";
  }

  if (normalized.includes("absorb") || normalized.includes("next week")) {
    return "Across 12 approved snapshots, the median supports one small commitment. Keep Thursday focus protected and do not treat the two non-sharing members as available capacity.";
  }
  if (normalized.includes("reactive")) {
    return "Reactive load is highest in Operations and has the widest spread in Insights. Review the two low-headroom signals before changing ownership or intake.";
  }
  if (normalized.includes("compare")) {
    return "The selected contributors differ most in reactive load and protected focus. Use the side-by-side table as context, not a ranking, and ask each person before proposing a change.";
  }
  if (normalized.includes("summary") || normalized.includes("draft")) {
    return "Twelve approved snapshots show 27% median reliable capacity, 28% reactive load, and two fresh signals needing attention. Unknown values from non-sharing members remain excluded.";
  }
  return "The available manager evidence is limited to approved summary metrics from 12 members. It supports a coordination conversation, not a conclusion about individual performance.";
}

export function managerWorkspaceReducer(
  state: ManagerWorkspaceState,
  event: ManagerWorkspaceEvent,
): ManagerWorkspaceState {
  switch (event.type) {
    case "navigate":
      return { ...state, page: event.page };
    case "set-mode":
      return { ...state, mode: event.mode, agentPrompt: "", agentAnswer: null };
    case "open-briefing":
      return { ...state, page: "agent", mode: "manager" };
    case "ask-agent": {
      const prompt = event.prompt.trim();
      return {
        ...state,
        page: "agent",
        agentPrompt: prompt,
        agentAnswer: getManagerWorkspaceAgentAnswer(prompt, state.mode),
      };
    }
    case "stage-action":
      return {
        ...state,
        page: "agent",
        mode: "manager",
        pendingAction: event.action.trim() || "Review the proposed coordination change",
      };
    case "cancel-action":
      return { ...state, pendingAction: null };
    case "approve-action":
      if (!state.pendingAction) return state;
      return {
        ...state,
        page: "history",
        pendingAction: null,
        activity: [{
          id: `approved-${state.activity.length + 1}`,
          time: "Just now",
          title: "Manager action approved",
          detail: state.pendingAction,
          status: "Approved",
        }, ...state.activity],
      };
    case "set-history-period":
      return { ...state, historyPeriod: event.period };
  }
}

export function getIndividualWorkspaceUrl(
  settingsTab: SettingsTab,
  currentOrigin: string,
): string {
  const destination = new URL("/", currentOrigin);
  destination.searchParams.set("demo", "1");
  destination.searchParams.set("screen", "setup");
  destination.searchParams.set("settings", settingsTab);
  return destination.toString();
}

export function resolveSettingsTab(value: string | null): SettingsTab | null {
  if (
    value === "data-sources"
    || value === "data-control"
    || value === "ai-assistance"
    || value === "ai-usage"
    || value === "notifications"
    || value === "account"
  ) {
    return value;
  }
  return null;
}

export function getWeekformWebAppUrl(
  pathname: string,
  configuredOrigin?: string,
): string {
  let origin = DEFAULT_WEEKFORM_WEB_APP_URL;
  if (configuredOrigin?.trim()) {
    try {
      const candidate = new URL(configuredOrigin.trim());
      if (candidate.protocol === "https:" || candidate.protocol === "http:") {
        origin = candidate.origin;
      }
    } catch {
      // Fall through to the canonical web app.
    }
  }
  const safePath = pathname.startsWith("//")
    ? "/"
    : pathname.startsWith("/")
      ? pathname
      : `/${pathname}`;
  return new URL(safePath, origin).toString();
}

export function getManagerModeMemberships(
  memberships: CloudTeamMembership[],
): CloudTeamMembership[] {
  return memberships.filter(({ role }) => role === "owner" || role === "manager");
}

export function toggleManagerComparison(selectedIds: string[], memberId: string): string[] {
  if (selectedIds.includes(memberId)) {
    return selectedIds.filter((id) => id !== memberId);
  }
  if (selectedIds.length >= MAX_MANAGER_COMPARISONS) return selectedIds;
  return [...selectedIds, memberId];
}

export function filterManagerMembers<T extends ManagerRosterMember>(
  members: T[],
  filters: ManagerRosterFilters,
): T[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return members.filter((member) => (
    (!query || `${member.name} ${member.team} ${member.category}`.toLocaleLowerCase().includes(query))
    && (filters.team === "all" || member.team === filters.team)
    && (filters.category === "all" || member.category === filters.category)
    && (filters.risk === "all" || member.risk === filters.risk)
  ));
}

export type AdminPortalTheme = "system" | "dark" | "light";
export type AdminPortalAccent = "iris" | "cobalt" | "ember";
export type AdminPortalDensity = "comfortable" | "compact";

export interface AdminPortalPreferences {
  theme: AdminPortalTheme;
  accent: AdminPortalAccent;
  density: AdminPortalDensity;
  ambientMotion: boolean;
}

export const DEFAULT_ADMIN_PORTAL_PREFERENCES: AdminPortalPreferences = {
  theme: "dark",
  accent: "iris",
  density: "comfortable",
  ambientMotion: true
};

export interface AdminPortalSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AdminPortalUrlContext {
  isDevelopment?: boolean;
  currentOrigin?: string;
}

/**
 * Build the browser destination for Manager Access. Development
 * stays on the current Vite origin; packaged builds use the configured web app,
 * where authentication returns signed-in users to Manager Access.
 */
export function getManagerAccessSignInUrl(
  configuredOrigin?: string,
  context: AdminPortalUrlContext = {}
): string {
  if (context.isDevelopment && context.currentOrigin) {
    try {
      const localOrigin = new URL(context.currentOrigin);
      if (localOrigin.protocol === "http:" || localOrigin.protocol === "https:") {
        return new URL("/manager-access", localOrigin.origin).toString();
      }
    } catch {
      // Continue to the configured web destination when no valid local origin exists.
    }
  }

  let origin = DEFAULT_WEEKFORM_WEB_APP_URL;

  if (configuredOrigin?.trim()) {
    try {
      const candidate = new URL(configuredOrigin.trim());
      if (candidate.protocol === "https:" || candidate.protocol === "http:") {
        origin = candidate.origin;
      }
    } catch {
      // Fall back to the canonical production origin for malformed build input.
    }
  }

  const destination = new URL("/login", origin);
  destination.searchParams.set("next", "/manager-access");
  return destination.toString();
}

export function getConfiguredManagerAccessSignInUrl(): string {
  try {
    const env = import.meta.env;
    return getManagerAccessSignInUrl(env.VITE_WEEKFORM_WEB_URL, {
      isDevelopment: env.DEV,
      currentOrigin: typeof window === "undefined" ? undefined : window.location.origin
    });
  } catch {
    return getManagerAccessSignInUrl();
  }
}

export function getBrowserAdminPortalSessionStorage(): AdminPortalSessionStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getAdminPortalPreferencesStorage(
  browserWindow: Pick<Window, "localStorage"> | undefined = typeof window === "undefined" ? undefined : window
): AdminPortalSessionStorage | null {
  if (!browserWindow) return null;
  try {
    return browserWindow.localStorage;
  } catch {
    return null;
  }
}

export function readAdminPortalPreferences(
  storage: AdminPortalSessionStorage | null
): AdminPortalPreferences {
  if (!storage) return { ...DEFAULT_ADMIN_PORTAL_PREFERENCES };
  try {
    const stored = JSON.parse(storage.getItem(LOCAL_ADMIN_PORTAL_PREFERENCES_KEY) ?? "null");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return { ...DEFAULT_ADMIN_PORTAL_PREFERENCES };
    }
    return {
      theme: stored.theme === "system" || stored.theme === "dark" || stored.theme === "light"
        ? stored.theme
        : DEFAULT_ADMIN_PORTAL_PREFERENCES.theme,
      accent: stored.accent === "iris" || stored.accent === "cobalt" || stored.accent === "ember"
        ? stored.accent
        : DEFAULT_ADMIN_PORTAL_PREFERENCES.accent,
      density: stored.density === "comfortable" || stored.density === "compact"
        ? stored.density
        : DEFAULT_ADMIN_PORTAL_PREFERENCES.density,
      ambientMotion: typeof stored.ambientMotion === "boolean"
        ? stored.ambientMotion
        : DEFAULT_ADMIN_PORTAL_PREFERENCES.ambientMotion
    };
  } catch {
    return { ...DEFAULT_ADMIN_PORTAL_PREFERENCES };
  }
}

export function writeAdminPortalPreferences(
  storage: AdminPortalSessionStorage | null,
  preferences: AdminPortalPreferences
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LOCAL_ADMIN_PORTAL_PREFERENCES_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function resetAdminPortalPreferences(storage: AdminPortalSessionStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(LOCAL_ADMIN_PORTAL_PREFERENCES_KEY);
    return true;
  } catch {
    return false;
  }
}

export function readLocalAdminPortalSession(storage: AdminPortalSessionStorage | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(LOCAL_ADMIN_PORTAL_SESSION_KEY) === LOCAL_ADMIN_PORTAL_SESSION_VALUE;
  } catch {
    return false;
  }
}

export function writeLocalAdminPortalSession(
  storage: AdminPortalSessionStorage | null,
  authenticated: boolean
): boolean {
  if (!storage) return false;
  try {
    if (authenticated) {
      storage.setItem(LOCAL_ADMIN_PORTAL_SESSION_KEY, LOCAL_ADMIN_PORTAL_SESSION_VALUE);
    } else {
      storage.removeItem(LOCAL_ADMIN_PORTAL_SESSION_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

async function openWeekformBrowserUrl(url: string, blockedMessage: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    await openUrl(url);
    return;
  }

  const opened = window.open("", "_blank");
  if (!opened) {
    throw new Error(blockedMessage);
  }
  opened.opener = null;
  opened.location.replace(url);
}

/** Open external web authentication without replacing the desktop webview. */
export async function openManagerAccess(url: string): Promise<void> {
  await openWeekformBrowserUrl(url, "Your browser blocked the Manager Access window.");
}

/** Open the canonical authenticated Web workspace in the user's browser. */
export async function openWeekformWebApp(): Promise<void> {
  await openWeekformBrowserUrl(
    getWeekformWebAppUrl("/app"),
    "Your browser blocked the Weekform Web app window."
  );
}
