export const screenLabels: Record<string, string> = {
  setup: "Settings",
  ledger: "Activity Ledger",
  daily: "Today",
  weekly: "Weekly Capacity",
  forecast: "Weekly Forecast",
  "weekly-review": "Weekly Review",
  narrative: "Weekly Summary",
  usage: "AI Usage",
  audit: "Audit History",
  sensitive: "Flagged Captures",
  agent: "Agent",
  accelerate: "Acceleration",
  skills: "Skills Library",
  team: "Team"
};

export const sectionLabels: Record<string, string> = {
  today: "Today",
  week: "Week",
  history: "History",
  agent: "Agent"
};

// DOM ids linking the ContextNavigation tablist to the tabpanel wrapper in
// AppShell. Shared here so the two components can't drift apart on the string.
export const MAIN_TABPANEL_ID = "main-tabpanel";
export const tabId = (screen: string) => `tab-${screen}`;

export function primarySectionForScreen(screen: string): string | null {
  if (screen === "daily") return "today";
  if (screen === "weekly" || screen === "forecast" || screen === "weekly-review" || screen === "narrative" || screen === "usage") return "week";
  if (screen === "ledger" || screen === "audit" || screen === "sensitive") return "history";
  if (screen === "agent" || screen === "accelerate" || screen === "skills") return "agent";
  return null;
}

export function sectionViews(section: string | null, options?: { includeFlagged?: boolean }) {
  if (section === "week") {
    return [
      { id: "weekly" as const, label: "Capacity" },
      { id: "forecast" as const, label: "Forecast" },
      { id: "weekly-review" as const, label: "Review" },
      { id: "usage" as const, label: "AI Usage" },
      { id: "narrative" as const, label: "Summary" }
    ];
  }

  if (section === "history") {
    const views = [
      { id: "ledger" as const, label: "Activity" },
      { id: "audit" as const, label: "Audit" }
    ];
    // The Flagged queue only matters when visual context is (or was) in play —
    // hide the tab until it has something to review so History stays lean.
    if (options?.includeFlagged) {
      return [...views, { id: "sensitive" as const, label: "Flagged" }];
    }
    return views;
  }

  if (section === "agent") {
    return [
      { id: "agent" as const, label: "Ask" },
      { id: "accelerate" as const, label: "Accelerate" },
      { id: "skills" as const, label: "Skills" }
    ];
  }

  return [];
}
