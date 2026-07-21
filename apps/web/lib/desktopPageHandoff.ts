import {
  screenForIndividualWorkspaceRoute,
  type IndividualWorkspaceRoute,
} from "./individualWorkspaceRoute";

export type WebWorkspaceMode = "individual" | "manager" | "team";

export function desktopPageHandoffUrl(
  route: IndividualWorkspaceRoute,
  mode: WebWorkspaceMode,
): string {
  const screen = mode === "individual"
    ? screenForIndividualWorkspaceRoute(route)
    : "team";
  return `weekform://open?source=weekform.dev&view=large&screen=${screen}`;
}
