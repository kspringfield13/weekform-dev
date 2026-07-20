export type MobileNavigationFocusAction = "none" | "close" | "first" | "last";

export function resolveMobileNavigationFocusAction({
  key,
  shiftKey,
  activeIndex,
  itemCount,
}: {
  key: string;
  shiftKey: boolean;
  activeIndex: number;
  itemCount: number;
}): MobileNavigationFocusAction {
  if (key === "Escape") return "close";
  if (key !== "Tab" || itemCount <= 0) return "none";
  if (shiftKey && activeIndex <= 0) return "last";
  if (!shiftKey && (activeIndex < 0 || activeIndex >= itemCount - 1)) return "first";
  return "none";
}
