import type { SimulationAccessContext, SimulationAccessDecision } from "./types";

export const SPAN_SIMULATOR_PORTAL_HREF = "/admin";
export const SPAN_SIMULATOR_ADMIN_HREF = "/admin/span-simulator?role=simulator_admin";
export const LOCAL_SIMULATOR_ADMIN_EMAIL = "span.admin@example.test";
export const LOCAL_SIMULATOR_ADMIN_PASSWORD = "Weekform-Span-2026!";

export interface SimulatorAdminNavigation {
  href: string;
  label: string;
  description: string;
  settingsTab: "account";
}

export function authorizeSimulatorAccess(context: SimulationAccessContext): SimulationAccessDecision {
  if (!context.featureEnabled) {
    return { allowed: false, reason: "Span Simulator is disabled for this build." };
  }
  if (!context.authenticated) {
    return { allowed: false, reason: "Sign in before opening Span Simulator." };
  }
  if (!context.roles.includes("simulator_admin")) {
    return { allowed: false, reason: "Span Simulator access requires the simulator_admin role." };
  }
  return { allowed: true, reason: "Simulator administrator authorized." };
}

export function getLocalSimulatorAccessContext(
  featureEnabled: boolean,
  search: string
): SimulationAccessContext {
  const role = new URLSearchParams(search).get("role");
  return {
    featureEnabled,
    authenticated: role !== null,
    roles: role === "simulator_admin" ? ["simulator_admin"] : role === "manager" ? ["manager"] : ["member"]
  };
}

export function getLocalSimulatorPortalNavigation(featureEnabled: boolean): SimulatorAdminNavigation | null {
  if (!featureEnabled) return null;
  return {
    href: SPAN_SIMULATOR_PORTAL_HREF,
    label: "Admin Portal",
    description: "Span Simulator access",
    settingsTab: "account"
  };
}

export function authenticateLocalSimulatorAdmin(
  featureEnabled: boolean,
  email: string,
  password: string
): SimulationAccessDecision {
  if (!featureEnabled) {
    return { allowed: false, reason: "The local Admin Portal is disabled for this build." };
  }
  const emailMatches = email.trim().toLowerCase() === LOCAL_SIMULATOR_ADMIN_EMAIL;
  if (!emailMatches || password !== LOCAL_SIMULATOR_ADMIN_PASSWORD) {
    return { allowed: false, reason: "The email or password was not recognized." };
  }
  return { allowed: true, reason: "Local simulator administrator authorized." };
}
