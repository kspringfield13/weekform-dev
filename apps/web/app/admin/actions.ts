"use server";

import { cookies } from "next/headers";

import {
  ADMIN_PORTAL_PREFERENCES_COOKIE,
  getAdminPortalPreferencesCookieOptions,
  normalizeAdminPortalPreferences,
  serializeAdminPortalPreferences,
} from "@/lib/adminPortal";

export async function saveAdminPortalPreferences(value: unknown) {
  const preferences = normalizeAdminPortalPreferences(value);
  const cookieStore = await cookies();
  cookieStore.set(
    ADMIN_PORTAL_PREFERENCES_COOKIE,
    serializeAdminPortalPreferences(preferences),
    getAdminPortalPreferencesCookieOptions(process.env.NODE_ENV === "production"),
  );

  return { ok: true as const };
}

export async function resetAdminPortalPreferences() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_PORTAL_PREFERENCES_COOKIE, "", {
    ...getAdminPortalPreferencesCookieOptions(
      process.env.NODE_ENV === "production",
    ),
    maxAge: 0,
  });

  return { ok: true as const };
}
