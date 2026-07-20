"use client";

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

const WEEKFORM_OPEN_URL = "weekform://open?source=weekform.dev";
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
};

function isMacBrowser(): boolean {
  return /Macintosh|Mac OS X/i.test(window.navigator.userAgent)
    || /Mac/i.test(window.navigator.platform);
}

/**
 * Opens an installed Weekform app on macOS and keeps a real href as the
 * progressive-enhancement and not-installed fallback.
 */
export function MacAppLink({
  children,
  fallbackHref = "/download",
  ...anchorProps
}: MacAppLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented
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
      window.location.assign(WEEKFORM_OPEN_URL);
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
