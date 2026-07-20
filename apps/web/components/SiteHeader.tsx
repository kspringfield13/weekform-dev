import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
import { WeekformMark } from "@/components/WeekformMark";
import { managerAccessMemberships } from "@/lib/managerAccess";
import { listUserTeams } from "@/lib/teams";
import { productEntry } from "@/lib/productEntry";

const WEB_ENTRY = productEntry("web");
const MAC_ENTRY = productEntry("mac");

/**
 * Shared site header. Server component: reads the session (when Supabase is
 * configured) to swap the auth controls, and renders a plain marketing
 * header otherwise.
 */
export async function SiteHeader({ variant = "default" }: { variant?: "default" | "immersive" }) {
  const supabase = await createClient();
  let signedIn = false;
  let managerAccess = false;

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
    if (user) {
      const { teams, error } = await listUserTeams(supabase, user.id);
      managerAccess = !error && managerAccessMemberships(teams).length > 0;
    }
  }

  return (
    <header className={variant === "immersive" ? "site-header site-header-immersive" : "site-header"}>
      <div className="container site-header-inner">
        <Link href="/" className="wordmark" aria-label="Weekform home">
          <WeekformMark className="wordmark-mark" />
          <span className="wordmark-text">Weekform</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {signedIn ? (
            <>
              <Link href={WEB_ENTRY.href} className="button button-ghost nav-web-app">
                <span className="nav-label-long">Web app</span>
                <span className="nav-label-short">Web</span>
              </Link>
              {managerAccess ? (
                <Link href="/manager-access" className="button button-ghost nav-manager-access">
                  <span className="nav-label-long">Manager Access</span>
                  <span className="nav-label-short">Manager</span>
                </Link>
              ) : null}
              <Link href={MAC_ENTRY.href} className="button button-ghost nav-download-mac">
                Download Mac
              </Link>
              <form action={signOut} className="nav-signout">
                <button type="submit" className="button button-secondary">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/#product" className="button button-ghost nav-product">
                Product
              </Link>
              <Link href="/#privacy" className="button button-ghost nav-privacy">
                Privacy
              </Link>
              <Link href="/login" className="button button-ghost">
                Sign in
              </Link>
              <Link href={WEB_ENTRY.href} className="button button-primary header-cta">
                Open Web app
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
