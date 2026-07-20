import Link from "next/link";
import { WeekformMark } from "@/components/WeekformMark";
import { WebEditionLabel } from "@/components/WebEditionLabel";
import { MacAppLink } from "@/components/MacAppLink";
import { productEntry } from "@/lib/productEntry";

const WEB_ENTRY = productEntry("web");
const MAC_ENTRY = productEntry("mac");

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <div className="footer-brand">
          <Link href="/" className="footer-wordmark" aria-label="Weekform Web home">
            <WeekformMark />
            <span>Weekform</span>
            <WebEditionLabel />
          </Link>
          <p>See what shaped your week. Decide what fits next.</p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <Link href="/#product">Product</Link>
          <Link href="/#privacy">Privacy</Link>
          <Link href={WEB_ENTRY.href}>Web app</Link>
          <MacAppLink fallbackHref={MAC_ENTRY.href}>Download for Mac</MacAppLink>
          <Link href="/login">Sign in</Link>
        </nav>
      </div>
      <div className="container footer-meta">
        <span>Local evidence on Mac · approved coordination on Web.</span>
        <span>Working prototype · OpenAI Build Week 2026</span>
      </div>
    </footer>
  );
}
