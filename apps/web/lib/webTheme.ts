export type WebTheme = "light" | "dark";

export const WEB_THEME_STORAGE_KEY = "weekform:web-theme";
export const WEB_THEME_CHANGE_EVENT = "weekform:web-theme-change";

export function isWebTheme(value: unknown): value is WebTheme {
  return value === "light" || value === "dark";
}

export function resolveWebTheme(storedTheme: string | null): WebTheme {
  if (isWebTheme(storedTheme)) return storedTheme;
  return "dark";
}

export function nextWebTheme(theme: WebTheme): WebTheme {
  return theme === "dark" ? "light" : "dark";
}
