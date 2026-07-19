import type { Metadata, Viewport } from "next";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";

export const metadata: Metadata = {
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
