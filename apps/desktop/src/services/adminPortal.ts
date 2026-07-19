import { openUrl } from "@tauri-apps/plugin-opener";

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
 * Build the browser destination for the administration surface. Development
 * stays on the current Vite origin; packaged builds use the configured web app,
 * where authentication returns signed-in users to Manager Access.
 */
export function getAdminPortalSignInUrl(
  configuredOrigin?: string,
  context: AdminPortalUrlContext = {}
): string {
  if (context.isDevelopment && context.currentOrigin) {
    try {
      const localOrigin = new URL(context.currentOrigin);
      if (localOrigin.protocol === "http:" || localOrigin.protocol === "https:") {
        return new URL("/admin", localOrigin.origin).toString();
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
  destination.searchParams.set("next", "/admin");
  return destination.toString();
}

export function getConfiguredAdminPortalSignInUrl(): string {
  try {
    const env = import.meta.env;
    return getAdminPortalSignInUrl(env.VITE_WEEKFORM_WEB_URL, {
      isDevelopment: env.DEV,
      currentOrigin: typeof window === "undefined" ? undefined : window.location.origin
    });
  } catch {
    return getAdminPortalSignInUrl();
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

/** Open external web authentication without replacing the desktop webview. */
export async function openAdminPortalSignIn(url: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    await openUrl(url);
    return;
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    throw new Error("Your browser blocked the Manager Access window.");
  }
}
