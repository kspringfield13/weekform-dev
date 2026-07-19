import type { Metadata } from "next";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { extractInviteToken } from "@/lib/invites";
import { acceptInvite, switchAccountForInvite } from "@/app/teams/actions";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { FormSubmitButton } from "@/components/FormSubmitButton";

export const metadata: Metadata = { title: "Accept invite" };

interface InvitePageProps {
  searchParams: Promise<{ token?: string; error?: string }>;
}

/**
 * Invite acceptance. Rendering this page never mutates anything — the
 * accept_team_invite RPC only runs from the explicit POST below, so link
 * prefetchers and email scanners cannot consume the one-time token.
 */
export default async function InvitePage({ searchParams }: InvitePageProps) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();
  const token = params.token ? extractInviteToken(params.token) : null;

  let signedInEmail: string | null = null;
  if (configured) {
    const supabase = await createClient();
    if (supabase) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      signedInEmail = user?.email ?? null;
    }
  }

  const returnPath = token
    ? `/invite?token=${encodeURIComponent(token)}`
    : "/invite";

  return (
    <>
      <SiteHeader />
      <main className="auth-wrap">
        <div className="container-narrow">
          <div className="auth-card">
            <h1>Team invitation</h1>
            <p>
              Join a Weekform team. You choose later, in the Mac app, which
              capacity signals (if any) to share with it.
            </p>

            {!configured ? (
              <div className="form-alert" role="alert">
                This deployment has no Supabase project configured, so
                invitations cannot be accepted here. See{" "}
                <span className="mono">apps/web/README.md</span> for setup.
              </div>
            ) : null}

            {params.error ? (
              <div className="form-alert" role="alert">
                {params.error}
              </div>
            ) : null}

            {params.token && !token ? (
              <div className="form-alert" role="alert">
                That invite link is incomplete or malformed. Paste the full
                link exactly as it was shared with you.
              </div>
            ) : null}

            {!token ? (
              <form action="/invite" method="get">
                <div className="field">
                  <label htmlFor="token">Invite link or code</label>
                  <input
                    id="token"
                    name="token"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://…/invite?token=…"
                    required
                    disabled={!configured}
                  />
                  <span className="field-hint">
                    Paste the full link (or just its token) that a team
                    manager shared with you.
                  </span>
                </div>
                <button
                  type="submit"
                  className="button button-primary button-block"
                  disabled={!configured}
                >
                  Continue
                </button>
              </form>
            ) : signedInEmail ? (
              <>
                <p>
                  You&apos;re signed in as{" "}
                  <span className="mono">{signedInEmail}</span>. Invitations
                  are tied to one email address, work once, and expire — if
                  this invite was sent to a different address, sign in with
                  that one instead.
                </p>
                <form action={acceptInvite}>
                  <input type="hidden" name="token" value={token} />
                  <FormSubmitButton
                    className="button button-primary button-block"
                    pendingLabel="Accepting invitation…"
                  >
                    Accept invitation
                  </FormSubmitButton>
                </form>
                <form action={switchAccountForInvite} className="auth-alt">
                  <input type="hidden" name="token" value={token} />
                  Wrong account?{" "}
                  <FormSubmitButton
                    className="text-link"
                    pendingLabel="Signing out…"
                    confirmMessage="Sign out and return to this invitation with a different account?"
                  >
                    Sign out and use a different email
                  </FormSubmitButton>
                </form>
              </>
            ) : (
              <>
                <p>
                  Sign in — or create an account — with the email address this
                  invite was sent to, and you&apos;ll come right back here to
                  accept it.
                </p>
                <div className="invite-auth-actions">
                  <Link
                    href={`/login?next=${encodeURIComponent(returnPath)}`}
                    className="button button-primary button-block"
                  >
                    Sign in to accept
                  </Link>
                  <Link
                    href={`/signup?next=${encodeURIComponent(returnPath)}`}
                    className="button button-secondary button-block"
                  >
                    Create an account
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
