import type { Metadata } from "next";
import Link from "next/link";

import { updatePassword } from "@/app/auth/actions";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  return (
    <>
      <SiteHeader activePage="account" />
      <main className="auth-wrap">
        <div className="container-narrow">
          <div className="auth-card">
            <h1>Choose a new password</h1>
            {!user ? (
              <div className="form-alert" role="alert">
                This reset session is missing or expired. <Link href="/forgot-password" className="text-link">Request a new link</Link>.
              </div>
            ) : (
              <>
                <p>Use at least 8 characters. You’ll sign in again after the update.</p>
                {params.error ? <div className="form-alert" role="alert">{params.error}</div> : null}
                <form action={updatePassword}>
                  <div className="field">
                    <label htmlFor="new-password">New password</label>
                    <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} required aria-describedby="new-password-hint" />
                    <span id="new-password-hint" className="field-hint">At least 8 characters.</span>
                  </div>
                  <div className="field">
                    <label htmlFor="password-confirmation">Confirm password</label>
                    <input id="password-confirmation" name="password_confirmation" type="password" autoComplete="new-password" minLength={8} required />
                  </div>
                  <FormSubmitButton className="button button-primary button-block" pendingLabel="Updating password…">
                    Update password
                  </FormSubmitButton>
                </form>
              </>
            )}
            <p className="auth-alt"><Link href="/login" className="text-link">Back to sign in</Link></p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
