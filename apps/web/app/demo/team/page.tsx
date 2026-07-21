import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { LocalWebTeamDemo } from "@/components/LocalWebTeamDemo";
import { createLocalWebDemoData, localWebDemoEnabled } from "@/lib/localWebDemo";

export const metadata: Metadata = {
  title: "Local Team demo · Weekform Web",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function LocalWebTeamDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string }>;
}) {
  const requestHeaders = await headers();
  if (!localWebDemoEnabled({
    enabled: process.env.WEEKFORM_WEB_LOCAL_DEMO,
    host: requestHeaders.get("host"),
    nodeEnv: process.env.NODE_ENV,
  })) {
    notFound();
  }

  const query = await searchParams;
  return <LocalWebTeamDemo demo={createLocalWebDemoData()} initialScreen={query.screen} />;
}
