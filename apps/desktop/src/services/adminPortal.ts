import { openUrl } from "@tauri-apps/plugin-opener";

export const DEFAULT_WEEKFORM_WEB_APP_URL = "https://weekform.com";

export interface AdminPortalUrlContext {
  isDevelopment?: boolean;
  currentOrigin?: string;
}

/**
 * Build the browser destination for the administration surface. Development
 * stays on the current Vite origin; packaged builds use the configured web app,
 * where authentication returns signed-in users to the team dashboard.
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
  destination.searchParams.set("next", "/dashboard");
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
