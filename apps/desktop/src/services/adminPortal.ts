import { openUrl } from "@tauri-apps/plugin-opener";

export const DEFAULT_WEEKFORM_WEB_APP_URL = "https://weekform.com";

/**
 * Build the browser destination for the team administration surface. The web
 * app owns authentication, so signed-out users land on its sign-in page while
 * an existing web session is forwarded to the dashboard by web middleware.
 */
export function getAdminPortalSignInUrl(configuredOrigin?: string): string {
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
  destination.searchParams.set("next", "/dashboard");
  return destination.toString();
}

export function getConfiguredAdminPortalSignInUrl(): string {
  try {
    const env = import.meta.env as Record<string, string | undefined> | undefined;
    return getAdminPortalSignInUrl(env?.VITE_WEEKFORM_WEB_URL);
  } catch {
    return getAdminPortalSignInUrl();
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
    throw new Error("Your browser blocked the Admin Portal window.");
  }
}
