import type { SimulationAccessContext, SimulationAccessDecision } from "./types";

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
