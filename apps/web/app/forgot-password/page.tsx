import type { Metadata } from "next";
import Link from "next/link";

import { requestPasswordReset } from "@/app/auth/actions";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Reset password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();
  return (
    <>
      <SiteHeader activePage="account" />
      <main className="auth-wrap">
        <div className="container-narrow">
          <div className="auth-card">
            <h1>Reset your password</h1>
            <p>Enter your account email. The reset link is time-limited.</p>
            {!configured ? <div className="form-alert" role="alert">{NOT_CONFIGURED_COPY}</div> : null}
            {params.error ? <div className="form-alert" role="alert">{params.error}</div> : null}
            {params.notice ? <div className="form-notice" role="status">{params.notice}</div> : null}
            <form action={requestPasswordReset}>
              <div className="field">
                <label htmlFor="recovery-email">Email</label>
                <input
                  id="recovery-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={!configured}
                />
              </div>
              <FormSubmitButton
                className="button button-primary button-block"
                disabled={!configured}
                pendingLabel="Sending reset link…"
              >
                Send reset link
              </FormSubmitButton>
            </form>
            <p className="auth-alt"><Link href="/login" className="text-link">Back to sign in</Link></p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

const NOT_CONFIGURED_COPY = "This deployment has no account service configured, so password reset is unavailable.";
