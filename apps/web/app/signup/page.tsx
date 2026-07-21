import type { Metadata } from "next";
import Link from "next/link";

import { signup } from "@/app/auth/actions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { safeNextPath } from "@/lib/safeNextPath";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { FormSubmitButton } from "@/components/FormSubmitButton";

export const metadata: Metadata = { title: "Create account" };

interface SignupPageProps {
  searchParams: Promise<{ error?: string; next?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();
  const next = safeNextPath(params.next);

  return (
    <>
      <SiteHeader />
      <main className="auth-wrap">
        <div className="container-narrow">
          <div className="auth-card">
            <h1>Create your account</h1>
            <p>
              One account signs you in here and in the Weekform app for macOS.
              Sharing anything with a team stays off until you approve it on
              your Mac.
            </p>

            {!configured ? (
              <div className="form-alert" role="alert">
                This deployment has no Supabase project configured, so accounts
                are unavailable. See <span className="mono">apps/web/README.md</span>{" "}
                for setup.
              </div>
            ) : null}

            {params.error ? (
              <div className="form-alert" role="alert">
                {params.error}
              </div>
            ) : null}

            <form action={signup}>
              <input type="hidden" name="next" value={next} />
              <div className="field">
                <label htmlFor="display_name">Name</label>
                <input
                  id="display_name"
                  name="display_name"
                  type="text"
                  autoComplete="name"
                  aria-describedby="display-name-hint"
                  disabled={!configured}
                />
                <span className="field-hint" id="display-name-hint">
                  Shown to teammates if you later join a team. Optional.
                </span>
              </div>
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
                  autoComplete="new-password"
                  minLength={8}
                  required
                  aria-describedby="password-hint"
                  disabled={!configured}
                />
                <span className="field-hint" id="password-hint">At least 8 characters.</span>
              </div>
              <FormSubmitButton
                className="button button-primary button-block"
                disabled={!configured}
                pendingLabel="Creating account…"
              >
                Create account
              </FormSubmitButton>
            </form>

            <p className="auth-alt">
              Already have an account?{" "}
              <Link
                href={`/login?next=${encodeURIComponent(next)}`}
                className="text-link"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
