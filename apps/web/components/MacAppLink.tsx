import type { AnchorHTMLAttributes, ReactNode } from "react";

type MacAppLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "onClick"
> & {
  children: ReactNode;
  fallbackHref?: string;
};

/**
 * Every Web-to-Mac action uses ordinary navigation to the authenticated
 * Download page. Web never invokes a custom protocol or asks the browser to
 * open a local application.
 */
export function MacAppLink({
  children,
  fallbackHref = "/download",
  ...anchorProps
}: MacAppLinkProps) {
  return (
    <a href={fallbackHref} {...anchorProps}>
      {children}
    </a>
  );
}
