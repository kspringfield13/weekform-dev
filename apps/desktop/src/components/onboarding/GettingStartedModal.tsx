import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Lock,
  Radio,
  Settings,
  Sparkles,
  Timer,
} from "lucide-react";
import { WeekformMark } from "../common/WeekformMark";
import { GETTING_STARTED_STEP_IDS } from "../../services/gettingStartedFlow";

/**
 * First-run setup wizard. Its opening step is the branded introduction, followed
 * by the key tracking settings (tracking on/off, retention window, and optional
 * AI). The final step hands the user to Settings, where they can review the full
 * product controls and choose whether to replay the guided walkthrough.
 *
 * The wizard is deliberately stateless about the settings it configures:
 * `paused`/`retentionDays` are the app's live values and the change handlers are
 * the same audited paths Settings uses, so anything set here shows up in
 * Settings (and the audit trail) exactly as if it was set there.
 */

// Mirrors SetupScreen's RETENTION_OPTIONS so the wizard offers the same windows.
const RETENTION_CHOICES = [7, 14, 30, 90] as const;

export function GettingStartedModal({
  paused,
  retentionDays,
  aiConfigured,
  usingCodexPlan,
  envOpenAiKeyPresent,
  onEnableTracking,
  onRetentionDaysChange,
  onConnectOpenAiKey,
  onConnectViaCodexPlan,
  onDismiss,
}: {
  /** Live tracking state — the tracking step flips to its confirmation state when false. */
  paused: boolean;
  /** Live retention window (null = keep everything). */
  retentionDays: number | null;
  /** Whether an AI provider is already connected in Settings. */
  aiConfigured: boolean;
  /** Whether that connection uses OpenAI-managed Codex app-server auth. */
  usingCodexPlan: boolean;
  /** An OPENAI_API_KEY was found in the environment (.env) — AI calls already work. */
  envOpenAiKeyPresent: boolean;
  /** Turn tracking on (same audited path as the toolbar toggle). */
  onEnableTracking: () => void;
  /** Change the retention window (same audited path as Settings). */
  onRetentionDaysChange: (value: number | null) => void;
  /** Save a pasted OpenAI API key as the provider config (OpenAI defaults). */
  onConnectOpenAiKey: (apiKey: string) => void;
  /** Sign in through the Codex app-server; Weekform never receives OAuth tokens. */
  onConnectViaCodexPlan: () => Promise<string>;
  /** Close the wizard and continue to Settings. */
  onDismiss: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [codexBusy, setCodexBusy] = useState(false);
  const [aiConnectError, setAiConnectError] = useState<string | null>(null);

  const connectPastedKey = () => {
    const key = apiKeyDraft.trim();
    if (!key) return;
    setAiConnectError(null);
    onConnectOpenAiKey(key);
    setApiKeyDraft("");
  };

  const connectViaCodexPlan = async () => {
    setCodexBusy(true);
    setAiConnectError(null);
    try {
      await onConnectViaCodexPlan();
    } catch (error) {
      setAiConnectError(error instanceof Error ? error.message : String(error));
    } finally {
      setCodexBusy(false);
    }
  };
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const stepTitleId = `${baseId}-step-title`;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === GETTING_STARTED_STEP_IDS.length - 1;
  const step = GETTING_STARTED_STEP_IDS[stepIndex];

  // Mirror WalkthroughOverlay's a11y baseline: move focus onto the primary
  // action on mount, restore it to whatever had focus on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    primaryButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Keep focus on the primary nav button as steps change (the previous button
  // may have unmounted, which would drop focus to the body inside the trap).
  useEffect(() => {
    primaryButtonRef.current?.focus();
  }, [stepIndex]);

  // Escape dismisses the wizard; the app derives the skipped/enabled outcome
  // from the live tracking state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // Trap Tab/Shift+Tab within the card while the modal is open (mirrors
  // WalkthroughOverlay / ConfirmDialog).
  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="getting-started"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={stepTitleId}
    >
      <div className="getting-started-backdrop" aria-hidden="true" />
      <div ref={cardRef} className="getting-started-card" onKeyDown={handleCardKeyDown}>
        {step !== "intro" && (
          <header className="getting-started-header">
            <h1 className="getting-started-title" id={titleId}>
              You&rsquo;re Ready to Begin
            </h1>
            <p className="getting-started-intro">
              A quick setup — every choice here can be changed later in Settings.
            </p>
          </header>
        )}

        {/* Keyed by step so each pane re-mounts and plays its enter transition. */}
        <div
          className={`getting-started-step${step === "intro" ? " is-intro" : ""}`}
          key={step}
        >
          {step === "intro" && (
            <>
              <span className="welcome-mark" aria-hidden="true">
                <WeekformMark className="welcome-mark-svg" />
              </span>
              <h1 className="welcome-title" id={titleId}>
                Welcome to Weekform
              </h1>
              <p className="welcome-tagline" id={stepTitleId}>
                Local-first workload intelligence. See where your week actually goes — your
                activity stays on this Mac.
              </p>
              <p className="welcome-footnote">
                A one-minute setup comes next. The guided walkthrough is available from Settings.
              </p>
            </>
          )}

          {step === "privacy" && (
            <section className="getting-started-section">
              <span className="getting-started-icon" aria-hidden="true">
                <Lock size={17} />
              </span>
              <div>
                <h2 id={stepTitleId}>Private by design</h2>
                <p>
                  Everything Weekform observes — app names, window titles, sessions, and your
                  review decisions — stays on this Mac. There are no accounts and nothing is
                  uploaded. The goal is insight into your workload, focus, and capacity. Never
                  surveillance.
                </p>
                <p>
                  The one exception is optional AI assistance: if you connect a provider later,
                  the feature-specific prompt is sent only when that feature runs. Classification
                  can include app names and window titles; opt-in Visual Context can include a
                  screenshot. Review the privacy controls before enabling either.
                </p>
              </div>
            </section>
          )}

          {step === "tracking" && (
            <section className="getting-started-section">
              <span className={`getting-started-icon${paused ? "" : " is-on"}`} aria-hidden="true">
                {paused ? <Radio size={17} /> : <Check size={17} />}
              </span>
              <div>
                <h2 id={stepTitleId}>Turn on activity tracking</h2>
                {paused ? (
                  <>
                    <p>
                      Tracking is how Weekform builds your weekly picture — it quietly notices
                      which app and window are in front and turns that into work sessions. The
                      first time it runs, macOS may ask you to let Weekform observe the app in
                      front (via System Events); that one-time permission is how sessions get
                      their names. You can pause anytime from the toolbar.
                    </p>
                    <button
                      className="getting-started-btn is-primary getting-started-step-action"
                      type="button"
                      onClick={onEnableTracking}
                    >
                      Enable Activity Tracking
                    </button>
                  </>
                ) : (
                  <p>
                    Tracking is on. Weekform is now collecting its first local samples — sessions
                    will start appearing in a few minutes as you work.
                  </p>
                )}
              </div>
            </section>
          )}

          {step === "retention" && (
            <section className="getting-started-section">
              <span className="getting-started-icon" aria-hidden="true">
                <Timer size={17} />
              </span>
              <div>
                <h2 id={stepTitleId}>Choose how long raw activity is kept</h2>
                <p>
                  Raw activity samples can auto-expire after a window you choose — the sessions
                  and work blocks derived from them are kept either way. Pick what feels
                  comfortable; it only ever affects data on this Mac.
                </p>
                <label className="sr-only" htmlFor={`${baseId}-retention`}>
                  Activity retention window
                </label>
                <select
                  className="getting-started-select"
                  id={`${baseId}-retention`}
                  value={retentionDays === null ? "off" : String(retentionDays)}
                  onChange={(event) =>
                    onRetentionDaysChange(
                      event.target.value === "off" ? null : Number(event.target.value)
                    )
                  }
                >
                  <option value="off">Keep all samples</option>
                  {RETENTION_CHOICES.map((days) => (
                    <option key={days} value={days}>
                      Last {days} days
                    </option>
                  ))}
                </select>
              </div>
            </section>
          )}

          {step === "ai" && (
            <section className="getting-started-section">
              <span
                className={`getting-started-icon${aiConfigured || envOpenAiKeyPresent ? " is-on" : ""}`}
                aria-hidden="true"
              >
                {aiConfigured || envOpenAiKeyPresent ? <Check size={17} /> : <Sparkles size={17} />}
              </span>
              <div>
                <h2 id={stepTitleId}>Connect AI — Weekform works best with it</h2>
                {aiConfigured ? (
                  <p>
                    {usingCodexPlan ? "Your ChatGPT/Codex plan" : "OpenAI"} is connected. Session
                    classification, weekly summaries, and next-week forecasts are ready to go —
                    and every AI call is recorded in the audit log. You can change the connection
                    anytime under Settings &rarr; AI&nbsp;Assistance.
                  </p>
                ) : envOpenAiKeyPresent ? (
                  <>
                    <p>
                      Connected to OpenAI through this Mac&rsquo;s environment. Weekform found an
                      <code> OPENAI_API_KEY</code> environment variable (a local <code>.env</code>{" "}
                      file or your shell exports), and its AI features use that key automatically —
                      so this environment is already talking to OpenAI, with no setup needed here.
                    </p>
                    <p>
                      Only the context required by the feature is sent, every call is recorded in
                      the audit log, and you can save a different key under Settings &rarr;
                      AI&nbsp;Assistance to override it.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      AI is what turns raw activity into a helpful week: sessions classified into
                      work blocks, a drafted weekly summary, and a forecast of next week&rsquo;s
                      capacity. Connect with a Platform API key or your ChatGPT/Codex plan. Only
                      feature-specific prompt context is sent, and every call is recorded in the audit log.
                    </p>
                    <form
                      className="getting-started-connect"
                      onSubmit={(event) => {
                        event.preventDefault();
                        connectPastedKey();
                      }}
                    >
                      <label className="sr-only" htmlFor={`${baseId}-api-key`}>
                        OpenAI API key
                      </label>
                      <input
                        id={`${baseId}-api-key`}
                        type="password"
                        autoComplete="off"
                        placeholder="Paste your OpenAI API key (sk-…)"
                        value={apiKeyDraft}
                        onChange={(event) => setApiKeyDraft(event.target.value)}
                      />
                      <button
                        className="getting-started-btn is-primary"
                        type="submit"
                        disabled={!apiKeyDraft.trim()}
                      >
                        Connect
                      </button>
                    </form>
                    <div className="getting-started-alt-connects">
                      <button
                        className="getting-started-btn"
                        type="button"
                        onClick={() => void connectViaCodexPlan()}
                        disabled={codexBusy}
                        aria-busy={codexBusy}
                      >
                        <Sparkles size={14} aria-hidden="true" />
                        {codexBusy ? "Finish signing in your browser…" : "Use ChatGPT/Codex plan"}
                      </button>
                    </div>
                    <p className="getting-started-connect-note">
                      OpenAI manages sign-in through Codex. Weekform does not create, read, or copy
                      a Platform API key or OAuth token.
                    </p>
                    {aiConnectError && (
                      <p className="getting-started-connect-error" role="alert">
                        {aiConnectError}
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
          )}

          {step === "start" && (
            <section className="getting-started-section">
              <span className="getting-started-icon" aria-hidden="true">
                <Settings size={17} />
              </span>
              <div>
                <h2 id={stepTitleId}>Review Weekform in Settings</h2>
                <p>
                  Next, Weekform will open Settings so you can review how activity, privacy,
                  optional AI, notifications, retention, export, and reset work before exploring
                  the rest of the app.
                </p>
                <p>
                  Settings also includes the Replay walkthrough button whenever you want a guided
                  tour of Today, Week, Agent, and History.
                </p>
              </div>
            </section>
          )}
        </div>

        <div className="getting-started-progress" aria-hidden="true">
          {GETTING_STARTED_STEP_IDS.map((id, i) => (
            <span
              key={id}
              className={
                i === stepIndex
                  ? "getting-started-dot is-active"
                  : i < stepIndex
                    ? "getting-started-dot is-done"
                    : "getting-started-dot"
              }
            />
          ))}
        </div>
        <span className="sr-only">
          Step {stepIndex + 1} of {GETTING_STARTED_STEP_IDS.length}
        </span>

        <footer className="getting-started-actions">
          <button className="getting-started-later" type="button" onClick={onDismiss}>
            I&rsquo;ll do this later
          </button>
          <div className="getting-started-nav">
            {!isFirst && (
              <button
                className="getting-started-btn"
                type="button"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              >
                <ArrowLeft size={14} aria-hidden="true" /> Back
              </button>
            )}
            {isLast ? (
              <button
                className="getting-started-btn is-primary"
                type="button"
                onClick={onDismiss}
                ref={primaryButtonRef}
              >
                Review Settings <ArrowRight size={14} aria-hidden="true" />
              </button>
            ) : (
              <button
                className="getting-started-btn is-primary"
                type="button"
                onClick={() => setStepIndex((i) => i + 1)}
                ref={primaryButtonRef}
              >
                {isFirst ? "Get started" : "Next"} <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
