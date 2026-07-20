export const INDIVIDUAL_SETTINGS_TABS = [
  "data-sources",
  "data-control",
  "ai-assistance",
  "ai-usage",
  "notifications",
  "account",
] as const;

export type IndividualSettingsTab = (typeof INDIVIDUAL_SETTINGS_TABS)[number];

const SETTINGS_TAB_ALLOWLIST = new Set<string>(INDIVIDUAL_SETTINGS_TABS);

export function resolveIndividualSettingsTab(value: unknown): IndividualSettingsTab {
  return typeof value === "string" && SETTINGS_TAB_ALLOWLIST.has(value)
    ? value as IndividualSettingsTab
    : "data-sources";
}

export function buildIndividualSettingsUrl(currentHref: string | URL, value: unknown): URL {
  const url = new URL(currentHref);
  url.searchParams.set("screen", "setup");
  url.searchParams.set("settings_tab", resolveIndividualSettingsTab(value));
  return url;
}

export function shouldPushIndividualSettingsTab(currentHref: string | URL, value: unknown): boolean {
  const current = new URL(currentHref);
  const tab = resolveIndividualSettingsTab(value);
  return current.searchParams.get("screen") !== "setup"
    || current.searchParams.get("settings_tab") !== tab;
}
