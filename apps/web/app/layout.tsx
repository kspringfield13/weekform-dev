import type { Metadata, Viewport } from "next";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Weekform — team capacity without surveillance",
    template: "%s · Weekform",
  },
  description:
    "Weekform gives each teammate private workload intelligence on their Mac and lets them share only approved capacity signals with the people coordinating the work.",
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
