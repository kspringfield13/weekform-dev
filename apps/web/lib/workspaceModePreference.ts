export type WorkspaceMode = "individual" | "manager" | "team";

type WorkspaceModeStorage = Pick<Storage, "getItem" | "setItem">;

const WORKSPACE_MODE_PREFERENCE_KEY = "weekform:web-workspace-mode";

function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === "individual" || value === "manager" || value === "team";
}

export function readWorkspaceModePreference(
  storage: WorkspaceModeStorage,
): WorkspaceMode | null {
  try {
    const value = storage.getItem(WORKSPACE_MODE_PREFERENCE_KEY);
    return isWorkspaceMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeWorkspaceModePreference(
  storage: WorkspaceModeStorage,
  mode: WorkspaceMode,
): void {
  try {
    storage.setItem(WORKSPACE_MODE_PREFERENCE_KEY, mode);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. The URL
    // still remains the authoritative workspace state for the current page.
  }
}

export function resolvePreferredWorkspaceRedirect({
  currentMode,
  preferredMode,
  teamAvailable,
  teamHref,
}: {
  currentMode: WorkspaceMode;
  preferredMode: WorkspaceMode | null;
  teamAvailable: boolean;
  teamHref: string;
}): string | null {
  if (
    currentMode !== "individual"
    || preferredMode === null
    || preferredMode === "individual"
    || !teamAvailable
    || teamHref.length === 0
  ) {
    return null;
  }
  return teamHref;
}
