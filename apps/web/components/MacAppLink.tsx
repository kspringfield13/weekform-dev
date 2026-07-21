"use client";

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

export const WEEKFORM_OPEN_URL = "weekform://open?source=weekform.dev";
// Chrome shows a browser-owned confirmation before opening a custom scheme the
// first time. Keep the fallback long enough for a person to read and accept it;
// accepting the prompt blurs the page and cancels this timer immediately.
const DOWNLOAD_FALLBACK_DELAY_MS = 12_000;

type MacAppLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "onClick"
> & {
  children: ReactNode;
  fallbackHref?: string;
  openUrl?: string;
  attemptAppOpen?: boolean;
};

function isMacBrowser(): boolean {
  return /Macintosh|Mac OS X/i.test(window.navigator.userAgent)
    || /Mac/i.test(window.navigator.platform);
}

/**
 * Navigates to the real download href by default. Only a server-confirmed,
 * signed-in desktop presence should opt into the native-app handoff.
 */
export function MacAppLink({
  children,
  fallbackHref = "/download",
  openUrl = WEEKFORM_OPEN_URL,
  attemptAppOpen = false,
  ...anchorProps
}: MacAppLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      !attemptAppOpen
      || !openUrl
      || event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || !isMacBrowser()
    ) {
      return;
    }

    event.preventDefault();

    let leftPage = false;
    let fallbackTimer = 0;

    const cleanup = () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("pagehide", handlePageHide);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        leftPage = true;
        cleanup();
      }
    };
    const handleBlur = () => {
      leftPage = true;
      cleanup();
    };
    const handlePageHide = () => {
      leftPage = true;
      cleanup();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur, { once: true });
    window.addEventListener("pagehide", handlePageHide, { once: true });
    fallbackTimer = window.setTimeout(() => {
      cleanup();
      if (!leftPage && document.visibilityState === "visible") {
        window.location.assign(fallbackHref);
      }
    }, DOWNLOAD_FALLBACK_DELAY_MS);

    try {
      window.location.assign(openUrl);
    } catch {
      cleanup();
      window.location.assign(fallbackHref);
    }
  }

  return (
    <a href={fallbackHref} {...anchorProps} onClick={handleClick}>
      {children}
    </a>
  );
}
