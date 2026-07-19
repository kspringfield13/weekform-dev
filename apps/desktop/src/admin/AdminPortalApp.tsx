import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState
} from "react";
import {
  ArrowRight,
  Check,
  LogOut,
  Monitor,
  Moon,
  Settings2,
  ShieldCheck,
  Sun,
  X
} from "lucide-react";
import {
  authenticateLocalSimulatorAdmin,
  getLocalAdminPortalView,
  LOCAL_SIMULATOR_ADMIN_EMAIL,
  LOCAL_SIMULATOR_ADMIN_PASSWORD
} from "../../../../packages/simulator/src/authorization";
import { WeekformMark } from "../components/common/WeekformMark";
import { ManagerAccessWorkspace } from "./ManagerAccessWorkspace";
import {
  type AdminPortalPreferences,
  DEFAULT_ADMIN_PORTAL_PREFERENCES,
  getAdminPortalPreferencesStorage,
  getBrowserAdminPortalSessionStorage,
  readAdminPortalPreferences,
  readLocalAdminPortalSession,
  resetAdminPortalPreferences,
  writeAdminPortalPreferences,
  writeLocalAdminPortalSession,
} from "../services/adminPortal";
import "./span-simulator.css";

const LOCAL_ADMIN_PORTAL_AVAILABLE = import.meta.env.DEV;

const THEME_OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun }
] as const;

type PreferenceStatus = "idle" | "saved" | "memory-only";

interface AdminPortalHeaderProps {
  authenticated: boolean;
  onOpenSettings: () => void;
  onSignOut: () => void;
  settingsButtonRef: RefObject<HTMLButtonElement>;
}

function AdminPortalHeader({
  authenticated,
  onOpenSettings,
  onSignOut,
  settingsButtonRef
}: AdminPortalHeaderProps) {
  return (
    <header className="admin-portal-header">
      <a className="admin-portal-brand" href="/" aria-label="Return to Weekform">
        <span className="admin-portal-mark"><WeekformMark /></span>
        <span className="admin-portal-wordmark">
          <strong>Weekform</strong>
          <small>Manager Access</small>
        </span>
      </a>

      <div className="admin-portal-header-actions">
        <span className="admin-portal-environment">
          <span aria-hidden />
          {LOCAL_ADMIN_PORTAL_AVAILABLE ? "Local development" : "Production handoff"}
        </span>
        <button
          aria-label="Customize Manager Access"
          className="admin-portal-icon-button"
          onClick={onOpenSettings}
          ref={settingsButtonRef}
          title="Customize Manager Access"
          type="button"
        >
          <Settings2 size={16} aria-hidden />
        </button>
        {authenticated && (
          <button aria-label="Sign out" className="admin-portal-account-action" onClick={onSignOut} type="button">
            <LogOut size={14} aria-hidden />
            <span>Sign out</span>
          </button>
        )}
      </div>
    </header>
  );
}

interface AdminPortalSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onReset: () => void;
  onUpdate: (update: Partial<AdminPortalPreferences>) => void;
  panelRef: RefObject<HTMLDivElement>;
  preferences: AdminPortalPreferences;
  status: PreferenceStatus;
}

function AdminPortalSettings({
  isOpen,
  onClose,
  onReset,
  onUpdate,
  panelRef,
  preferences,
  status
}: AdminPortalSettingsProps) {
  if (!isOpen) return null;

  return (
    <div className="admin-settings-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        aria-labelledby="admin-settings-title"
        aria-modal="true"
        className="admin-settings-panel"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <span className="admin-portal-eyebrow">Workspace preferences</span>
            <h2 id="admin-settings-title">Make this workspace yours.</h2>
          </div>
          <button aria-label="Close customization settings" className="admin-portal-icon-button" onClick={onClose} type="button">
            <X size={17} aria-hidden />
          </button>
        </header>

        <section className="admin-settings-section" aria-labelledby="admin-settings-theme">
          <div className="admin-settings-heading">
            <h3 id="admin-settings-theme">Theme</h3>
            <span>Manager Access only</span>
          </div>
          <div className="admin-theme-options">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                aria-pressed={preferences.theme === value}
                className="admin-theme-option"
                key={value}
                onClick={() => onUpdate({ theme: value })}
                type="button"
              >
                <Icon size={16} aria-hidden />
                <span>{label}</span>
                {preferences.theme === value && <Check size={13} aria-hidden />}
              </button>
            ))}
          </div>
        </section>

        <section className="admin-settings-section" aria-labelledby="admin-settings-layout">
          <div className="admin-settings-heading">
            <h3 id="admin-settings-layout">Layout</h3>
            <span>Information density</span>
          </div>
          <div className="admin-density-options">
            {(["comfortable", "compact"] as const).map((density) => (
              <button
                aria-pressed={preferences.density === density}
                key={density}
                onClick={() => onUpdate({ density })}
                type="button"
              >
                {density === "comfortable" ? "Comfortable" : "Compact"}
              </button>
            ))}
          </div>
          <button
            aria-checked={preferences.ambientMotion}
            className="admin-motion-control"
            onClick={() => onUpdate({ ambientMotion: !preferences.ambientMotion })}
            role="switch"
            type="button"
          >
            <span>
              <strong>Ambient motion</strong>
              <small>Animate the Span signal when motion is allowed.</small>
            </span>
            <i aria-hidden><span /></i>
          </button>
        </section>

        <footer>
          <p aria-live="polite">
            {status === "memory-only"
              ? "Previewing for this visit; browser storage is unavailable."
              : status === "saved"
              ? "Preferences saved on this device."
              : "Preferences stay on this device and never affect workload data."}
          </p>
          <button className="admin-settings-reset" onClick={onReset} type="button">Reset appearance</button>
        </footer>
      </div>
    </div>
  );
}

interface AdminPortalShellProps {
  authenticated: boolean;
  children: ReactNode;
  onOpenSettings: () => void;
  onSignOut: () => void;
  preferences: AdminPortalPreferences;
  settingsButtonRef: RefObject<HTMLButtonElement>;
}

function AdminPortalShell({
  authenticated,
  children,
  onOpenSettings,
  onSignOut,
  preferences,
  settingsButtonRef
}: AdminPortalShellProps) {
  return (
    <main
      className="admin-portal-shell"
      data-admin-density={preferences.density}
      data-admin-motion={preferences.ambientMotion ? "on" : "off"}
      data-admin-theme={preferences.theme}
    >
      <div className="admin-portal-atmosphere" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <AdminPortalHeader
        authenticated={authenticated}
        onOpenSettings={onOpenSettings}
        onSignOut={onSignOut}
        settingsButtonRef={settingsButtonRef}
      />
      <div className="admin-portal-stage">{children}</div>
    </main>
  );
}

function SpanSignal() {
  return (
    <div className="admin-span-signal" aria-hidden>
      {Array.from({ length: 26 }, (_, index) => <span key={index} />)}
    </div>
  );
}

export function ManagerAccessRoot() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(() => (
    LOCAL_ADMIN_PORTAL_AVAILABLE
      && readLocalAdminPortalSession(getBrowserAdminPortalSessionStorage())
  ));
  const [preferences, setPreferences] = useState(() => (
    readAdminPortalPreferences(getAdminPortalPreferencesStorage())
  ));
  const [preferenceStatus, setPreferenceStatus] = useState<PreferenceStatus>("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const portalView = getLocalAdminPortalView(authenticated);

  useEffect(() => {
    if (!settingsOpen) return;
    const containSettingsFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const panel = settingsPanelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }

      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", containSettingsFocus);
    settingsPanelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", containSettingsFocus);
      settingsButtonRef.current?.focus();
    };
  }, [settingsOpen]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const decision = authenticateLocalSimulatorAdmin(email, password);
    if (!decision.allowed) {
      setError(decision.reason);
      return;
    }
    if (!writeLocalAdminPortalSession(getBrowserAdminPortalSessionStorage(), true)) {
      setError("Session storage is unavailable. Allow browser session storage to open local admin tools.");
      return;
    }
    setError(null);
    setPassword("");
    setAuthenticated(true);
  };

  const signOut = () => {
    writeLocalAdminPortalSession(getBrowserAdminPortalSessionStorage(), false);
    setAuthenticated(false);
    setEmail("");
    setPassword("");
    setError(null);
  };

  const updatePreferences = (update: Partial<AdminPortalPreferences>) => {
    const nextPreferences = { ...preferences, ...update };
    setPreferences(nextPreferences);
    setPreferenceStatus(
      writeAdminPortalPreferences(getAdminPortalPreferencesStorage(), nextPreferences)
        ? "saved"
        : "memory-only"
    );
  };

  const resetPreferences = () => {
    setPreferences({ ...DEFAULT_ADMIN_PORTAL_PREFERENCES });
    setPreferenceStatus(
      resetAdminPortalPreferences(getAdminPortalPreferencesStorage())
        ? "saved"
        : "memory-only"
    );
  };

  if (authenticated) {
    return (
      <main
        className="admin-portal-shell"
        data-admin-density={preferences.density}
        data-admin-motion={preferences.ambientMotion ? "on" : "off"}
        data-admin-theme={preferences.theme}
      >
        <ManagerAccessWorkspace
          onOpenPreferences={() => setSettingsOpen(true)}
          onSignOut={signOut}
        />
        <AdminPortalSettings
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onReset={resetPreferences}
          onUpdate={updatePreferences}
          panelRef={settingsPanelRef}
          preferences={preferences}
          status={preferenceStatus}
        />
      </main>
    );
  }

  let content: ReactNode;

  if (!LOCAL_ADMIN_PORTAL_AVAILABLE) {
    content = (
      <section className="admin-portal-auth-layout is-production" aria-labelledby="admin-portal-production-title">
        <div className="admin-portal-auth-story">
          <span className="admin-portal-eyebrow"><ShieldCheck size={13} aria-hidden /> Protected workspace</span>
          <h1 id="admin-portal-production-title">Manager Access starts with verified access.</h1>
          <p>Open the Weekform web app to continue through production authentication.</p>
        </div>
        <div className="admin-portal-auth-card">
          <div className="admin-portal-auth-icon"><ShieldCheck size={20} aria-hidden /></div>
          <span className="admin-portal-eyebrow">Production boundary</span>
          <h2>Manager Access</h2>
          <p>Simulator administration requires authenticated Supabase access and an explicit simulator-admin grant.</p>
          <a className="admin-portal-primary-action" href="/">Return to Weekform <ArrowRight size={15} aria-hidden /></a>
        </div>
      </section>
    );
  } else {
    content = (
      <section className="admin-portal-auth-layout" aria-labelledby="admin-portal-title">
        <div className="admin-portal-auth-story">
          <span className="admin-portal-eyebrow"><span className="admin-live-dot" aria-hidden /> Local synthetic lab</span>
          <h1 id="admin-portal-title">{portalView.heading}</h1>
          <p>{portalView.description}</p>
          <div className="admin-auth-span-preview" aria-hidden><SpanSignal /></div>
        </div>

        <div className="admin-portal-auth-card">
          <span className="admin-portal-eyebrow">Authorized access</span>
          <h2>Sign in to Manager Access</h2>
          <p>{portalView.description}</p>
          <form className="admin-portal-form" onSubmit={submit}>
            <label>
              <span>Email</span>
              <input
                autoComplete="username"
                autoFocus
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@weekform.com"
                type="email"
                value={email}
              />
            </label>
            <label>
              <span>Password</span>
              <input
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                type="password"
                value={password}
              />
            </label>
            {error && <p className="admin-portal-error" role="alert">{error}</p>}
            <button className="admin-portal-primary-action" type="submit">
              Continue to workspace <ArrowRight size={15} aria-hidden />
            </button>
          </form>

          <details className="admin-demo-credentials">
            <summary>Local demo credentials</summary>
            <div>
              <span>Email <code>{LOCAL_SIMULATOR_ADMIN_EMAIL}</code></span>
              <span>Password <code>{LOCAL_SIMULATOR_ADMIN_PASSWORD}</code></span>
            </div>
          </details>
        </div>
      </section>
    );
  }

  return (
    <AdminPortalShell
      authenticated={authenticated}
      onOpenSettings={() => setSettingsOpen(true)}
      onSignOut={signOut}
      preferences={preferences}
      settingsButtonRef={settingsButtonRef}
    >
      {content}
      <AdminPortalSettings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onReset={resetPreferences}
        onUpdate={updatePreferences}
        panelRef={settingsPanelRef}
        preferences={preferences}
        status={preferenceStatus}
      />
    </AdminPortalShell>
  );
}
