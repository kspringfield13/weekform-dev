export type ProductEntry = {
  id: "web" | "mac";
  href: string;
  eyebrow: string;
  title: string;
  description: string;
  capabilities: string;
  limitations: string;
  action: string;
};

export const PRODUCT_ENTRIES: readonly ProductEntry[] = [
  {
    id: "web",
    href: "/app",
    eyebrow: "Web workspace",
    title: "Open Weekform in your browser.",
    description:
      "Review your private, review-safe workload replica, coordinate shared commitments, and use Manager Access from a signed-in browser.",
    capabilities:
      "Authenticated access to your private review-safe workspace, shared workload snapshots, teams, decisions, and Manager Access.",
    limitations:
      "The web workspace does not capture Mac activity or access native permissions; review changes require approval on your Mac.",
    action: "Open Web App",
  },
  {
    id: "mac",
    href: "/download",
    eyebrow: "Mac app",
    title: "Keep the full evidence loop local.",
    description:
      "Capture foreground activity, correct inferred work, and run Weekform's complete local workload model on your Mac.",
    capabilities:
      "Full local activity capture, reviewed work blocks, deterministic capacity, and native controls.",
    limitations:
      "The desktop application requires macOS and user-approved local permissions.",
    action: "Download for Mac",
  },
] as const;

export function productEntry(id: ProductEntry["id"]): ProductEntry {
  const entry = PRODUCT_ENTRIES.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown Weekform product entry: ${id}`);
  return entry;
}
