import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { WeekformMark } from "@/components/WeekformMark";
import {
  RELEASE_INFO,
  getBetaReleasePresentation,
  getReleasePresentation,
  parseArtifactConfig,
  parseBetaArtifactConfig,
} from "@/lib/download";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Download for Mac",
  description:
    "Download Weekform for macOS — local workload intelligence for knowing what fits before you commit.",
};

const SOURCE_REPO_URL = "https://github.com/kspringfield13/weekform-dev";
const SOURCE_CLONE_COMMAND =
  "git clone --depth 1 https://github.com/kspringfield13/weekform-dev.git";
const SOURCE_START_COMMAND = "cd weekform-dev && bash start.sh";

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
  const betaArtifactConfig = parseBetaArtifactConfig(process.env);
  const officialReleasePresentation = getReleasePresentation(artifactConfig);
  const betaReleasePresentation = betaArtifactConfig
    ? getBetaReleasePresentation(betaArtifactConfig)
    : null;
  const releasePresentation = officialReleasePresentation.kind === "available"
    ? officialReleasePresentation
    : (betaReleasePresentation ?? officialReleasePresentation);

  return (
    <>
      <SiteHeader />
      <main className="container download-page download-page-minimal">
        {params.error === "artifact" ? (
          <div className="error-panel download-error" role="alert">
            <h2>The secure download link could not be created</h2>
            <p>
              The release host did not return a link. Try again shortly; no
              download or account data changed.
            </p>
          </div>
        ) : null}

        {params.error === "beta" ? (
          <div className="error-panel download-error" role="alert">
            <h2>The secure beta link could not be created</h2>
            <p>
              The private beta host did not return a link. Try again shortly;
              no download or account data changed.
            </p>
          </div>
        ) : null}

        <section
          className="download-hero download-hero-minimal"
          aria-labelledby="download-title"
        >
          <div className="download-hero-copy">
            <p className="download-eyebrow">For macOS</p>
            <h1 id="download-title" className="download-title-lockup">
              <span className="download-title-brand">
                <WeekformMark className="download-title-mark" />
                <span className="download-title-wordmark">Weekform</span>
              </span>
              <span className="download-title-product">Desktop</span>
            </h1>
            <p className="download-lede">
              Install the local-first Mac app, or continue in Weekform Web.
            </p>

            <div className="download-minimal-actions">
              {releasePresentation.kind === "pending" ? (
                <a
                  href="#source-install"
                  className="button button-primary download-primary-action"
                >
                  <DownloadGlyph />
                  <span>Install Weekform from source</span>
                </a>
              ) : (
                <Link
                  href={releasePresentation.action.href}
                  className="button button-primary download-primary-action"
                  aria-describedby={releasePresentation.kind === "beta"
                    ? "download-beta-note"
                    : "download-release-note"}
                >
                  <DownloadGlyph />
                  <span>{releasePresentation.action.label}</span>
                </Link>
              )}
              <Link
                href="/app"
                className="button button-secondary download-web-action"
              >
                Open Web App
              </Link>
            </div>

            {releasePresentation.kind === "beta" ? (
              <p id="download-beta-note" className="download-minimal-note">
                {releasePresentation.disclosure}
              </p>
            ) : null}
            {releasePresentation.kind === "available" ? (
              <p id="download-release-note" className="download-minimal-note">
                {releasePresentation.note}
              </p>
            ) : null}
          </div>
        </section>

        {releasePresentation.kind === "pending" ? (
          <section
            id="source-install"
            className="download-source-install"
            aria-labelledby="source-install-title"
          >
            <p className="download-section-label">Two commands</p>
            <h2 id="source-install-title">Paste these two commands into Terminal.</h2>
            <ol className="download-command-list">
              <li>
                <span>1</span>
                <code>{SOURCE_CLONE_COMMAND}</code>
              </li>
              <li>
                <span>2</span>
                <code>{SOURCE_START_COMMAND}</code>
              </li>
            </ol>
            <p className="download-minimal-note">
              The guided setup builds, installs, and opens Weekform Desktop.
            </p>
            <div className="download-minimal-meta">
              <span>{RELEASE_INFO.macOsRequirement}</span>
              <a href={SOURCE_REPO_URL} className="text-link">View source</a>
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}
