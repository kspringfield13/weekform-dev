export const WEB_ONBOARDING_VERSION = "v1";

export type WebOnboardingStepId =
  | "tour"
  | "overview"
  | "review"
  | "teams"
  | "manager"
  | "sharing"
  | "boundary"
  | "ready";

export interface WebOnboardingStep {
  id: WebOnboardingStepId;
  title: string;
  body: string;
  target?: string;
}

const INDIVIDUAL_STEPS: readonly WebOnboardingStep[] = [
  {
    id: "tour",
    title: "Let's take a quick tour",
    body: "Weekform Web is the review-safe browser companion to Weekform for Mac. It helps you decide from approved workload signals without pretending the browser can capture native activity.",
  },
  {
    id: "overview",
    title: "Your decision surface",
    body: "Start with the state of your week, what needs attention, and the next useful action. The Web workspace stays focused on decisions rather than reproducing every desktop control.",
    target: "#workspace-overview",
  },
  {
    id: "review",
    title: "Review safely",
    body: "Your private replica contains only review-safe derived fields. Confirm, exclude, or relabel requests are sent back to your Mac for approval before local truth changes.",
    target: "#personal-workspace",
  },
  {
    id: "teams",
    title: "Teams are optional",
    body: "Create a team or accept an invitation when coordination is useful. Nothing is shared merely because you joined a team.",
    target: "#teams",
  },
  {
    id: "sharing",
    title: "See exactly what is shared",
    body: "This area shows the approved snapshot each team can currently see. Missing signals remain missing; Weekform never turns an unshared metric into a reassuring zero.",
    target: "#sharing",
  },
  {
    id: "boundary",
    title: "The Mac remains the evidence source",
    body: "Native capture, raw evidence, retention, and consequential review changes remain on your Mac. The browser coordinates approved summaries and requests; it does not silently become a recorder.",
  },
  {
    id: "ready",
    title: "You're all set",
    body: "Open your private review workspace first. If no replica is present yet, Weekform will show the exact Mac setup step instead of an empty or fake dashboard.",
  },
];

const MANAGER_STEP: WebOnboardingStep = {
  id: "manager",
  title: "Manager Access",
  body: "Manager Mode is a separate coordination view built only from member-approved summaries. Use it for briefings and approval-gated actions—never ranking, raw activity, or surveillance.",
  target: "#manager-entry",
};

export function webOnboardingSteps(hasManagerAccess: boolean): WebOnboardingStep[] {
  const steps = [...INDIVIDUAL_STEPS];
  if (hasManagerAccess) {
    const sharingIndex = steps.findIndex((step) => step.id === "sharing");
    steps.splice(sharingIndex, 0, MANAGER_STEP);
  }
  return steps;
}

export function webOnboardingStorageKey(userId: string): string {
  return `weekform.web-onboarding.${WEB_ONBOARDING_VERSION}.${userId}`;
}
