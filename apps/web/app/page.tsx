import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

const JOURNEY = [
  {
    step: "01",
    title: "Local observation",
    body: "Weekform for Mac watches your own week — calendar, foreground activity, imports — entirely on your machine. Nothing is uploaded by observing.",
  },
  {
    step: "02",
    title: "Personal review",
    body: "You confirm, relabel, or exclude inferred work blocks. The weekly capacity model is built from reviewed truth, not raw activity.",
  },
  {
    step: "03",
    title: "Approved sharing",
    body: "Sharing is off by default. If you join a team, you choose a share level and individual metrics, preview the exact payload, and approve it before anything syncs.",
  },
  {
    step: "04",
    title: "Team view",
    body: "Managers see only approved weekly capacity signals per person — with freshness and explicit “Not shared” states. No rankings, no scores.",
  },
];

const NEVER_SEEN = [
  "Raw window titles",
  "Activity evidence or samples",
  "Personal notes",
  "Screenshots or visual context",
  "Calendar event contents",
  "Chat messages or channels",
];

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="hero container">
          <p className="hero-kicker">Workload intelligence for teams</p>
          <h1>
            Know what your team can take on — without turning work into
            surveillance.
          </h1>
          <p className="hero-sub">
            Weekform gives each teammate private workload intelligence on their
            own Mac, and lets them share only approved capacity signals with
            the people coordinating the work. Raw evidence never leaves the
            member&apos;s machine.
          </p>
          <div className="hero-actions">
            <Link href="/signup" className="button button-primary">
              Create an account
            </Link>
            <Link href="#privacy" className="button button-secondary">
              How privacy works
            </Link>
          </div>
          <p className="hero-note">
            The Weekform app for macOS is available to signed-in accounts from
            the{" "}
            <Link href="/download" className="text-link">
              download page
            </Link>
            .
          </p>
        </section>

        <section className="section container" aria-labelledby="journey-title">
          <h2 className="section-title" id="journey-title">
            From private observation to a shared signal
          </h2>
          <p className="section-lede">
            Task trackers show assigned work, not the reactive, fragmented,
            meeting-heavy work that actually consumes a week. Monitoring tools
            see the real week by seizing raw activity centrally. Weekform does
            neither: consent is the architecture, not a checkbox.
          </p>
          <div className="journey-grid">
            {JOURNEY.map((item) => (
              <article className="journey-step" key={item.step}>
                <span className="journey-step-num mono">{item.step}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section container" id="privacy" aria-labelledby="privacy-title">
          <div className="never-panel">
            <h2 className="section-title" id="privacy-title">
              What managers never see
            </h2>
            <p className="section-lede">
              The cloud never receives the desktop&apos;s state — only a
              separately constructed, versioned snapshot built by an allowlist,
              previewed and approved by the member. These stay on the
              member&apos;s Mac, always:
            </p>
            <ul className="never-list">
              {NEVER_SEEN.map((item) => (
                <li key={item}>
                  <span className="never-mark" aria-hidden="true">
                    ✕
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="share-note">
              What a manager can see: a handful of approved weekly numbers per
              teammate — reliable capacity, reactive load, meeting load,
              fragmentation — each individually consented, each revocable at
              any time from the member&apos;s Mac. Omitted metrics show as
              &ldquo;Not shared,&rdquo; never as zero and never as poor
              performance.
            </p>
          </div>
        </section>

        <section className="section container" aria-labelledby="disclosure-title">
          <div className="disclosure">
            <h2 id="disclosure-title">Honest prototype disclosure</h2>
            <ul>
              <li>
                Weekform is a working prototype built for OpenAI Build Week
                2026, not a finished commercial product.
              </li>
              <li>
                Capacity weights are heuristics; local desktop storage is
                unencrypted; the saved web session uses standard browser
                cookies.
              </li>
              <li>
                Team features are in active development — some team flows on
                this site are placeholders while the shared-data schema lands.
              </li>
              <li>
                No customer logos, testimonials, or usage metrics appear here
                because none exist yet.
              </li>
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
