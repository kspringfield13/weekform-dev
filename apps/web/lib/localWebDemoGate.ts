export interface LocalWebDemoGateInput {
  enabled: string | undefined;
  host: string | null | undefined;
  nodeEnv: string | undefined;
}

export interface LocalWebDemoRequestGateInput extends LocalWebDemoGateInput {
  pathname: string;
}

const LOCAL_WEB_DEMO_PATHS = new Set(["/demo", "/demo/team"]);

export function localWebDemoEnabled({
  enabled,
  host,
  nodeEnv,
}: LocalWebDemoGateInput): boolean {
  if (nodeEnv !== "development" || enabled !== "1" || !host) return false;
  const match = /^(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?$/.exec(
    host.trim().toLowerCase(),
  );
  if (!match) return false;
  if (!match[1]) return true;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export function localWebDemoRequestEnabled({
  pathname,
  ...gate
}: LocalWebDemoRequestGateInput): boolean {
  return LOCAL_WEB_DEMO_PATHS.has(pathname) && localWebDemoEnabled(gate);
}
