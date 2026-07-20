const COMPACT_PHYSICAL_WIDTH = 620;
const COMPACT_PHYSICAL_HEIGHT = 850;
const COMPACT_PHYSICAL_RIGHT_MARGIN = 16;
const COMPACT_PHYSICAL_TOP_OFFSET = 44;
const COMPACT_WINDOW_NAME = "weekform-web-compact";

interface ScreenBounds {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}

export interface WebWindowPlacement {
  width: number;
  height: number;
  left: number;
  top: number;
}

export type WebWindowSurface = "full" | "compact" | "handoff";

function normalizedScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function screenBounds(host: Window): ScreenBounds {
  const activeScreen = host.screen as Window["screen"] & {
    availLeft?: number;
    availTop?: number;
  };
  return {
    availLeft: activeScreen.availLeft ?? 0,
    availTop: activeScreen.availTop ?? 0,
    availWidth: activeScreen.availWidth,
    availHeight: activeScreen.availHeight,
  };
}

export function getCompactWebWindowPlacement({
  screen,
  devicePixelRatio,
}: {
  screen: ScreenBounds;
  devicePixelRatio: number;
}): WebWindowPlacement {
  const scale = normalizedScale(devicePixelRatio);
  const width = Math.round(COMPACT_PHYSICAL_WIDTH / scale);
  const height = Math.round(COMPACT_PHYSICAL_HEIGHT / scale);
  const rightMargin = Math.round(COMPACT_PHYSICAL_RIGHT_MARGIN / scale);
  const topOffset = Math.round(COMPACT_PHYSICAL_TOP_OFFSET / scale);

  return {
    width,
    height,
    left: Math.round(screen.availLeft + screen.availWidth - width - rightMargin),
    top: Math.round(screen.availTop + topOffset),
  };
}

export function getCompactWebWindowFeatures(placement: WebWindowPlacement): string {
  return [
    "popup=yes",
    "resizable=yes",
    "scrollbars=no",
    `width=${placement.width}`,
    `height=${placement.height}`,
    `left=${placement.left}`,
    `top=${placement.top}`,
  ].join(",");
}

export function buildCompactWebWindowUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete("window");
  url.searchParams.set("mode", "compact");
  url.searchParams.set("popup", "1");
  return url.toString();
}

export function buildWebWindowHandoffUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete("mode");
  url.searchParams.delete("popup");
  url.searchParams.set("window", "compact-host");
  return url.toString();
}

export function buildFullWebWindowUrl(currentUrl: string, screen?: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete("mode");
  url.searchParams.delete("popup");
  url.searchParams.delete("window");
  if (screen) url.searchParams.set("screen", screen);
  return url.toString();
}

export function resolveWebWindowSurface(search: string): WebWindowSurface {
  const params = new URLSearchParams(search);
  if (params.get("window") === "compact-host") return "handoff";
  return params.get("mode") === "compact" && params.get("popup") === "1"
    ? "compact"
    : "full";
}

export function openCompactWebWindow(host: Window = window): boolean {
  const placement = getCompactWebWindowPlacement({
    screen: screenBounds(host),
    devicePixelRatio: host.devicePixelRatio,
  });
  const popup = host.open(
    buildCompactWebWindowUrl(host.location.href),
    COMPACT_WINDOW_NAME,
    getCompactWebWindowFeatures(placement),
  );
  if (!popup) return false;
  popup.focus();
  host.location.replace(buildWebWindowHandoffUrl(host.location.href));
  return true;
}

export function positionCompactWebWindow(host: Window = window): void {
  const placement = getCompactWebWindowPlacement({
    screen: screenBounds(host),
    devicePixelRatio: host.devicePixelRatio,
  });
  host.resizeTo(placement.width, placement.height);
  host.moveTo(placement.left, placement.top);
}

export function restoreWebHost(screen?: string, host: Window = window): boolean {
  const opener = host.opener as Window | null;
  if (!opener || opener.closed) return false;
  opener.location.replace(buildFullWebWindowUrl(host.location.href, screen));
  opener.focus();
  host.close();
  return true;
}

export function expandCurrentWebWindow(screen?: string, host: Window = window): void {
  if (restoreWebHost(screen, host)) return;
  const activeScreen = screenBounds(host);
  host.resizeTo(activeScreen.availWidth, activeScreen.availHeight);
  host.moveTo(activeScreen.availLeft, activeScreen.availTop);
  host.location.replace(buildFullWebWindowUrl(host.location.href, screen));
}

export function restoreFullWebWindowFromHandoff(host: Window = window): void {
  const popup = host.open("", COMPACT_WINDOW_NAME);
  popup?.close();
  host.location.replace(buildFullWebWindowUrl(host.location.href));
}
