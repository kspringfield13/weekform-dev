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
  Compass,
  Lock,
  LogIn,
  MonitorPlay,
  Radio,
  Sparkles,
  Timer,
} from "lucide-react";

/**
 * Post-walkthrough "Getting started" wizard — the bridge between learning where
 * things live (WalkthroughOverlay) and actually using the app. Shown once, full
 * screen, right after the walkthrough finishes. Walks the user through the key
 * tracking settings (tracking on/off, retention window, the optional AI layer)
 * with the local-first privacy promise up front, then points them at the demo
 * simulation and the Today dashboard.
 *
 * The wizard is deliberately stateless about the settings it configures:
 * `paused`/`retentionDays` are the app's live values and the change handlers are
 * the same audited paths Settings uses, so anything set here shows up in
 * Settings (and the audit trail) exactly as if it was set there.
 */

// Mirrors SetupScreen's RETENTION_OPTIONS so the wizard offers the same windows.
const RETENTION_CHOICES = [7, 14, 30, 90] as const;

const STEP_IDS = ["privacy", "tracking", "retention", "ai", "start"] as const;

export function GettingStartedModal({
  paused,
  retentionDays,
  aiConfigured,
  envOpenAiKeyPresent,
  onEnableTracking,
  onRetentionDaysChange,
  onConnectOpenAiKey,
  onConnectViaChatGpt,
  onConnectViaCodex,
  onOpenDemo,
  onDismiss,
}: {
  /** Live tracking state — the tracking step flips to its confirmation state when false. */
  paused: boolean;
  /** Live retention window (null = keep everything). */
  retentionDays: number | null;
  /** Whether an AI provider is already connected in Settings. */
  aiConfigured: boolean;
  /** An OPENAI_API_KEY was found in the environment (.env) — AI calls already work. */
  envOpenAiKeyPresent: boolean;
  /** Turn tracking on (same audited path as the toolbar toggle). */
  onEnableTracking: () => void;
  /** Change the retention window (same audited path as Settings). */
  onRetentionDaysChange: (value: number | null) => void;
  /** Save a pasted OpenAI API key as the provider config (OpenAI defaults). */
  onConnectOpenAiKey: (apiKey: string) => void;
  /** Sign in with ChatGPT in the browser (OAuth); resolves a success message. */
  onConnectViaChatGpt: () => Promise<string>;
  /** Import an API key from the Codex CLI sign-in; resolves a success message. */
  onConnectViaCodex: () => Promise<string>;
  /** Open the simulated-week demo (finishes the wizard first). */
  onOpenDemo: () => void;
  /** Close the wizard — Finish, "I'll do this later", or Escape all land here. */
  onDismiss: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [codexBusy, setCodexBusy] = useState(false);
  const [chatGptBusy, setChatGptBusy] = useState(false);
  const [aiConnectError, setAiConnectError] = useState<string | null>(null);
  const connectBusy = codexBusy || chatGptBusy;

  const connectPastedKey = () => {
    const key = apiKeyDraft.trim();
    if (!key) return;
    setAiConnectError(null);
    onConnectOpenAiKey(key);
    setApiKeyDraft("");
  };

  const connectViaChatGpt = async () => {
    setChatGptBusy(true);
    setAiConnectError(null);
    try {
      await onConnectViaChatGpt();
    } catch (error) {
      setAiConnectError(error instanceof Error ? error.message : String(error));
    } finally {
      setChatGptBusy(false);
    }
  };

  const connectViaCodex = async () => {
    setCodexBusy(true);
    setAiConnectError(null);
    try {
      await onConnectViaCodex();
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
  const isLast = stepIndex === STEP_IDS.length - 1;
  const step = STEP_IDS[stepIndex];

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
        <header className="getting-started-header">
          <h1 className="getting-started-title" id={titleId}>
            You&rsquo;re Ready to Begin
          </h1>
          <p className="getting-started-intro">
            A quick setup — every choice here can be changed later in Settings.
          </p>
        </header>

        {/* Keyed by step so each pane re-mounts and plays its enter transition. */}
        <div className="getting-started-step" key={step}>
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
                  only compact derived context (like session summaries) is sent to it — never your
                  raw activity, and only for features you explicitly turn on.
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
                    OpenAI is connected. Session classification, weekly summaries, and
                    next-week forecasts are ready to go — and every AI call is recorded in the
                    audit log. You can change the provider or key anytime under Settings &rarr;
                    AI&nbsp;Assistance.
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
                      Only compact derived context is ever sent, every call is recorded in the
                      audit log, and you can save a different key under Settings &rarr;
                      AI&nbsp;Assistance to override it.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      AI is what turns raw activity into a helpful week: sessions classified into
                      work blocks, a drafted weekly summary, and a forecast of next week&rsquo;s
                      capacity. Connect OpenAI now — only compact derived context is ever sent, your
                      key stays on this Mac, and every call is recorded in the audit log.
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
                        onClick={() => void connectViaChatGpt()}
                        disabled={connectBusy}
                        aria-busy={chatGptBusy}
                      >
                        <LogIn size={14} aria-hidden="true" />
                        {chatGptBusy ? "Finish signing in your browser…" : "Sign in with ChatGPT"}
                      </button>
                      <button
                        className="getting-started-btn"
                        type="button"
                        onClick={() => void connectViaCodex()}
                        disabled={connectBusy}
                        aria-busy={codexBusy}
                      >
                        <Sparkles size={14} aria-hidden="true" />
                        {codexBusy ? "Checking your Codex sign-in…" : "Use my Codex subscription"}
                      </button>
                    </div>
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
            <>
              <section className="getting-started-section">
                <span className="getting-started-icon" aria-hidden="true">
                  <MonitorPlay size={17} />
                </span>
                <div>
                  <h2 id={stepTitleId}>See it in action</h2>
                  <p>
                    Curious what a filled-in week looks like? Open the interactive demo — a
                    simulated typical workday and work week — to see how Weekform visualizes
                    activity, capacity, and summaries. Your own data is untouched, and you can
                    leave the demo anytime.
                  </p>
                  <button
                    className="getting-started-btn getting-started-step-action"
                    type="button"
                    onClick={onOpenDemo}
                  >
                    <MonitorPlay size={14} aria-hidden="true" /> Play the simulated week
                  </button>
                </div>
              </section>
              <section className="getting-started-section">
                <span className="getting-started-icon" aria-hidden="true">
                  <Compass size={17} />
                </span>
                <div>
                  <h2>Where should I start?</h2>
                  <ul>
                    <li>Review today&rsquo;s activity on Today as work blocks appear</li>
                    <li>Import a calendar from Settings for a fuller picture</li>
                    <li>Return to Week later to see workload and capacity trends</li>
                  </ul>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="getting-started-progress" aria-hidden="true">
          {STEP_IDS.map((id, i) => (
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
          Step {stepIndex + 1} of {STEP_IDS.length}
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
                Go to Today <ArrowRight size={14} aria-hidden="true" />
              </button>
            ) : (
              <button
                className="getting-started-btn is-primary"
                type="button"
                onClick={() => setStepIndex((i) => i + 1)}
                ref={primaryButtonRef}
              >
                Next <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
