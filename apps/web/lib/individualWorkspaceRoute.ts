export type IndividualDestination = "today" | "week" | "agent" | "history" | "settings";

export type IndividualSubview =
  | "today"
  | "capacity"
  | "forecast"
  | "review"
  | "usage"
  | "summary"
  | "agent"
  | "accelerate"
  | "skills"
  | "activity"
  | "audit"
  | "sensitive"
  | "settings";

export interface IndividualWorkspaceRoute {
  destination: IndividualDestination;
  subview: IndividualSubview;
}

const FALLBACK_ROUTE: IndividualWorkspaceRoute = {
  destination: "week",
  subview: "capacity",
};

const SCREEN_ROUTES = {
  daily: { destination: "today", subview: "today" },
  weekly: FALLBACK_ROUTE,
  forecast: { destination: "week", subview: "forecast" },
  "weekly-review": { destination: "week", subview: "review" },
  usage: { destination: "week", subview: "usage" },
  narrative: { destination: "week", subview: "summary" },
  agent: { destination: "agent", subview: "agent" },
  accelerate: { destination: "agent", subview: "accelerate" },
  skills: { destination: "agent", subview: "skills" },
  ledger: { destination: "history", subview: "activity" },
  audit: { destination: "history", subview: "audit" },
  sensitive: { destination: "history", subview: "sensitive" },
  setup: { destination: "settings", subview: "settings" },
} as const satisfies Record<string, IndividualWorkspaceRoute>;

const DEFAULT_SUBVIEWS: Record<IndividualDestination, IndividualSubview> = {
  today: "today",
  week: "capacity",
  agent: "agent",
  history: "activity",
  settings: "settings",
};

const VALID_SUBVIEWS: Record<IndividualDestination, ReadonlySet<IndividualSubview>> = {
  today: new Set(["today"]),
  week: new Set(["capacity", "forecast", "review", "usage", "summary"]),
  agent: new Set(["agent", "accelerate", "skills"]),
  history: new Set(["activity", "audit", "sensitive"]),
  settings: new Set(["settings"]),
};

function isDestination(value: unknown): value is IndividualDestination {
  return typeof value === "string" && value in DEFAULT_SUBVIEWS;
}

export function resolveIndividualWorkspaceRoute(
  input: unknown,
): IndividualWorkspaceRoute {
  if (typeof input === "string") {
    const route = SCREEN_ROUTES[input as keyof typeof SCREEN_ROUTES];
    return route ? { ...route } : { ...FALLBACK_ROUTE };
  }

  if (!input || typeof input !== "object") return { ...FALLBACK_ROUTE };
  const candidate = input as { destination?: unknown; subview?: unknown };
  if (!isDestination(candidate.destination)) return { ...FALLBACK_ROUTE };

  const defaultSubview = DEFAULT_SUBVIEWS[candidate.destination];
  if (
    typeof candidate.subview !== "string"
    || !VALID_SUBVIEWS[candidate.destination].has(candidate.subview as IndividualSubview)
  ) {
    return { destination: candidate.destination, subview: defaultSubview };
  }
  return {
    destination: candidate.destination,
    subview: candidate.subview as IndividualSubview,
  };
}

export function screenForIndividualWorkspaceRoute(
  input: IndividualWorkspaceRoute,
): keyof typeof SCREEN_ROUTES {
  const route = resolveIndividualWorkspaceRoute(input);
  const match = Object.entries(SCREEN_ROUTES).find(([, candidate]) => (
    candidate.destination === route.destination && candidate.subview === route.subview
  ));
  return (match?.[0] ?? "weekly") as keyof typeof SCREEN_ROUTES;
}
