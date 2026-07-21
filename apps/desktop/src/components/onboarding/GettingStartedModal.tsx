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
  ChevronDown,
  Lock,
  MonitorPlay,
  Radio,
  Settings,
  Sparkles,
  Timer,
} from "lucide-react";
import { WeekformMark } from "../common/WeekformMark";
import {
  GETTING_STARTED_STEPS,
  GETTING_STARTED_STEP_IDS,
  type GettingStartedStepId,
} from "../../services/gettingStartedFlow";

/**
 * First-run setup wizard. Each screen explains one decision in plain language,
 * while the labeled rail keeps the whole local-first setup visible. Live values
 * and callbacks come from App, so tracking, retention, and AI changes use the
 * same persistence and audit paths as Settings.
 */

const RETENTION_CHOICES = [
  { days: 7, label: "7 days", detail: "Smallest window" },
  { days: 14, label: "14 days", detail: "Two weeks" },
  { days: 30, label: "30 days", detail: "One month" },
  { days: 90, label: "90 days", detail: "One quarter" },
  { days: null, label: "Keep all", detail: "Until reset" },
] as const;

const STEP_DESCRIPTIONS: Record<GettingStartedStepId, string> = {
  intro:
    "Weekform turns the work already happening on your Mac into a reviewable picture of your week, then helps you decide what fits next.",
  privacy:
    "Weekform is local-first. Your evidence stays on this Mac unless you explicitly use an optional network feature.",
  tracking:
    "Tracking observes which app and window are in front, then groups those local samples into sessions you can review.",
  retention:
    "Raw samples help Weekform reconstruct sessions. Choose when those samples should expire from this Mac.",
  ai:
    "Weekform works without AI, but ChatGPT / Codex unlocks its most helpful workflows: classification, grounded summaries, capacity forecasts, and Agent guidance.",
  start:
    "Check your choices below. Continue to Settings, or preview a fully populated synthetic week first.",
};

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
  onOpenDemo,
  onDismiss,
}: {
  paused: boolean;
  retentionDays: number | null;
  aiConfigured: boolean;
  usingCodexPlan: boolean;
  envOpenAiKeyPresent: boolean;
  onEnableTracking: () => void;
  onRetentionDaysChange: (value: number | null) => void;
  onConnectOpenAiKey: (apiKey: string) => void;
  onConnectViaCodexPlan: () => Promise<string>;
  onOpenDemo: () => void;
  onDismiss: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [codexBusy, setCodexBusy] = useState(false);
  const [aiConnectError, setAiConnectError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === GETTING_STARTED_STEPS.length - 1;
  const currentStep = GETTING_STARTED_STEPS[stepIndex];
  const step = currentStep.id;
  const aiConnected = aiConfigured || envOpenAiKeyPresent;
  const retentionSummary = retentionDays === null ? "Keep until reset" : `${retentionDays} days`;

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

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    primaryButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    primaryButtonRef.current?.focus();
  }, [stepIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
      aria-describedby={descriptionId}
    >
      <div className="getting-started-backdrop" aria-hidden="true" />
      <div ref={cardRef} className="getting-started-card" onKeyDown={handleCardKeyDown}>
        <aside className="getting-started-rail">
          <div className="getting-started-brand" aria-hidden="true">
            <WeekformMark className="getting-started-brand-mark" />
            <span>Set up Weekform</span>
          </div>
          <ol className="getting-started-step-list" aria-label="Setup progress">
            {GETTING_STARTED_STEPS.map((item, index) => {
              const isActive = index === stepIndex;
              const isDone = index < stepIndex;
              return (
                <li
                  key={item.id}
                  className={isActive ? "is-active" : isDone ? "is-done" : undefined}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span className="getting-started-step-marker" aria-hidden="true">
                    {isDone ? <Check size={12} /> : index + 1}
                  </span>
                  <span>{item.label}</span>
                </li>
              );
            })}
          </ol>
          <p className="getting-started-rail-note">
            <Lock size={13} aria-hidden="true" />
            Local-first by default
          </p>
        </aside>

        <div className="getting-started-main">
          <header className="getting-started-header">
            <p className="getting-started-eyebrow">
              Step {stepIndex + 1} of {GETTING_STARTED_STEP_IDS.length}
              <span aria-hidden="true">·</span>
              {currentStep.label}
            </p>
            <h1 className="getting-started-title" id={titleId}>
              {currentStep.title}
            </h1>
            <p className="getting-started-intro" id={descriptionId}>
              {STEP_DESCRIPTIONS[step]}
            </p>
          </header>

          <div className="getting-started-step" key={step}>
            {step === "intro" && (
              <section className="getting-started-welcome" aria-label="How Weekform works">
                <div className="getting-started-week-path">
                  <div>
                    <span>Observe</span>
                    <strong>Local activity</strong>
                  </div>
                  <ArrowRight size={15} aria-hidden="true" />
                  <div>
                    <span>Review</span>
                    <strong>Correct the record</strong>
                  </div>
                  <ArrowRight size={15} aria-hidden="true" />
                  <div>
                    <span>Decide</span>
                    <strong>Reliable capacity</strong>
                  </div>
                </div>
                <div className="getting-started-callout">
                  <Lock size={16} aria-hidden="true" />
                  <p>
                    <strong>About one minute to set up.</strong>
                    Every choice can be changed later, and the guided tour is always available in
                    Settings.
                  </p>
                </div>
              </section>
            )}

            {step === "privacy" && (
              <section className="getting-started-section">
                <ul className="getting-started-trust-list">
                  <li>
                    <span className="getting-started-icon" aria-hidden="true">
                      <Lock size={17} />
                    </span>
                    <div>
                      <strong>Local by default</strong>
                      <p>Raw foreground samples are kept in an encrypted journal on this Mac.</p>
                    </div>
                  </li>
                  <li>
                    <span className="getting-started-icon" aria-hidden="true">
                      <Check size={17} />
                    </span>
                    <div>
                      <strong>You decide what counts</strong>
                      <p>Confirm, relabel, annotate, or exclude every inferred work block.</p>
                    </div>
                  </li>
                  <li>
                    <span className="getting-started-icon" aria-hidden="true">
                      <Sparkles size={17} />
                    </span>
                    <div>
                      <strong>Network use is explicit</strong>
                      <p>
                        AI sends feature-specific context only when it runs. Visual Context can send
                        the current screen only when you enable it.
                      </p>
                    </div>
                  </li>
                </ul>
                <p className="getting-started-fine-print">
                  Weekform does not collect keystrokes, file contents, microphone, or webcam input.
                  Window titles and screenshots can still contain sensitive details.
                </p>
              </section>
            )}

            {step === "tracking" && (
              <section className="getting-started-section">
                <div className="getting-started-signal-flow" aria-label="How tracking becomes reviewed work">
                  <div>
                    <span>Signal</span>
                    <strong>Frontmost app + window title</strong>
                  </div>
                  <ArrowRight size={15} aria-hidden="true" />
                  <div>
                    <span>Weekform creates</span>
                    <strong>Reviewable sessions</strong>
                  </div>
                  <ArrowRight size={15} aria-hidden="true" />
                  <div>
                    <span>Your control</span>
                    <strong>Pause from the toolbar at any time</strong>
                  </div>
                </div>
                {paused ? (
                  <div className="getting-started-action-row">
                    <button
                      className="getting-started-btn is-primary"
                      type="button"
                      onClick={onEnableTracking}
                    >
                      <Radio size={15} aria-hidden="true" />
                      Turn on tracking
                    </button>
                    <p>
                      macOS may ask once for permission to identify the app in front so sessions
                      have useful names. Weekform protects your activity journal with an
                      encryption key kept in your Mac's Keychain — if macOS asks about Keychain
                      access, choose “Always Allow.”
                    </p>
                  </div>
                ) : (
                  <div className="getting-started-status-card is-on" role="status">
                    <span className="getting-started-icon is-on" aria-hidden="true">
                      <Check size={17} />
                    </span>
                    <p>
                      <strong>Tracking is on</strong>
                      Local samples are now arriving. Your first sessions will appear as you work.
                    </p>
                  </div>
                )}
              </section>
            )}

            {step === "retention" && (
              <section className="getting-started-section">
                <fieldset className="getting-started-retention" aria-describedby={`${baseId}-retention-note`}>
                  <legend className="sr-only">Raw activity retention</legend>
                  {RETENTION_CHOICES.map((choice) => {
                    const selected = retentionDays === choice.days;
                    return (
                      <label
                        className={`getting-started-retention-choice${selected ? " is-selected" : ""}`}
                        key={choice.days ?? "all"}
                      >
                        <input
                          className="sr-only"
                          type="radio"
                          name={`${baseId}-retention`}
                          value={choice.days ?? "all"}
                          checked={selected}
                          onChange={() => onRetentionDaysChange(choice.days)}
                        />
                        <span className="getting-started-radio" aria-hidden="true">
                          {selected && <Check size={12} />}
                        </span>
                        <strong>{choice.label}</strong>
                        <small>{choice.detail}</small>
                      </label>
                    );
                  })}
                </fieldset>
                <div className="getting-started-callout" id={`${baseId}-retention-note`}>
                  <Timer size={16} aria-hidden="true" />
                  <p>
                    <strong>This choice affects raw samples only.</strong>
                    Sessions and work blocks are kept until you exclude them or reset Weekform.
                  </p>
                </div>
              </section>
            )}

            {step === "ai" && (
              <section className="getting-started-section">
                {aiConnected ? (
                  <div className="getting-started-status-card is-on" role="status">
                    <span className="getting-started-icon is-on" aria-hidden="true">
                      <Check size={17} />
                    </span>
                    <p>
                      <strong>
                        {envOpenAiKeyPresent && !aiConfigured
                          ? "OpenAI environment key found"
                          : usingCodexPlan
                            ? "ChatGPT / Codex connected"
                            : "OpenAI API key connected"}
                      </strong>
                      AI assistance is ready. Every AI call is recorded in the local Audit log.
                    </p>
                  </div>
                ) : (
                  <>
                    <section
                      className="getting-started-codex-card"
                      aria-label="Recommended AI connection"
                    >
                      <div className="getting-started-codex-heading">
                        <span className="getting-started-codex-icon" aria-hidden="true">
                          <Sparkles size={18} />
                        </span>
                        <div>
                          <span className="getting-started-codex-kicker">
                            Recommended connection
                          </span>
                          <strong>ChatGPT / Codex</strong>
                          <p>
                            Sign in with an eligible ChatGPT plan. No Platform API key or separate
                            key setup.
                          </p>
                        </div>
                      </div>
                      <ul className="getting-started-codex-benefits" aria-label="AI features unlocked">
                        <li>
                          <Check size={12} aria-hidden="true" /> Session classification
                        </li>
                        <li>
                          <Check size={12} aria-hidden="true" /> Grounded summaries
                        </li>
                        <li>
                          <Check size={12} aria-hidden="true" /> Forecasts &amp; Agent
                        </li>
                      </ul>
                      <div className="getting-started-codex-action">
                        <button
                          className="getting-started-btn is-primary"
                          type="button"
                          onClick={() => void connectViaCodexPlan()}
                          disabled={codexBusy}
                          aria-busy={codexBusy}
                        >
                          <Sparkles size={14} aria-hidden="true" />
                          {codexBusy ? "Finish sign-in in your browser…" : "Connect ChatGPT / Codex"}
                        </button>
                        <small>
                          Secure browser sign-in · OAuth tokens stay with Codex. If macOS asks
                          about Keychain access, choose “Always Allow” — it is a one-time
                          confirmation.
                        </small>
                      </div>
                    </section>
                    {aiConnectError && (
                      <p className="getting-started-connect-error" role="alert">
                        {aiConnectError}
                      </p>
                    )}
                    <details className="getting-started-api-disclosure">
                      <summary>
                        <span>
                          <strong>Use a Platform API key instead</strong>
                          <small>Advanced setup</small>
                        </span>
                        <ChevronDown size={15} aria-hidden="true" />
                      </summary>
                      <div className="getting-started-api-disclosure-body">
                        <p>Use your own OpenAI Platform billing and model access.</p>
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
                            placeholder="sk-…"
                            value={apiKeyDraft}
                            onChange={(event) => setApiKeyDraft(event.target.value)}
                          />
                          <button
                            className="getting-started-btn"
                            type="submit"
                            disabled={!apiKeyDraft.trim()}
                          >
                            Connect
                          </button>
                        </form>
                        <small className="getting-started-keychain-note">
                          <Lock size={12} aria-hidden="true" /> Stored in macOS Keychain — if
                          macOS asks for Keychain access, choose “Always Allow”
                        </small>
                      </div>
                    </details>
                    <p className="getting-started-fine-print">
                      <strong>You can continue without AI and connect later in Settings.</strong> AI
                      runs only when you invoke a feature; Weekform records each call in the local
                      Audit log.
                    </p>
                  </>
                )}
              </section>
            )}

            {step === "start" && (
              <section className="getting-started-section">
                <dl className="getting-started-summary">
                  <div>
                    <dt>Activity</dt>
                    <dd className={paused ? undefined : "is-on"}>
                      {paused ? "Paused" : "Tracking on"}
                    </dd>
                  </div>
                  <div>
                    <dt>Raw samples</dt>
                    <dd>{retentionSummary}</dd>
                  </div>
                  <div>
                    <dt>AI assistance</dt>
                    <dd className={aiConnected ? "is-on" : undefined}>
                      {aiConnected ? "Connected" : "Not connected"}
                    </dd>
                  </div>
                </dl>
                <div className="getting-started-next-card">
                  <span className="getting-started-icon" aria-hidden="true">
                    <Settings size={17} />
                  </span>
                  <p>
                    <strong>Next: review Settings</strong>
                    Check sources, privacy, notifications, export, and reset. Then use the replay
                    button there for a guided tour of Today, Week, Agent, and History.
                  </p>
                </div>
                <p className="getting-started-fine-print">
                  If macOS asks for Keychain access after this step, that is Weekform unlocking
                  the encryption key for activity recorded by an earlier install — choose “Always
                  Allow” to keep that history.
                </p>
                <div className="getting-started-demo-card">
                  <span className="getting-started-icon" aria-hidden="true">
                    <MonitorPlay size={17} />
                  </span>
                  <p>
                    <strong>Preview a full synthetic week</strong>
                    Explore reviewed work blocks, capacity, risks, and summaries as if you had used
                    Weekform all week. The simulation does not load or change your own data.
                  </p>
                  <button className="getting-started-btn" type="button" onClick={onOpenDemo}>
                    <MonitorPlay size={14} aria-hidden="true" />
                    View simulated week
                  </button>
                </div>
              </section>
            )}
          </div>

          <span className="sr-only" aria-live="polite">
            Step {stepIndex + 1} of {GETTING_STARTED_STEP_IDS.length}: {currentStep.label}
          </span>

          <footer className="getting-started-actions">
            <button className="getting-started-later" type="button" onClick={onDismiss}>
              Set up later
            </button>
            <div className="getting-started-nav">
              {!isFirst && (
                <button
                  className="getting-started-btn"
                  type="button"
                  onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
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
                  Open Settings <ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="getting-started-btn is-primary"
                  type="button"
                  onClick={() => setStepIndex((index) => index + 1)}
                  ref={primaryButtonRef}
                >
                  {isFirst ? "Begin setup" : "Continue"} <ArrowRight size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
