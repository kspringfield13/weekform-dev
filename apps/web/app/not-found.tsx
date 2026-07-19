import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";

export default function NotFound() {
  return (
    <>
      <main className="auth-wrap">
        <div className="container-narrow">
          <div className="auth-card">
            <h1>Page not found</h1>
            <p>That page doesn&apos;t exist or has moved.</p>
            <Link href="/" className="button button-primary">
              Back to home
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
