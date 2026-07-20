import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";

import { CANONICAL_WEB_ORIGIN } from "@/lib/siteIdentity";

const themeInitializationScript = `
  (() => {
    const storageKey = "weekform:web-theme";
    let storedTheme = null;
    try { storedTheme = window.localStorage.getItem(storageKey); } catch {}
    const theme = storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  })();
`;

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_WEB_ORIGIN),
  title: {
    default: "Weekform — See what shaped your week",
    template: "%s · Weekform",
  },
  description:
    "Local workload intelligence for individual analysts. Review what shaped your week, understand reliable capacity, and decide what fits next.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitializationScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
