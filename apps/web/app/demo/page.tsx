import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { LocalWebIndividualDemo } from "@/components/LocalWebIndividualDemo";
import { createLocalWebDemoData, localWebDemoEnabled } from "@/lib/localWebDemo";

export const metadata: Metadata = {
  title: "Local demo · Weekform Web",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function LocalWebDemoPage({
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
  return <LocalWebIndividualDemo demo={createLocalWebDemoData()} initialScreen={query.screen} />;
}
