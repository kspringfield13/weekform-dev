import type { Metadata } from "next";

import DashboardPage from "@/app/dashboard/page";

export const metadata: Metadata = { title: "Weekform Web" };
export const dynamic = "force-dynamic";

interface WeekformWebEntryPageProps {
  searchParams: Promise<{ team_error?: string; notice?: string; screen?: string }>;
}

/** Stable public entry for the authenticated Weekform browser workspace. */
export default function WeekformWebEntryPage({
  searchParams,
}: WeekformWebEntryPageProps) {
  return <DashboardPage searchParams={searchParams} />;
}
