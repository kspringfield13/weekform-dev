"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import styles from "./admin.module.css";
import {
  resetAdminPortalPreferences,
  saveAdminPortalPreferences,
} from "./actions";
import { signOut } from "@/app/auth/actions";
import {
  DEFAULT_ADMIN_PORTAL_PREFERENCES,
  type AdminPortalPreferences,
  type SimulatorAdminAccess,
} from "@/lib/adminPortal";

interface AdminPortalClientProps {
  accessState: SimulatorAdminAccess;
  accountEmail: string | null;
  initialPreferences: AdminPortalPreferences;
  isAuthConfigured: boolean;
}

type PreferenceStatus = "idle" | "saving" | "saved" | "error";

const SIGNAL_HEIGHTS = [
  30, 38, 34, 49, 42, 55, 47, 64, 58, 71, 61, 76, 66,
  82, 72, 86, 76, 91, 81, 88, 78, 84, 72, 79, 67, 73,
];

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
] as const;

const ACCENT_OPTIONS = [
  { value: "iris", label: "Iris" },
  { value: "cobalt", label: "Cobalt" },
  { value: "ember", label: "Ember" },
] as const;

function BrandMark() {
  return (
    <svg
      aria-hidden="true"
      className={styles.brandMark}
      viewBox="-20 -20 1040 780"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="currentColor"
        d="M0 232C-2 214 10 205 29 205c23 0 38 16 43 42l6 28c5 24 20 38 42 38 26 0 42-18 46-46l8-62c4-35 27-54 57-55 35-1 60 21 64 54l9 66c3 24 20 38 44 38 26 0 41-17 43-43l6-98c2-41 29-70 64-73 39-3 74 23 79 66l8 108c2 26 14 39 31 40 21 2 35-13 36-38l4-139c1-48 31-82 67-85 41-3 73 23 77 66l6 155c1 26 16 41 38 42 23 1 38-17 39-42l2-183c0-46 31-81 70-84 46-4 81 28 82 73v200c-13 256-223 466-495 466C234 730 12 517 0 248Z"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h10M18 7h2M14 5v4M4 17h2M10 17h10M6 15v4M4 12h4M12 12h8M8 10v4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-5" />
    </svg>
  );
}

function FlaskIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9 3h6M10 3v5l-5.7 9.5A2.3 2.3 0 0 0 6.3 21h11.4a2.3 2.3 0 0 0 2-3.5L14 8V3M7 15h10" />
    </svg>
  );
}

function SignalFigure({ motion }: { motion: boolean }) {
  return (
    <figure className={styles.signalFigure}>
      <div className={styles.signalHeading}>
        <span>Deterministic test span</span>
        <strong>26 weeks</strong>
      </div>
      <div
        aria-label="A synthetic 26-week workload signal that rises, peaks, and tapers"
        className={styles.signalChart}
        role="img"
      >
        {SIGNAL_HEIGHTS.map((height, index) => (
          <i
            className={styles.signalBar}
            key={`${height}-${index}`}
            style={
              {
                "--bar-height": `${height}%`,
                "--bar-index": index,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <figcaption>
        <span>Week 01</span>
        <span className={styles.signalLegend}>
          <i aria-hidden="true" /> Synthetic evidence only
        </span>
        <span>Week 26</span>
      </figcaption>
      {!motion ? (
        <span className={styles.srOnly}>Ambient chart motion is off.</span>
      ) : null}
    </figure>
  );
}

function AccessPanel({
  accessState,
  isAuthConfigured,
}: Pick<AdminPortalClientProps, "accessState" | "isAuthConfigured">) {
  if (accessState === "forbidden") {
    return (
      <section className={styles.accessPanel} aria-labelledby="access-title">
        <span className={styles.accessIcon}><ShieldIcon /></span>
        <div>
          <p className={styles.eyebrow}>Access boundary</p>
          <h2 id="access-title">An explicit simulator grant is required.</h2>
          <p>
            Your Weekform account is valid, but team ownership and profile
            metadata never confer simulator access. Ask a maintainer to add the
            account to the isolated simulator-admin registry.
          </p>
          <div className={styles.panelActions}>
            <Link className={styles.primaryButton} href="/dashboard">
              Open dashboard
            </Link>
            <Link className={styles.textButton} href="/">
              Return to Weekform
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.accessPanel} aria-labelledby="access-title">
      <span className={styles.accessIcon}><ShieldIcon /></span>
      <div>
        <p className={styles.eyebrow}>Connection status</p>
        <h2 id="access-title">
          {isAuthConfigured
            ? "Admin authorization could not be verified."
            : "Production authorization is not connected yet."}
        </h2>
        <p>
          {isAuthConfigured
            ? "The portal failed closed because its current-user admin check is unavailable. No administration tools or simulator data were exposed."
            : "This deployment is missing its Supabase public URL and publishable key. The route is live, but accounts and administration tools remain locked until production authentication is configured."}
        </p>
        <div className={styles.panelActions}>
          {isAuthConfigured ? (
            <Link className={styles.primaryButton} href="/admin">
              Check authorization again
            </Link>
          ) : null}
          <Link className={styles.textButton} href="/">
            Return to Weekform
          </Link>
        </div>
      </div>
    </section>
  );
}

function ToolPanel() {
  return (
    <section className={styles.toolsSection} aria-labelledby="tools-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Administration tools</p>
          <h2 id="tools-title">Synthetic workload lab</h2>
        </div>
        <span className={styles.toolCount}>1 local tool</span>
      </div>

      <article className={styles.toolCard}>
        <span className={styles.toolIcon}><FlaskIcon /></span>
        <div className={styles.toolCopy}>
          <div className={styles.toolTitleRow}>
            <h3>Span Simulator</h3>
            <span className={styles.localBadge}>Desktop sandbox</span>
          </div>
          <p>
            Generate deterministic, synthetic workload histories and review
            how Weekform&apos;s capacity model responds across a controlled span.
          </p>
          <ul className={styles.toolFacts}>
            <li>Seeded and reproducible</li>
            <li>Synthetic data only</li>
            <li>Approval-gated deletion</li>
          </ul>
        </div>
        <div className={styles.toolAvailability}>
          <span><i aria-hidden="true" /> Local execution</span>
          <strong>Not connected to production</strong>
        </div>
      </article>

      <details className={styles.launchDetails}>
        <summary>How to launch the simulator safely</summary>
        <div>
          <p>
            Run the Weekform development workspace locally, open its
            <span className={styles.mono}> /admin</span> route, then authenticate
            with the local simulator-admin flow. Production execution remains
            intentionally disabled until its full audited backend path ships.
          </p>
          <code>npm run dev</code>
        </div>
      </details>
    </section>
  );
}

interface SettingsDialogProps {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  onReset: () => void;
  onUpdate: (update: Partial<AdminPortalPreferences>) => void;
  preferences: AdminPortalPreferences;
  status: PreferenceStatus;
}

function SettingsDialog({
  dialogRef,
  onReset,
  onUpdate,
  preferences,
  status,
}: SettingsDialogProps) {
  return (
    <dialog
      aria-labelledby="admin-settings-title"
      className={styles.settingsDialog}
      ref={dialogRef}
    >
      <div className={styles.settingsInner}>
        <header className={styles.settingsHeader}>
          <div>
            <p className={styles.eyebrow}>Workspace preferences</p>
            <h2 id="admin-settings-title">Make this workspace yours.</h2>
          </div>
          <button
            aria-label="Close customization settings"
            className={styles.iconButton}
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <CloseIcon />
          </button>
        </header>

        <fieldset className={styles.settingsGroup}>
          <legend>Theme</legend>
          <span>Portal only</span>
          <div className={styles.optionGrid}>
            {THEME_OPTIONS.map((option) => (
              <label key={option.value}>
                <input
                  checked={preferences.theme === option.value}
                  name="admin-theme"
                  onChange={() => onUpdate({ theme: option.value })}
                  type="radio"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.settingsGroup}>
          <legend>Signal accent</legend>
          <span>Color never carries access meaning</span>
          <div className={styles.accentGrid}>
            {ACCENT_OPTIONS.map((option) => (
              <label data-preview={option.value} key={option.value}>
                <input
                  checked={preferences.accent === option.value}
                  name="admin-accent"
                  onChange={() => onUpdate({ accent: option.value })}
                  type="radio"
                />
                <i aria-hidden="true" />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.settingsGroup}>
          <legend>Information density</legend>
          <span>Adjust spacing, not content</span>
          <div className={styles.optionGrid}>
            {(["comfortable", "compact"] as const).map((density) => (
              <label key={density}>
                <input
                  checked={preferences.density === density}
                  name="admin-density"
                  onChange={() => onUpdate({ density })}
                  type="radio"
                />
                <span>{density === "comfortable" ? "Comfortable" : "Compact"}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className={styles.switchRow}>
          <span>
            <strong>Ambient signal motion</strong>
            <small>Reduced-motion preferences always take priority.</small>
          </span>
          <input
            checked={preferences.ambientMotion}
            onChange={(event) => onUpdate({ ambientMotion: event.target.checked })}
            role="switch"
            type="checkbox"
          />
          <i aria-hidden="true"><span /></i>
        </label>

        <footer className={styles.settingsFooter}>
          <p aria-live="polite">
            {status === "saving"
              ? "Saving appearance…"
              : status === "saved"
                ? "Appearance saved on this browser."
                : status === "error"
                  ? "Appearance could not be saved; this preview remains active."
                  : "Only this portal's appearance is stored—never workload data."}
          </p>
          <button className={styles.resetButton} onClick={onReset} type="button">
            Reset appearance
          </button>
        </footer>
      </div>
    </dialog>
  );
}

export function AdminPortalClient({
  accessState,
  accountEmail,
  initialPreferences,
  isAuthConfigured,
}: AdminPortalClientProps) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [preferenceStatus, setPreferenceStatus] =
    useState<PreferenceStatus>("idle");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveRevisionRef = useRef(0);

  function queuePreferenceSave(next: AdminPortalPreferences) {
    const revision = ++saveRevisionRef.current;
    setPreferenceStatus("saving");
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveAdminPortalPreferences(next))
      .then(() => {
        if (saveRevisionRef.current === revision) setPreferenceStatus("saved");
      })
      .catch(() => {
        if (saveRevisionRef.current === revision) setPreferenceStatus("error");
      });
  }

  function updatePreferences(update: Partial<AdminPortalPreferences>) {
    const next = { ...preferences, ...update };
    setPreferences(next);
    queuePreferenceSave(next);
  }

  function resetPreferences() {
    const next = { ...DEFAULT_ADMIN_PORTAL_PREFERENCES };
    setPreferences(next);
    const revision = ++saveRevisionRef.current;
    setPreferenceStatus("saving");
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => resetAdminPortalPreferences())
      .then(() => {
        if (saveRevisionRef.current === revision) setPreferenceStatus("saved");
      })
      .catch(() => {
        if (saveRevisionRef.current === revision) setPreferenceStatus("error");
      });
  }

  const isAuthorized = accessState === "authorized";
  const title = isAuthorized
    ? "A quieter command surface for synthetic workload operations."
    : accessState === "forbidden"
      ? "This workspace is intentionally narrow."
      : "The portal is here. Authorization is not connected yet.";

  return (
    <div
      className={styles.shell}
      data-accent={preferences.accent}
      data-density={preferences.density}
      data-motion={preferences.ambientMotion ? "on" : "off"}
      data-theme={preferences.theme}
    >
      <header className={styles.portalHeader}>
        <Link className={styles.brand} href="/" aria-label="Weekform home">
          <span className={styles.brandGlyph}><BrandMark /></span>
          <span>
            <strong>Weekform</strong>
            <small>Manager Access</small>
          </span>
        </Link>

        <div className={styles.headerActions}>
          <span className={styles.environmentBadge}>
            <i aria-hidden="true" /> Production boundary
          </span>
          <button
            aria-label="Customize Manager Access"
            className={styles.iconButton}
            onClick={() => dialogRef.current?.showModal()}
            title="Customize Manager Access"
            type="button"
          >
            <SettingsIcon />
          </button>
          {accountEmail ? (
            <form action={signOut}>
              <button className={styles.signOutButton} type="submit">Sign out</button>
            </form>
          ) : null}
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="admin-portal-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span aria-hidden="true" /> Weekform Manager Access
            </p>
            <h1 id="admin-portal-title">{title}</h1>
            <p className={styles.heroDescription}>
              Review the access boundary first, then enter tools built for
              deterministic synthetic evidence—not production people data.
            </p>

            <div className={styles.boundaryRow} aria-label="Portal boundaries">
              <span><ShieldIcon /> Explicit grant</span>
              <span><ShieldIcon /> Synthetic only</span>
              <span><ShieldIcon /> No team-role fallback</span>
            </div>
          </div>

          <SignalFigure motion={preferences.ambientMotion} />
        </section>

        <div className={styles.sessionStrip}>
          <div>
            <span className={styles.sessionStatus} data-state={accessState}>
              <i aria-hidden="true" />
              {isAuthorized
                ? "Simulator admin verified"
                : accessState === "forbidden"
                  ? "Signed in · access not granted"
                  : "Authorization unavailable"}
            </span>
            {accountEmail ? <span className={styles.account}>{accountEmail}</span> : null}
          </div>
          <span className={styles.sessionNote}>Request-fresh · fail-closed</span>
        </div>

        {isAuthorized ? (
          <ToolPanel />
        ) : (
          <AccessPanel
            accessState={accessState}
            isAuthConfigured={isAuthConfigured}
          />
        )}
      </main>

      <footer className={styles.portalFooter}>
        <span>Weekform Manager Access</span>
        <span>Know what fits before you commit.</span>
      </footer>

      <SettingsDialog
        dialogRef={dialogRef}
        onReset={resetPreferences}
        onUpdate={updatePreferences}
        preferences={preferences}
        status={preferenceStatus}
      />
    </div>
  );
}
