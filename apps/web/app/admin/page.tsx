import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminPortalClient } from "./AdminPortalClient";
import {
  ADMIN_PORTAL_PREFERENCES_COOKIE,
  checkSimulatorAdminAccess,
  parseAdminPortalPreferences,
} from "@/lib/adminPortal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Manager Access",
  description:
    "Weekform's access-controlled manager workspace and synthetic administration surface.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPortalPage() {
  const cookieStore = await cookies();
  const initialPreferences = parseAdminPortalPreferences(
    cookieStore.get(ADMIN_PORTAL_PREFERENCES_COOKIE)?.value,
  );
  const supabase = await createClient();

  if (!supabase) {
    return (
      <AdminPortalClient
        accessState="unavailable"
        accountEmail={null}
        initialPreferences={initialPreferences}
        isAuthConfigured={false}
      />
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?next=/admin");
  }

  const accessState = await checkSimulatorAdminAccess(supabase);

  return (
    <AdminPortalClient
      accessState={accessState}
      accountEmail={user.email ?? null}
      initialPreferences={initialPreferences}
      isAuthConfigured
    />
  );
}
