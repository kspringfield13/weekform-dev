import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
import { WeekformMark } from "@/components/WeekformMark";

/**
 * Shared site header. Server component: reads the session (when Supabase is
 * configured) to swap the auth controls, and renders a plain marketing
 * header otherwise.
 */
export async function SiteHeader({ variant = "default" }: { variant?: "default" | "immersive" }) {
  const supabase = await createClient();
  let signedIn = false;

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
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
              <Link href="/dashboard" className="button button-ghost">
                Dashboard
              </Link>
              <Link href="/download" className="button button-ghost">
                Download
              </Link>
              <form action={signOut}>
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
              <Link href="/signup" className="button button-primary header-cta">
                Get Weekform
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
