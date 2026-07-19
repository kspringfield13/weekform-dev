import Link from "next/link";
import { WeekformMark } from "@/components/WeekformMark";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <div className="footer-brand">
          <Link href="/" className="footer-wordmark" aria-label="Weekform home">
            <WeekformMark />
            <span>Weekform</span>
          </Link>
          <p>See what shaped your week. Decide what fits next.</p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <Link href="/#product">Product</Link>
          <Link href="/#privacy">Privacy</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/signup">Create account</Link>
        </nav>
      </div>
      <div className="container footer-meta">
        <span>Local-first workload intelligence for macOS.</span>
        <span>Working prototype · OpenAI Build Week 2026</span>
      </div>
    </footer>
  );
}
