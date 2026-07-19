import type { Metadata } from "next";
import Link from "next/link";

import { login, loginWithMagicLink } from "@/app/auth/actions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { safeNextPath } from "@/lib/safeNextPath";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { FormSubmitButton } from "@/components/FormSubmitButton";

export const metadata: Metadata = { title: "Sign in" };

interface LoginPageProps {
  searchParams: Promise<{ error?: string; notice?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();
  const next = safeNextPath(params.next);

  return (
    <>
      <SiteHeader />
      <main className="auth-wrap">
        <div className="container-narrow">
          <div className="auth-card">
            <h1>Sign in</h1>
            <p>Access your dashboard and the Weekform app for macOS.</p>

            {!configured ? (
              <div className="form-alert" role="alert">
                This deployment has no Supabase project configured, so accounts
                are unavailable. See <span className="mono">apps/web/README.md</span>{" "}
                for setup.
              </div>
            ) : null}

            {params.notice ? (
              <div className="form-notice" role="status">
                {params.notice}
              </div>
            ) : null}

            {params.error ? (
              <div className="form-alert" role="alert">
                {params.error}
              </div>
            ) : null}

            <form action={loginWithMagicLink}>
              <input type="hidden" name="next" value={next} />
              <div className="field">
                <label htmlFor="magic-link-email">Email</label>
                <input
                  id="magic-link-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={!configured}
                />
              </div>
              <FormSubmitButton
                className="button button-secondary button-block"
                disabled={!configured}
                pendingLabel="Sending link…"
              >
                Email me a sign-in link
              </FormSubmitButton>
            </form>

            <div className="auth-divider" aria-hidden="true">
              <span>or use a password</span>
            </div>

            <form action={login}>
              <input type="hidden" name="next" value={next} />
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={!configured}
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={!configured}
                />
              </div>
              <FormSubmitButton
                className="button button-primary button-block"
                disabled={!configured}
                pendingLabel="Signing in…"
              >
                Sign in
              </FormSubmitButton>
            </form>

            <p className="auth-alt">
              New to Weekform?{" "}
              <Link
                href={`/signup?next=${encodeURIComponent(next)}`}
                className="text-link"
              >
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
