import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { RELEASE_INFO, formatTtl, parseArtifactConfig } from "@/lib/download";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Download for Mac",
  description:
    "Download Weekform for macOS — local workload intelligence for knowing what fits before you commit.",
};

const SOURCE_REPO_URL = "https://github.com/kspringfield13/weekform-dev";

type DownloadPageProps = {
  searchParams: Promise<{ error?: string }>;
};

function DownloadGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 2.75v9.5m0 0 3.5-3.5m-3.5 3.5-3.5-3.5M4 16.25h12" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m3.25 8.3 3 3 6.5-6.6" />
    </svg>
  );
}

function ExampleWeek() {
  return (
    <div className="download-product-preview" aria-label="Example Weekform capacity view">
      <div className="download-preview-titlebar">
        <span className="download-preview-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <span>Example week</span>
        <span className="download-preview-status">Reviewed</span>
      </div>
      <div className="download-preview-body">
        <div className="download-capacity-readout">
          <div>
            <span>Reliable capacity</span>
            <strong>6.5h</strong>
          </div>
          <p>What still fits after planned, reactive, and carryover load.</p>
        </div>
        <div className="download-capacity-track" aria-hidden="true">
          <i className="is-planned" />
          <i className="is-reactive" />
          <i className="is-fragmented" />
          <i className="is-fit" />
        </div>
        <div className="download-capacity-legend">
          <span><i className="is-planned" />Planned <b>28h</b></span>
          <span><i className="is-reactive" />Reactive <b>7.5h</b></span>
          <span><i className="is-fragmented" />Fragmented <b>3h</b></span>
          <span><i className="is-fit" />Still fits <b>6.5h</b></span>
        </div>
        <div className="download-preview-decision">
          <span>Next decision</span>
          <strong>The new analysis fits if Thursday focus stays protected.</strong>
        </div>
      </div>
    </div>
  );
}

export default async function DownloadPage({ searchParams }: DownloadPageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  if (!supabase) {
    return (
      <>
        <SiteHeader />
        <main className="container download-page download-page-unavailable">
          <div className="page-head">
            <p className="download-eyebrow">Weekform for macOS</p>
            <h1>Download access is not configured</h1>
            <p>
              This deployment needs its Weekform account service before it can
              create a private Mac download link.
            </p>
          </div>
          <div className="error-panel" role="alert">
            <h2>Account service unavailable</h2>
            <p>
              Configure the Supabase values described in{" "}
              <span className="mono">apps/web/README.md</span>, then return to
              this page.
            </p>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/download");
  }

  const artifactConfig = parseArtifactConfig(process.env);
  const downloadActionContent = (
    <>
      <DownloadGlyph />
      <span>Download now</span>
    </>
  );

  return (
    <>
      <SiteHeader />
      <main className="container download-page">
        {params.error === "artifact" ? (
          <div className="error-panel download-error" role="alert">
            <h2>The secure download link could not be created</h2>
            <p>
              The release host did not return a link. Try again shortly; no
              download or account data changed.
            </p>
          </div>
        ) : null}

        <section className="download-hero" aria-labelledby="download-title">
          <div className="download-hero-copy">
            <p className="download-eyebrow">Weekform for macOS</p>
            <h1 id="download-title">Know what fits before you commit.</h1>
            <p className="download-lede">
              Turn the work already happening on your Mac into reviewable
              evidence, explainable weekly capacity, and a clearer next
              decision. Raw activity stays local by default.
            </p>

            <div className="download-release-meta" aria-label="Release details">
              <span>{RELEASE_INFO.releaseChannel}</span>
              <span>Version {RELEASE_INFO.version}</span>
              <span>{RELEASE_INFO.architecture}</span>
            </div>

            <div className="download-action-row">
              {artifactConfig ? (
                <a
                  href="/download/artifact"
                  className="button button-primary download-primary-action"
                  aria-describedby="download-action-note"
                >
                  {downloadActionContent}
                </a>
              ) : (
                <span
                  className="button button-primary download-primary-action is-disabled"
                  aria-disabled="true"
                  aria-describedby="download-action-note"
                >
                  {downloadActionContent}
                </span>
              )}
              <span className="download-file-label">
                {RELEASE_INFO.artifactFilename}
              </span>
            </div>

            <p id="download-action-note" className="download-action-note">
              {artifactConfig
                ? `Your private link lasts ${formatTtl(artifactConfig.signedUrlTtlSeconds)}. Open the DMG, move Weekform to Applications, and launch it.`
                : "The DMG has been created locally, but this deployment does not yet have the private release bucket credentials needed to publish it."}
            </p>

            <p className="download-verification-note">
              <span aria-hidden="true">●</span>
              {RELEASE_INFO.verification}. A Developer ID certificate and Apple
              notarization are still required for warning-free launch on other Macs.
            </p>
          </div>

          <ExampleWeek />
        </section>

        <section className="download-install-strip" aria-labelledby="install-title">
          <div>
            <p className="download-section-label">Standard Mac install</p>
            <h2 id="install-title">From download to Weekform in one familiar flow.</h2>
          </div>
          <ol>
            <li><span>1</span><strong>Open the DMG</strong></li>
            <li><span>2</span><strong>Drag to Applications</strong></li>
            <li><span>3</span><strong>Open Weekform</strong></li>
          </ol>
        </section>

        <section className="download-content-section" aria-labelledby="release-notes-title">
          <div className="download-section-heading">
            <p className="download-section-label">Release notes</p>
            <h2 id="release-notes-title">What changed in {RELEASE_INFO.version}</h2>
            <p>Focused improvements to the weekly decision loop, not another dashboard layer.</p>
          </div>
          <div className="download-release-grid">
            {RELEASE_INFO.releaseNotes.map((note) => (
              <article key={note.title}>
                <span aria-hidden="true" />
                <h3>{note.title}</h3>
                <p>{note.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="download-detail-grid">
          <div className="download-detail-card">
            <p className="download-section-label">Inside the app</p>
            <h2>Built for a trustworthy weekly decision.</h2>
            <ul className="download-check-list">
              {RELEASE_INFO.features.map((feature) => (
                <li key={feature}><CheckGlyph /><span>{feature}</span></li>
              ))}
            </ul>
          </div>

          <div className="download-detail-card">
            <p className="download-section-label">First-week tips</p>
            <h2>Get a useful answer before adding more data.</h2>
            <ol className="download-tip-list">
              {RELEASE_INFO.tips.map((tip, index) => (
                <li key={tip}><span>{index + 1}</span><p>{tip}</p></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="download-trust-panel" aria-labelledby="trust-title">
          <div>
            <p className="download-section-label">Local by default</p>
            <h2 id="trust-title">Your evidence stays yours.</h2>
          </div>
          <p>
            Native capture stays on your Mac. Sharing is off by default and
            sends only the review-safe fields you preview and approve. macOS
            may request Accessibility or Screen Recording permission for
            capture; decline either and continue with manual imports.
          </p>
          <div className="download-trust-links">
            <Link href="/#privacy" className="text-link">Read the privacy overview</Link>
            <a href={SOURCE_REPO_URL} className="text-link">View public source</a>
          </div>
        </section>

        <div className="download-page-footer">
          <span>
            Version {RELEASE_INFO.version} · Generated {RELEASE_INFO.generatedDate} ·{" "}
            {RELEASE_INFO.macOsRequirement}
          </span>
          <Link href="/app" className="text-link">Back to Weekform Web</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
