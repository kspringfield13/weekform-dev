import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { RELEASE_INFO, formatTtl, parseArtifactConfig } from "@/lib/download";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = { title: "Download for Mac" };

const SOURCE_ARCHIVE_URL =
  "https://github.com/kspringfield13/weekform-dev/archive/refs/heads/main.zip";
const SOURCE_REPO_URL = "https://github.com/kspringfield13/weekform-dev";

type DownloadPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function DownloadPage({
  searchParams,
}: DownloadPageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  if (!supabase) {
    return (
      <>
        <SiteHeader />
        <main className="container">
          <div className="page-head">
            <h1>Weekform for Mac</h1>
          </div>
          <div className="error-panel" role="alert">
            <h2>Supabase is not configured</h2>
            <p>
              The authenticated download requires a configured Supabase
              project. See <span className="mono">apps/web/README.md</span> for
              setup.
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

  return (
    <>
      <SiteHeader />
      <main className="container">
        <div className="page-head">
          <h1>Weekform for Mac</h1>
          <p>
            Weekform runs on your Mac and keeps raw activity local. This page
            is where signed-in accounts get the official build — this account
            gate controls the packaged distribution path, not the source
            code, which has always been public.
          </p>
          <div className="status-line">
            <span>
              Version <span className="mono">{RELEASE_INFO.version}</span>
            </span>
            <span>Generated {RELEASE_INFO.generatedDate}</span>
          </div>
        </div>

        {params.error === "artifact" ? (
          <div className="error-panel" role="alert">
            <h2>The download link could not be created</h2>
            <p>
              Something went wrong while generating your signed download link.
              Try again shortly using the download button below.
            </p>
          </div>
        ) : null}

        {artifactConfig ? (
          <div className="panel">
            <h2>Download the packaged build</h2>
            <p>
              A signed, single-use download link is generated for your
              account when you click below. The link expires after{" "}
              {formatTtl(artifactConfig.signedUrlTtlSeconds)} — if it lapses,
              just come back to this page for a fresh one.
            </p>
            <a href="/download/artifact" className="button button-primary">
              Get weekform-{RELEASE_INFO.version}.zip
            </a>
          </div>
        ) : (
          <div className="panel">
            <h2>Packaged build — build from public source (prototype)</h2>
            <p>
              This Build Week prototype has not uploaded a signed packaged
              artifact to a private bucket yet, so this account-gated page
              links straight to the same public source Weekform has always
              published — the public GitHub repository is fully accessible;
              this gate protects the official packaged-distribution path, not
              the code itself.
            </p>
            <p>
              <a
                href={SOURCE_ARCHIVE_URL}
                className="button button-primary"
              >
                Download source archive (.zip)
              </a>{" "}
              <a href={SOURCE_REPO_URL} className="button button-secondary">
                View the repository
              </a>
            </p>
            <p className="mono" style={{ fontSize: 13 }}>
              git clone {SOURCE_REPO_URL}.git
            </p>
          </div>
        )}

        <div className="panel">
          <h2>Install steps</h2>
          <ol>
            <li>
              Unzip the source archive (or clone the repository) and open a
              terminal in the resulting folder.
            </li>
            <li>
              Run <span className="mono">npm ci</span> to install
              dependencies.
            </li>
            <li>
              Run <span className="mono">npm run desktop:dev</span> to build
              and launch the Tauri desktop app locally, or{" "}
              <span className="mono">
                CARGO_BUILD_JOBS=2 npm run desktop:build
              </span>{" "}
              to produce a local, unsigned <span className="mono">.app</span>{" "}
              bundle.
            </li>
            <li>
              Sign in to the Mac app with this same account when prompted.
            </li>
          </ol>
        </div>

        <div className="panel">
          <h2>Requirements and limitations</h2>
          <ul>
            <li>{RELEASE_INFO.macOsRequirement}.</li>
            <li>
              <strong>Source-build limitation:</strong> this prototype is not
              Apple-notarized. A locally built{" "}
              <span className="mono">.app</span> is unsigned, so macOS
              Gatekeeper will warn on first launch; right-click the app and
              choose <span className="mono">Open</span> to proceed, or clear
              the quarantine flag with{" "}
              <span className="mono">
                xattr -dr com.apple.quarantine Weekform.app
              </span>
              .
            </li>
            <li>
              <strong>Privacy permissions:</strong> macOS will ask for
              screen-recording/accessibility permission the first time
              Weekform captures foreground-app activity. This is opt-in and
              explained during onboarding — you can decline and use manual
              import instead. See{" "}
              <Link href="/" className="text-link">
                the privacy explanation on the landing page
              </Link>{" "}
              for what stays local.
            </li>
            <li>
              Raw native capture uses an encrypted journal and cloud account
              state uses macOS Keychain. Other prototype state remains
              unencrypted and is not suitable for regulated data.
            </li>
          </ul>
        </div>

        <div className="panel">
          <h2>What happens after you install</h2>
          <p>
            Sign in to the Mac app with this same account. Observation stays
            on your machine; sharing with any team is off by default and only
            ever happens after you preview and approve the exact payload.
            This download page itself collects no workload data — it is
            static release information plus your existing account session.
          </p>
        </div>

        <p className="status-line" style={{ marginTop: 20 }}>
          <Link href="/dashboard" className="text-link">
            Back to dashboard
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
