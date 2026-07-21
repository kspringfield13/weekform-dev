import type { Screen } from "../lib/types";
import { screenLabels } from "../lib/ui";

export type BrowserScreenHistoryDecision =
  | { kind: "wait" }
  | { kind: "restore" }
  | { kind: "none" }
  | { kind: "replace"; url: string }
  | { kind: "push"; url: string };

export function browserScreenHistoryDecision({
  href,
  active,
  hydrated,
  initialized,
  restoring,
}: {
  href: string;
  active: Screen;
  hydrated: boolean;
  initialized: boolean;
  restoring: boolean;
}): BrowserScreenHistoryDecision {
  if (!hydrated) return { kind: "wait" };
  const url = browserUrlForScreen(href, active);
  if (!initialized) return { kind: "replace", url };
  if (restoring) return { kind: "restore" };
  if (url === href) return { kind: "none" };
  return { kind: "push", url };
}

export function browserScreenFromSearch(search: string): Screen | null {
  const requested = new URLSearchParams(search).get("screen");
  return requested && requested in screenLabels ? requested as Screen : null;
}

export function browserUrlForScreen(href: string, screen: Screen): string {
  const url = new URL(href);
  url.searchParams.set("screen", screen);
  return url.toString();
}
