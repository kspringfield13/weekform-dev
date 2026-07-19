import type { Screen as AppScreen, WindowMode } from "../lib/types";

// Match the native Tauri compact-window contract. Browser geometry is expressed
// in CSS pixels, so divide the physical reference by the active display scale.
const COMPACT_PHYSICAL_WIDTH = 620;
const COMPACT_PHYSICAL_HEIGHT = 850;
const COMPACT_PHYSICAL_RIGHT_MARGIN = 16;
const COMPACT_PHYSICAL_TOP_OFFSET = 44;
const COMPACT_WINDOW_NAME = "weekform-compact-widget";

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

function normalizedScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
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
    `width=${placement.width}`,
    `height=${placement.height}`,
    `left=${placement.left}`,
    `top=${placement.top}`,
  ].join(",");
}

export function getCompactWebWindowUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete("window");
  url.searchParams.set("mode", "compact");
  url.searchParams.set("popup", "1");
  return url.toString();
}

export function getCompactWebHandoffUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete("mode");
  url.searchParams.delete("popup");
  url.searchParams.set("window", "compact-host");
  return url.toString();
}

export function getFullWebWindowUrl(currentUrl: string, screen?: AppScreen): string {
  const url = new URL(currentUrl);
  url.searchParams.delete("mode");
  url.searchParams.delete("popup");
  url.searchParams.delete("window");
  if (screen) url.searchParams.set("screen", screen);
  return url.toString();
}

export function getInitialWindowMode({
  search,
  isTauriRuntime,
}: {
  search: string;
  isTauriRuntime: boolean;
}): WindowMode {
  const params = new URLSearchParams(search);
  const compactRequested = params.get("mode") === "compact";
  const demoMode = params.get("demo") === "1";
  return compactRequested && (demoMode || !isTauriRuntime) ? "compact" : "large";
}

export function isTauriWindow(host: Window = window): boolean {
  return "__TAURI_INTERNALS__" in host;
}

export function isWebPopup(host: Window = window): boolean {
  return !isTauriWindow(host) && new URLSearchParams(host.location.search).get("popup") === "1";
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

export function openCompactWebWindow(host: Window = window): boolean {
  const placement = getCompactWebWindowPlacement({
    screen: screenBounds(host),
    devicePixelRatio: host.devicePixelRatio,
  });
  const popup = host.open(
    getCompactWebWindowUrl(host.location.href),
    COMPACT_WINDOW_NAME,
    getCompactWebWindowFeatures(placement)
  );
  if (!popup) return false;
  popup.focus();
  // Leave one state owner. The originating tab becomes a lightweight standby
  // surface instead of running a second App instance against the same store.
  host.location.replace(getCompactWebHandoffUrl(host.location.href));
  return true;
}

export function restoreWebHost(screen?: AppScreen, host: Window = window): boolean {
  if (!isWebPopup(host)) return false;
  const opener = host.opener as Window | null;
  if (!opener || opener.closed) return false;
  opener.location.replace(getFullWebWindowUrl(host.location.href, screen));
  opener.focus();
  host.close();
  return true;
}

export function restoreFullWebWindowFromHandoff(host: Window = window): void {
  const popup = host.open("", COMPACT_WINDOW_NAME);
  popup?.close();
  host.location.replace(getFullWebWindowUrl(host.location.href));
}

export function positionCompactWebPopup(host: Window = window): void {
  const placement = getCompactWebWindowPlacement({
    screen: screenBounds(host),
    devicePixelRatio: host.devicePixelRatio,
  });
  host.resizeTo(placement.width, placement.height);
  host.moveTo(placement.left, placement.top);
}

export function positionLargeWebPopup(host: Window = window): void {
  const screen = screenBounds(host);
  host.resizeTo(screen.availWidth, screen.availHeight);
  host.moveTo(screen.availLeft, screen.availTop);
}

export function syncWebPopupMode(mode: WindowMode, host: Window = window): void {
  if (!isWebPopup(host)) return;
  const url = new URL(host.location.href);
  if (mode === "compact") {
    url.searchParams.set("mode", "compact");
  } else {
    url.searchParams.delete("mode");
  }
  host.history.replaceState(host.history.state, "", url);
}
