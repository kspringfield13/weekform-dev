import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";

/**
 * Shared site header. Server component: reads the session (when Supabase is
 * configured) to swap the auth controls, and renders a plain marketing
 * header otherwise.
 */
export async function SiteHeader() {
  const supabase = await createClient();
  let signedIn = false;

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
  }

  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link href="/" className="wordmark">
          <span className="wordmark-dot" aria-hidden="true" />
          Weekform
          <span className="wordmark-tag">prototype</span>
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
              <Link href="/#privacy" className="button button-ghost">
                Privacy
              </Link>
              <Link href="/login" className="button button-ghost">
                Sign in
              </Link>
              <Link href="/signup" className="button button-primary">
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
