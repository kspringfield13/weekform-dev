import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = { title: "Sign-in problem" };

interface AuthErrorPageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function AuthErrorPage({
  searchParams,
}: AuthErrorPageProps) {
  const params = await searchParams;

  return (
    <>
      <SiteHeader />
      <main className="auth-wrap">
        <div className="container-narrow">
          <div className="auth-card">
            <h1>Something went wrong signing you in</h1>
            <p>
              The sign-in link could not be completed. Links expire and can
              only be used once.
            </p>
            {params.reason ? (
              <div className="form-alert" role="alert">
                {params.reason}
              </div>
            ) : null}
            <div className="hero-actions">
              <Link href="/login" className="button button-primary">
                Try signing in again
              </Link>
              <Link href="/" className="button button-secondary">
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
