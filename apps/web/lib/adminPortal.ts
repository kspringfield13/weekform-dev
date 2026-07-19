export const ADMIN_PORTAL_PREFERENCES_COOKIE = "weekform_admin_appearance";

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
  ambientMotion: true,
};

export type SimulatorAdminAccess =
  | "authorized"
  | "forbidden"
  | "unavailable";

interface SimulatorAdminRpcClient {
  rpc(
    functionName: string,
    args?: unknown,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

function isTheme(value: unknown): value is AdminPortalTheme {
  return value === "system" || value === "dark" || value === "light";
}

function isAccent(value: unknown): value is AdminPortalAccent {
  return value === "iris" || value === "cobalt" || value === "ember";
}

function isDensity(value: unknown): value is AdminPortalDensity {
  return value === "comfortable" || value === "compact";
}

export function normalizeAdminPortalPreferences(
  value: unknown,
): AdminPortalPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_ADMIN_PORTAL_PREFERENCES };
  }

  const candidate = value as Partial<AdminPortalPreferences>;
  if (
    !isTheme(candidate.theme) ||
    !isAccent(candidate.accent) ||
    !isDensity(candidate.density) ||
    typeof candidate.ambientMotion !== "boolean"
  ) {
    return { ...DEFAULT_ADMIN_PORTAL_PREFERENCES };
  }

  return {
    theme: candidate.theme,
    accent: candidate.accent,
    density: candidate.density,
    ambientMotion: candidate.ambientMotion,
  };
}

export function serializeAdminPortalPreferences(value: unknown): string {
  const preferences = normalizeAdminPortalPreferences(value);
  return [
    "v1",
    preferences.theme,
    preferences.accent,
    preferences.density,
    preferences.ambientMotion ? "1" : "0",
  ].join(".");
}

export function parseAdminPortalPreferences(
  value: string | null | undefined,
): AdminPortalPreferences {
  const [version, theme, accent, density, ambientMotion, extra] =
    value?.split(".") ?? [];

  if (
    version !== "v1" ||
    !isTheme(theme) ||
    !isAccent(accent) ||
    !isDensity(density) ||
    (ambientMotion !== "0" && ambientMotion !== "1") ||
    extra !== undefined
  ) {
    return { ...DEFAULT_ADMIN_PORTAL_PREFERENCES };
  }

  return {
    theme,
    accent,
    density,
    ambientMotion: ambientMotion === "1",
  };
}

export function getAdminPortalPreferencesCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    maxAge: 31_536_000,
    path: "/admin",
    sameSite: "lax" as const,
    secure,
  };
}

/**
 * Resolve the explicit simulator-admin grant through the current user's
 * cookie-bound Supabase session. Only an exact boolean true authorizes.
 */
export async function checkSimulatorAdminAccess(
  client: SimulatorAdminRpcClient,
): Promise<SimulatorAdminAccess> {
  try {
    const { data, error } = await client.rpc("has_simulator_admin_access");
    if (error) return "unavailable";
    if (data === true) return "authorized";
    if (data === false) return "forbidden";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
