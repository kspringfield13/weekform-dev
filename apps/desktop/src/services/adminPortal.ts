import { openUrl } from "@tauri-apps/plugin-opener";
import type { Screen, SettingsTab } from "../lib/types";
import type { CloudManagerMember, CloudTeamMembership, CloudTeamRole } from "./cloudClient";

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
  risk: "stable" | "watch" | "attention" | "stale" | "not-sharing";
}

export interface LiveManagerRosterMember extends ManagerRosterMember {
  teamId: string;
  initials: string;
  isSelf: boolean;
  role: CloudTeamRole;
  email: string | null;
  capacity: number | null;
  reactive: number | null;
  fragmented: number | null;
  meetings: number | null;
  review: number | null;
  confidence: number | null;
  syncedAt: string | null;
  weekId: string | null;
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

const INITIAL_MANAGER_ACTIVITY: ManagerWorkspaceActivity[] = [];

export function createInitialManagerWorkspaceState(
  page: ManagerWorkspacePage = "today",
): ManagerWorkspaceState {
  return {
    page,
    mode: "manager",
    agentPrompt: "",
    agentAnswer: null,
    pendingAction: null,
    historyPeriod: "4-weeks",
    activity: INITIAL_MANAGER_ACTIVITY.map((item) => ({ ...item })),
  };
}

export function managerWorkspacePageForScreen(screen: Screen): ManagerWorkspacePage {
  if (screen === "daily") return "today";
  if (
    screen === "weekly"
    || screen === "forecast"
    || screen === "weekly-review"
    || screen === "narrative"
    || screen === "usage"
  ) return "week";
  if (screen === "agent" || screen === "accelerate" || screen === "skills") return "agent";
  if (screen === "ledger" || screen === "audit" || screen === "sensitive") return "history";
  if (screen === "setup") return "settings";
  return "today";
}

export function individualScreenForManagerWorkspacePage(
  page: ManagerWorkspacePage,
  currentScreen: Screen,
): Screen {
  if (currentScreen !== "team" && managerWorkspacePageForScreen(currentScreen) === page) {
    return currentScreen;
  }
  if (page === "week") return "weekly";
  if (page === "agent") return "agent";
  if (page === "history") return "ledger";
  if (page === "settings") return "setup";
  return "daily";
}

export function getManagerWorkspaceAgentAnswer(
  prompt: string,
  mode: ManagerWorkspaceMode,
): string {
  const normalized = prompt.trim().toLocaleLowerCase();
  if (!normalized) return "Ask a specific workload question about your reviewed evidence.";

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

  return "Manager answers are generated only from the live, RLS-scoped team workspace. Open the authenticated briefing to inspect current evidence and approve any resulting action.";
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

/** Every active membership earns the private Team destination; role only changes its contents. */
export function getTeamWorkspaceMemberships(
  memberships: CloudTeamMembership[],
): CloudTeamMembership[] {
  return memberships;
}

export function resolveTeamWorkspaceMembership(
  memberships: CloudTeamMembership[],
  preferredTeamId: string | null,
): CloudTeamMembership | null {
  return memberships.find(({ teamId }) => teamId === preferredTeamId)
    ?? memberships[0]
    ?? null;
}

export function isTeamWorkspaceAvailable(
  signedIn: boolean,
  memberships: CloudTeamMembership[],
  sharingEnabled: boolean,
  sharedTeamId: string | null,
): boolean {
  return signedIn && (
    memberships.length > 0
    || (sharingEnabled && sharedTeamId !== null)
  );
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

function rosterInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
  return initials || "TM";
}

function managerRisk(
  member: CloudManagerMember,
  nowIso: string,
): LiveManagerRosterMember["risk"] {
  const snapshot = member.snapshot;
  if (!snapshot) return "not-sharing";
  const synced = Date.parse(snapshot.syncedAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(synced) || Number.isNaN(now) || now - synced > 7 * 24 * 60 * 60 * 1000) {
    return "stale";
  }
  if (
    (snapshot.reliableCapacityPct !== null && snapshot.reliableCapacityPct < 15)
    || (snapshot.reactivePct !== null && snapshot.reactivePct >= 40)
    || (snapshot.fragmentedPct !== null && snapshot.fragmentedPct >= 35)
    || (snapshot.meetingPct !== null && snapshot.meetingPct >= 50)
  ) {
    return "attention";
  }
  if (
    (snapshot.reliableCapacityPct !== null && snapshot.reliableCapacityPct < 25)
    || (snapshot.reactivePct !== null && snapshot.reactivePct >= 30)
    || (snapshot.fragmentedPct !== null && snapshot.fragmentedPct >= 25)
    || (snapshot.meetingPct !== null && snapshot.meetingPct >= 40)
  ) {
    return "watch";
  }
  return "stable";
}

/** Maps the RLS-approved cloud contract into the Manager Mode view model. */
export function buildManagerRosterMember(
  member: CloudManagerMember,
  nowIso: string,
): LiveManagerRosterMember {
  const name = member.displayName?.trim() || "Team member";
  const eligible = member.snapshot?.eligibleBlocks ?? 0;
  const reviewed = member.snapshot?.reviewedBlocks ?? 0;
  const shareLevel = member.snapshot?.shareLevel;
  return {
    id: member.id,
    teamId: member.teamId,
    name,
    initials: rosterInitials(name),
    team: member.teamName,
    category: shareLevel === "projects"
      ? "Projects"
      : shareLevel === "categories"
        ? "Categories"
        : shareLevel === "summary"
          ? "Summary"
          : "Not sharing",
    risk: managerRisk(member, nowIso),
    isSelf: member.isSelf,
    role: member.role,
    email: member.email,
    capacity: member.snapshot?.reliableCapacityPct ?? null,
    reactive: member.snapshot?.reactivePct ?? null,
    fragmented: member.snapshot?.fragmentedPct ?? null,
    meetings: member.snapshot?.meetingPct ?? null,
    review: eligible > 0 ? Math.round(Math.min(reviewed, eligible) / eligible * 100) : null,
    confidence: member.snapshot?.summaryConfidence ?? null,
    syncedAt: member.snapshot?.syncedAt ?? null,
    weekId: member.snapshot?.weekId ?? null,
  };
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
