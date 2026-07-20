import type { Metadata } from "next";
import Link from "next/link";

import {
  login,
  loginWithMagicLink,
  loginWithOAuth,
} from "@/app/auth/actions";
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

            <div className="oauth-options" aria-label="Social sign-in options">
              <form action={loginWithOAuth}>
                <input type="hidden" name="provider" value="google" />
                <input type="hidden" name="next" value={next} />
                <FormSubmitButton
                  className="button button-oauth button-oauth-google button-block"
                  disabled={!configured}
                  pendingLabel="Opening Google…"
                >
                  <span className="oauth-provider-tile" aria-hidden="true">
                    <svg className="oauth-provider-icon" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z" />
                      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.38l-3.24-2.53c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.61A10 10 0 0 0 12 22Z" />
                      <path fill="#FBBC05" d="M6.39 13.92A6.02 6.02 0 0 1 6.08 12c0-.67.11-1.32.31-1.92V7.47H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.53l3.35-2.61Z" />
                      <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.47l3.35 2.61C7.18 7.71 9.39 5.95 12 5.95Z" />
                    </svg>
                  </span>
                  <span>Continue with Google</span>
                </FormSubmitButton>
              </form>

              <form action={loginWithOAuth}>
                <input type="hidden" name="provider" value="github" />
                <input type="hidden" name="next" value={next} />
                <FormSubmitButton
                  className="button button-oauth button-oauth-github button-block"
                  disabled={!configured}
                  pendingLabel="Opening GitHub…"
                >
                  <span className="oauth-provider-tile" aria-hidden="true">
                    <svg
                      className="oauth-provider-icon"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="currentColor"
                        d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.58 9.58 0 0 1 12 6.82a9.6 9.6 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
                      />
                    </svg>
                  </span>
                  <span>Continue with GitHub</span>
                </FormSubmitButton>
              </form>
            </div>

            <div className="auth-divider" aria-hidden="true">
              <span>or use email</span>
            </div>

            <form action={loginWithMagicLink} className="magic-link-form">
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

            <details className="password-disclosure">
              <summary>
                <span>Use email and password</span>
                <svg
                  className="password-disclosure-chevron"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    d="m5.5 7.5 4.5 4.5 4.5-4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                  />
                </svg>
              </summary>
              <div className="password-disclosure-body">
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
              </div>
            </details>

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
