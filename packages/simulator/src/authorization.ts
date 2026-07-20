import type { SimulationAccessContext, SimulationAccessDecision } from "./types";

export const SIMULATION_ADMIN_HREF = "/manager-access/simulation";
/** Compatibility export retained for callers compiled against the original name. */
export const SPAN_SIMULATOR_ADMIN_HREF = SIMULATION_ADMIN_HREF;
export const LOCAL_SIMULATOR_ADMIN_EMAIL = "span.admin@example.test";
export const LOCAL_SIMULATOR_ADMIN_PASSWORD = "Weekform-Span-2026!";

export interface LocalAdminPortalTool {
  href: string;
  label: string;
  description: string;
}

export interface LocalAdminPortalView {
  heading: "Welcome to Manager Access";
  description: string;
  tools: LocalAdminPortalTool[];
}

export function getLocalAdminPortalView(authenticated: boolean): LocalAdminPortalView {
  return {
    heading: "Welcome to Manager Access",
    description: authenticated
      ? "Move between your individual Weekform view, team intelligence, and administration tools."
      : "Sign in to open your individual workspace and approval-scoped manager tools.",
    tools: authenticated
      ? [{
          href: SPAN_SIMULATOR_ADMIN_HREF,
          label: "Simulation",
          description: "Generate realistic spans or watch a live synthetic work session."
        }]
      : []
  };
}

export function authorizeSimulatorAccess(context: SimulationAccessContext): SimulationAccessDecision {
  if (!context.authenticated) {
    return { allowed: false, reason: "Sign in before opening Simulation." };
  }
  if (!context.roles.includes("simulator_admin")) {
    return { allowed: false, reason: "Simulation access requires the simulator_admin role." };
  }
  return { allowed: true, reason: "Simulator administrator authorized." };
}

export function getLocalSimulatorAccessContext(
  authenticated: boolean
): SimulationAccessContext {
  return {
    authenticated,
    roles: authenticated ? ["simulator_admin"] : ["member"]
  };
}

export function authenticateLocalSimulatorAdmin(
  email: string,
  password: string
): SimulationAccessDecision {
  const emailMatches = email.trim().toLowerCase() === LOCAL_SIMULATOR_ADMIN_EMAIL;
  if (!emailMatches || password !== LOCAL_SIMULATOR_ADMIN_PASSWORD) {
    return { allowed: false, reason: "The email or password was not recognized." };
  }
  return { allowed: true, reason: "Local simulator administrator authorized." };
}
