import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Weekform Web" };

/** Stable public entry for the authenticated Weekform browser workspace. */
export default function WeekformWebEntryPage() {
  redirect("/dashboard");
}
