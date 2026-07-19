import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <span>
          Weekform — a local-first workload intelligence prototype. Built for
          OpenAI Build Week 2026.
        </span>
        <span>
          <Link href="/#privacy" className="text-link">
            What managers never see
          </Link>
        </span>
      </div>
    </footer>
  );
}
