import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
import { WeekformMark } from "@/components/WeekformMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WebEditionLabel } from "@/components/WebEditionLabel";
import { listUserTeams } from "@/lib/teams";
import { productEntry } from "@/lib/productEntry";
import { MacAppLink } from "@/components/MacAppLink";
import { hasOwnRegisteredDesktop } from "@/lib/desktopPresence";

const WEB_ENTRY = productEntry("web");
const MAC_ENTRY = productEntry("mac");

/**
 * Shared site header. Server component: reads the session (when Supabase is
 * configured) to swap the auth controls, and renders a plain marketing
 * header otherwise.
 */
interface SiteHeaderProps {
  activePage?: "account";
  variant?: "default" | "immersive";
}

export async function SiteHeader({
  activePage,
  variant = "default",
}: SiteHeaderProps) {
  const supabase = await createClient();
  let signedIn = false;
  let teamAccess = false;
  let desktopIdentified = false;

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
    if (user) {
      const [{ teams, error }, registeredDesktop] = await Promise.all([
        listUserTeams(supabase, user.id),
        hasOwnRegisteredDesktop(supabase),
      ]);
      teamAccess = !error && teams.length > 0;
      desktopIdentified = registeredDesktop;
    }
  }

  return (
    <header className={variant === "immersive" ? "site-header site-header-immersive" : "site-header"}>
      <div className="container site-header-inner">
        <Link href="/" className="wordmark" aria-label="Weekform Web home">
          <WeekformMark className="wordmark-mark" />
          <span className="wordmark-text">Weekform</span>
          <WebEditionLabel />
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {signedIn ? (
            <>
              <Link href={WEB_ENTRY.href} className="button button-ghost nav-web-app">
                <span className="nav-label-long">Web app</span>
                <span className="nav-label-short">Web</span>
              </Link>
              {teamAccess ? (
                <Link href="/manager-access" className="button button-ghost nav-manager-access">
                  <span className="nav-label-long">Team</span>
                  <span className="nav-label-short">Team</span>
                </Link>
              ) : null}
              <MacAppLink attemptAppOpen={desktopIdentified} fallbackHref={MAC_ENTRY.href} className="button button-ghost nav-download-mac">
                {desktopIdentified ? "Open Mac App" : "Download Mac"}
              </MacAppLink>
            </>
          ) : (
            <>
              <Link href="/#product" className="button button-ghost nav-product">
                Product
              </Link>
              <Link href="/#privacy" className="button button-ghost nav-privacy">
                Privacy
              </Link>
            </>
          )}
          <Link
            href="/login"
            className="button button-ghost nav-account"
            aria-current={activePage === "account" ? "page" : undefined}
          >
            Account
          </Link>
          {signedIn ? (
            <form action={signOut} className="nav-signout">
              <button type="submit" className="button button-secondary">
                Sign out
              </button>
            </form>
          ) : (
            <Link href={WEB_ENTRY.href} className="button button-primary header-cta">
              Try Web App
            </Link>
          )}
          <ThemeToggle className="site-theme-toggle" />
        </nav>
      </div>
    </header>
  );
}
