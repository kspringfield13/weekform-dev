"use client";

import { useEffect, useState } from "react";

import {
  isWebTheme,
  nextWebTheme,
  resolveWebTheme,
  WEB_THEME_CHANGE_EVENT,
  WEB_THEME_STORAGE_KEY,
  type WebTheme,
} from "@/lib/webTheme";

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 15.2A8.4 8.4 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function browserTheme(): WebTheme {
  const documentTheme = document.documentElement.dataset.theme;
  if (isWebTheme(documentTheme)) return documentTheme;

  let storedTheme: string | null = null;
  try {
    storedTheme = window.localStorage.getItem(WEB_THEME_STORAGE_KEY);
  } catch {
    // Theme selection still works for this page when storage is unavailable.
  }
  return resolveWebTheme(storedTheme);
}

function applyTheme(theme: WebTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<WebTheme>("dark");

  useEffect(() => {
    const syncTheme = () => setTheme(browserTheme());
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== WEB_THEME_STORAGE_KEY) return;
      const nextTheme = resolveWebTheme(event.newValue);
      applyTheme(nextTheme);
      setTheme(nextTheme);
    };

    syncTheme();
    window.addEventListener(WEB_THEME_CHANGE_EVENT, syncTheme);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(WEB_THEME_CHANGE_EVENT, syncTheme);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const targetTheme = nextWebTheme(theme);
  const label = `Use ${targetTheme} mode`;

  const toggleTheme = () => {
    applyTheme(targetTheme);
    setTheme(targetTheme);
    try {
      window.localStorage.setItem(WEB_THEME_STORAGE_KEY, targetTheme);
    } catch {
      // Keep the active page themed even when storage is blocked.
    }
    window.dispatchEvent(new Event(WEB_THEME_CHANGE_EVENT));
  };

  return (
    <button
      type="button"
      className={`theme-toggle-button${className ? ` ${className}` : ""}`}
      aria-label={label}
      aria-pressed={theme === "dark"}
      title={label}
      onClick={toggleTheme}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
