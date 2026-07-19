import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Copy,
  Database,
  Download,
  FileJson,
  FlaskConical,
  Gauge,
  History,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRoundCog,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { authorizeSimulatorAccess, getLocalSimulatorAccessContext } from "../../../../packages/simulator/src/authorization";
import {
  advanceSimulation,
  createSimulationCheckpoint,
  validateSimulationConfig,
} from "../../../../packages/simulator/src/engine";
import { serializeSimulationJson, serializeWeeklySnapshotsCsv } from "../../../../packages/simulator/src/export";
import { GOLDEN_SIMULATION_CONFIG } from "../../../../packages/simulator/src/golden";
import { buildLocalPlaybackPlan, isAllowedPlaybackSurface } from "../../../../packages/simulator/src/playback";
import { PERSONA_CATALOG } from "../../../../packages/simulator/src/personas";
import type {
  ExecutionMode,
  LocalPlaybackPlan,
  ScenarioKind,
  SharingLevel,
  SimulationConfig,
  SimulationDataset,
  SimulationPersona,
  SimulationWeekSnapshot,
} from "../../../../packages/simulator/src/types";
import { validateSimulationDataset } from "../../../../packages/simulator/src/validate";
import { WeekformMark } from "../components/common/WeekformMark";
import {
  getBrowserAdminPortalSessionStorage,
  readLocalAdminPortalSession,
} from "../services/adminPortal";
import {
  readSimulationRuns,
  writeSimulationRuns,
  type StoredSimulationRun,
} from "./simulatorRepository";
import "./span-simulator.css";

type AdminView = "new" | "history" | "personas" | "run" | "results";
type ResultTab = "overview" | "timeline" | "evidence" | "forecast" | "shared" | "quality" | "audit";

const STEPS = ["Persona & Team", "Span", "Scenario", "Sharing", "Preflight"] as const;
const LOCAL_SIMULATOR_AVAILABLE = import.meta.env.DEV;
const PLAYBACK_FEATURE_ENABLED = LOCAL_SIMULATOR_AVAILABLE
  && import.meta.env.VITE_ENABLE_SPAN_SIMULATOR_PLAYBACK === "true";
const SCENARIOS: Array<{ id: ScenarioKind; label: string }> = [
  { id: "normal", label: "Normal" },
  { id: "quiet", label: "Quiet" },
  { id: "busy", label: "Busy" },
  { id: "deadline-heavy", label: "Deadline-heavy" },
  { id: "incident", label: "Incident" },
  { id: "launch", label: "Launch" },
  { id: "quarter-end", label: "Quarter-end" },
];
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function cloneGoldenConfig(): SimulationConfig {
  return structuredClone(GOLDEN_SIMULATION_CONFIG);
}

function spanWeeks(config: SimulationConfig): number {
  if (config.span.unit === "weeks") return config.span.value;
  if (config.span.unit === "months") return Math.max(1, Math.round(config.span.value * 4.348));
  return Math.max(1, Math.round(config.span.value * 52.143));
}

function memberCount(config: SimulationConfig): number {
  return config.members.reduce((total, member) => total + member.count, 0);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed)
    : value;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed)
    : value;
}

function compactId(value: string): string {
  return value.length > 13 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function artifactCount(dataset: SimulationDataset): number {
  return Object.values(dataset.artifacts).reduce((total, artifacts) => total + artifacts.length, 0);
}

function scenarioLabel(kind: ScenarioKind): string {
  return SCENARIOS.find((scenario) => scenario.id === kind)?.label ?? kind;
}

function SyntheticBadge({ compact = false }: { compact?: boolean }) {
  return <span className={`simulated-badge${compact ? " is-compact" : ""}`}>SIMULATED</span>;
}

function Weekline({ total, current, status }: { total: number; current: number; status: string }) {
  const safeTotal = Math.max(1, total);
  const pct = Math.round((Math.min(current, safeTotal) / safeTotal) * 100);
  return (
    <div className="weekline-wrap">
      <div className="weekline-heading">
        <span>Virtual span</span>
        <strong>{current > 0 ? `Week ${Math.min(current, safeTotal)} of ${safeTotal}` : `${safeTotal} weeks`}</strong>
      </div>
      <div
        className="weekline"
        role="progressbar"
        aria-label={`Simulation ${status} progress`}
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuenow={Math.min(current, safeTotal)}
        aria-valuetext={`${pct}% complete, week ${Math.min(current, safeTotal)} of ${safeTotal}`}
      >
        {Array.from({ length: safeTotal }, (_, index) => (
          <span
            key={index}
            className={index < current ? "is-complete" : index === current && status === "running" ? "is-current" : ""}
            title={`Week ${index + 1}`}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

function AccessBoundary({ children }: { children: ReactNode }) {
  const hasLocalAdminSession = LOCAL_SIMULATOR_AVAILABLE
    && readLocalAdminPortalSession(getBrowserAdminPortalSessionStorage());
  const decision = authorizeSimulatorAccess(
    getLocalSimulatorAccessContext(hasLocalAdminSession)
  );

  if (decision.allowed) return <>{children}</>;

  return (
    <main className="sim-access-shell">
      <section className="sim-access-card" aria-labelledby="sim-access-title">
        <div className="sim-access-mark"><WeekformMark /></div>
        <span className="sim-kicker">Weekform admin lab</span>
        <h1 id="sim-access-title">Span Simulator is locked.</h1>
        <p>
          {LOCAL_SIMULATOR_AVAILABLE
            ? decision.reason
            : "The local Span Simulator is available only in development."}
        </p>
        <div className="sim-gate-note">
          <LockKeyhole size={17} aria-hidden />
          <div>
            <strong>{LOCAL_SIMULATOR_AVAILABLE ? "Manager Access session required" : "Production access remains separate"}</strong>
            <span>
              {LOCAL_SIMULATOR_AVAILABLE
                ? "Sign in through local Manager Access before opening this synthetic tool."
                : "Production simulator administration requires Supabase authentication, an explicit simulator-admin grant, and RLS."}
            </span>
          </div>
        </div>
        <a className="sim-button secondary" href={LOCAL_SIMULATOR_AVAILABLE ? "/manager-access" : "/"}>
          {LOCAL_SIMULATOR_AVAILABLE ? "Go to Manager Access" : "Return to Weekform"}
        </a>
      </section>
    </main>
  );
}

export function SpanSimulatorRoot() {
  const sandboxMatch = /^\/simulator-sandbox\/([^/]+)$/.exec(window.location.pathname);
  if (sandboxMatch) {
    if (PLAYBACK_FEATURE_ENABLED && isAllowedPlaybackSurface(sandboxMatch[1])) {
      return <SimulatorSandbox surface={sandboxMatch[1]} />;
    }
    return <SimulatorSandboxLocked />;
  }
  return (
    <AccessBoundary>
      <SpanSimulatorApp />
    </AccessBoundary>
  );
}

function SpanSimulatorApp() {
  const [view, setView] = useState<AdminView>("new");
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<SimulationConfig>(cloneGoldenConfig);
  const [runs, setRuns] = useState<StoredSimulationRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [repositoryReady, setRepositoryReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [playbackConfirmation, setPlaybackConfirmation] = useState(false);
  const [deleteRun, setDeleteRun] = useState<StoredSimulationRun | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const activeRun = runs.find((run) => run.id === activeRunId) ?? null;
  const activeDataset = activeRun?.dataset ?? null;
  const validation = useMemo(() => validateSimulationConfig(draft), [draft]);

  const commitRuns = (updater: (current: StoredSimulationRun[]) => StoredSimulationRun[]) => {
    setRuns((current) => {
      const next = updater(current).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      void writeSimulationRuns(next).then((persisted) => setStorageWarning(!persisted));
      return next;
    });
  };

  const updateRun = (runId: string, updater: (run: StoredSimulationRun) => StoredSimulationRun) => {
    commitRuns((current) => current.map((run) => run.id === runId ? updater(run) : run));
  };

  useEffect(() => {
    let canceled = false;
    void readSimulationRuns().then((storedRuns) => {
      if (canceled) return;
      setRuns(storedRuns);
      setActiveRunId(storedRuns[0]?.id ?? null);
      setRepositoryReady(true);
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!activeRun || activeRun.status !== "running") return;
    const timeout = window.setTimeout(() => {
      try {
        const checkpoint = advanceSimulation(activeRun.config, activeRun.checkpoint, 1);
        const now = new Date().toISOString();
        updateRun(activeRun.id, (run) => ({
          ...run,
          checkpoint,
          dataset: checkpoint.dataset,
          status: checkpoint.status === "complete" ? "complete" : checkpoint.status,
          updatedAt: now,
          error: null,
        }));
        if (checkpoint.status === "complete") {
          setToast("Simulation complete — every artifact remains permanently marked synthetic.");
          setView("results");
        }
      } catch (error) {
        updateRun(activeRun.id, (run) => ({
          ...run,
          status: "failed",
          updatedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "The simulator stopped unexpectedly.",
        }));
      }
    }, activeRun.config.executionMode === "local-playback" ? 420 : 90);
    return () => window.clearTimeout(timeout);
  }, [activeRun?.id, activeRun?.status, activeRun?.checkpoint.nextWeekIndex]);

  const navigate = (next: AdminView) => {
    setView(next);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  };

  const beginRun = () => {
    if (!repositoryReady) {
      setToast("The isolated simulator store is still opening. Try again in a moment.");
      return;
    }
    if (draft.executionMode === "local-playback" && !PLAYBACK_FEATURE_ENABLED) {
      setToast("Controlled Local Playback is disabled. Enable its dedicated local feature flag first.");
      return;
    }
    if (!validation.valid) {
      setToast(validation.errors[0] ?? "Resolve the preflight issues before starting.");
      return;
    }
    if (draft.executionMode === "local-playback" && !playbackConfirmation) {
      setPlaybackConfirmation(true);
      return;
    }
    const checkpoint = createSimulationCheckpoint(draft);
    const now = new Date().toISOString();
    const id = `sim-${now.replace(/\D/g, "").slice(0, 14)}-${draft.seed.slice(-4)}`;
    const run: StoredSimulationRun = {
      id,
      name: `${scenarioLabel(draft.scenario.kind)} · ${memberCount(draft)} simulated member${memberCount(draft) === 1 ? "" : "s"}`,
      createdAt: now,
      updatedAt: now,
      status: "running",
      archived: false,
      config: structuredClone(draft),
      checkpoint,
      dataset: null,
      error: null,
    };
    commitRuns((current) => [run, ...current]);
    setActiveRunId(id);
    setPlaybackConfirmation(false);
    navigate("run");
  };

  const cancelActiveRun = () => {
    if (!activeRun || activeRun.status !== "running") return;
    try {
      const checkpoint = advanceSimulation(activeRun.config, activeRun.checkpoint, 0, { cancel: true });
      updateRun(activeRun.id, (run) => ({
        ...run,
        checkpoint,
        status: "canceled",
        updatedAt: new Date().toISOString(),
      }));
      setToast(`Run canceled at week ${checkpoint.nextWeekIndex}. The checkpoint can be resumed.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The run could not be canceled.");
    }
  };

  const resumeRun = (run: StoredSimulationRun) => {
    updateRun(run.id, (current) => ({
      ...current,
      status: "running",
      checkpoint: { ...current.checkpoint, status: "running" },
      updatedAt: new Date().toISOString(),
      error: null,
    }));
    setActiveRunId(run.id);
    navigate("run");
  };

  const cloneRun = (run: StoredSimulationRun) => {
    setDraft(structuredClone(run.config));
    setStep(0);
    navigate("new");
    setToast("Run inputs cloned into a new editable draft.");
  };

  const archiveRun = (run: StoredSimulationRun) => {
    updateRun(run.id, (current) => ({ ...current, archived: !current.archived, updatedAt: new Date().toISOString() }));
    setToast(run.archived ? "Run restored to active history." : "Run archived. Its synthetic artifacts were retained.");
  };

  const permanentlyDeleteRun = (run: StoredSimulationRun) => {
    commitRuns((current) => current.filter((item) => item.id !== run.id));
    if (activeRunId === run.id) setActiveRunId(null);
    setCompareIds((current) => current.filter((id) => id !== run.id));
    setDeleteRun(null);
    navigate("history");
    setToast("Simulation run permanently deleted from this local development store.");
  };

  const completeRuns = runs.filter((run) => run.dataset && run.status === "complete" && !run.archived);
  const comparedRuns = compareIds
    .map((id) => runs.find((run) => run.id === id))
    .filter((run): run is StoredSimulationRun => Boolean(run?.dataset));

  return (
    <div className="sim-app">
      <header className="sim-titlebar">
        <div className="sim-titlebar-brand">
          <WeekformMark />
          <strong>Weekform</strong>
          <span>/</span>
          <a href="/manager-access">Manager Access</a>
          <span>/</span>
          <b>Span Simulator</b>
          <span className="admin-lab-badge">Admin lab</span>
        </div>
        <div className="sim-titlebar-actions">
          <span className="local-gate-chip"><ShieldCheck size={13} aria-hidden /> Local admin session</span>
          <a href="/manager-access">Back to Manager Access</a>
          <a href="/">Exit to Weekform</a>
        </div>
      </header>

      <aside className="sim-sidebar" aria-label="Span Simulator navigation">
        <nav>
          <button type="button" className={view === "new" ? "is-active" : ""} onClick={() => navigate("new")}>
            <Plus size={17} aria-hidden /><span><strong>New simulation</strong><small>Design a synthetic span</small></span>
          </button>
          <button type="button" className={view === "history" || view === "results" || view === "run" ? "is-active" : ""} onClick={() => navigate("history")}>
            <History size={17} aria-hidden /><span><strong>Run history</strong><small>{runs.length} local run{runs.length === 1 ? "" : "s"}</small></span>
          </button>
          <button type="button" className={view === "personas" ? "is-active" : ""} onClick={() => navigate("personas")}>
            <Users size={17} aria-hidden /><span><strong>Persona catalog</strong><small>{PERSONA_CATALOG.length} versioned roles</small></span>
          </button>
        </nav>
        <section className="sim-isolation-card" aria-label="Synthetic data isolation">
          <SyntheticBadge compact />
          <strong>Isolated workload lab</strong>
          <p>No personal Weekform state is read on this route. Real team metrics exclude every run.</p>
          <ul>
            <li><Check size={12} aria-hidden /> Synthetic identities only</li>
            <li><Check size={12} aria-hidden /> Separate local store key</li>
            <li><Check size={12} aria-hidden /> Cloud writes remain RLS-gated</li>
          </ul>
        </section>
      </aside>

      <main className="sim-main">
        {storageWarning && (
          <div className="sim-inline-alert warning" role="alert">
            <CircleAlert size={16} aria-hidden /> This browser could not persist the complete run in the isolated IndexedDB store. The current session still has it in memory; export it before closing.
          </div>
        )}
        {view === "new" && (
          <SimulationWizard
            headingRef={headingRef}
            step={step}
            setStep={setStep}
            draft={draft}
            setDraft={setDraft}
            validation={validation}
            playbackEnabled={PLAYBACK_FEATURE_ENABLED}
            onStart={beginRun}
          />
        )}
        {view === "run" && activeRun && (
          <RunScreen headingRef={headingRef} run={activeRun} onCancel={cancelActiveRun} onResume={() => resumeRun(activeRun)} onResults={() => navigate("results")} />
        )}
        {view === "run" && !activeRun && <MissingRun headingRef={headingRef} onHistory={() => navigate("history")} />}
        {view === "results" && activeRun?.dataset && (
          <ResultsScreen
            headingRef={headingRef}
            run={activeRun}
            otherRuns={completeRuns.filter((run) => run.id !== activeRun.id)}
            onClone={() => cloneRun(activeRun)}
            onArchive={() => archiveRun(activeRun)}
            onDelete={() => setDeleteRun(activeRun)}
            onCompare={(otherId) => setCompareIds([activeRun.id, otherId])}
          />
        )}
        {view === "results" && !activeRun?.dataset && <MissingRun headingRef={headingRef} onHistory={() => navigate("history")} />}
        {view === "history" && (
          <HistoryScreen
            headingRef={headingRef}
            runs={runs}
            compareIds={compareIds}
            setCompareIds={setCompareIds}
            onOpen={(run) => { setActiveRunId(run.id); navigate(run.dataset ? "results" : "run"); }}
            onResume={resumeRun}
            onClone={cloneRun}
            onArchive={archiveRun}
            onDelete={setDeleteRun}
            onNew={() => navigate("new")}
          />
        )}
        {view === "personas" && <PersonaCatalog headingRef={headingRef} onUse={(persona) => {
          setDraft((current) => ({ ...current, members: [{ personaId: persona.id, count: 1 }] }));
          setStep(0);
          navigate("new");
        }} />}
        {view === "history" && comparedRuns.length === 2 && <ComparePanel runs={comparedRuns} onClose={() => setCompareIds([])} />}
      </main>

      <div className="sim-toast-host" role="status" aria-live="polite">
        {toast && <div className="sim-toast"><CheckCircle2 size={15} aria-hidden />{toast}</div>}
      </div>

      {playbackConfirmation && (
        <ConfirmPlayback onCancel={() => setPlaybackConfirmation(false)} onConfirm={beginRun} />
      )}
      {deleteRun && (
        <DeleteRunDialog run={deleteRun} onCancel={() => setDeleteRun(null)} onDelete={() => permanentlyDeleteRun(deleteRun)} />
      )}
    </div>
  );
}

function SimulationWizard({
  headingRef,
  step,
  setStep,
  draft,
  setDraft,
  validation,
  playbackEnabled,
  onStart,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>;
  step: number;
  setStep: (step: number) => void;
  draft: SimulationConfig;
  setDraft: React.Dispatch<React.SetStateAction<SimulationConfig>>;
  validation: ReturnType<typeof validateSimulationConfig>;
  playbackEnabled: boolean;
  onStart: () => void;
}) {
  const totalWeeks = spanWeeks(draft);
  const totalMembers = memberCount(draft);
  const setScenarioField = <K extends keyof SimulationConfig["scenario"]>(key: K, value: SimulationConfig["scenario"][K]) => {
    setDraft((current) => ({ ...current, scenario: { ...current.scenario, [key]: value } }));
  };

  const stepTitle = [
    "Who should this synthetic team represent?",
    "How much virtual work should Weekform observe?",
    "What pressure should shape the span?",
    "What may the isolated manager view receive?",
    "Review the contract before generation starts.",
  ][step];

  return (
    <section className="sim-workflow" aria-labelledby="sim-wizard-title">
      <header className="sim-page-header">
        <div>
          <span className="sim-kicker">New simulation</span>
          <h1 id="sim-wizard-title" ref={headingRef} tabIndex={-1}>{stepTitle}</h1>
          <p>Generate upstream synthetic evidence, then let Weekform’s real deterministic inference derive the result.</p>
        </div>
        <SyntheticBadge />
      </header>

      <ol className="sim-stepper" aria-label="Simulation setup steps">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : ""}>
            <button type="button" onClick={() => setStep(index)} aria-current={index === step ? "step" : undefined}>
              <span>{index < step ? <Check size={13} aria-hidden /> : index + 1}</span>
              <b>{label}</b>
            </button>
          </li>
        ))}
      </ol>

      <div className="sim-workflow-grid">
        <div className="sim-step-content">
          {step === 0 && <PersonaStep draft={draft} setDraft={setDraft} />}
          {step === 1 && <SpanStep draft={draft} setDraft={setDraft} />}
          {step === 2 && <ScenarioStep draft={draft} setDraft={setDraft} setScenarioField={setScenarioField} />}
          {step === 3 && <SharingStep draft={draft} setDraft={setDraft} />}
          {step === 4 && <PreflightStep draft={draft} setDraft={setDraft} validation={validation} playbackEnabled={playbackEnabled} />}
        </div>
        <aside className="sim-estimate" aria-label="Live simulation estimate">
          <span className="sim-kicker">Live estimate</span>
          <dl>
            <div><dt>Simulated members</dt><dd>{totalMembers}</dd></div>
            <div><dt>Virtual weeks</dt><dd>{totalWeeks}</dd></div>
            <div><dt>Estimated evidence</dt><dd>{formatNumber(totalMembers * totalWeeks * 460)}–{formatNumber(totalMembers * totalWeeks * 720)}</dd></div>
            <div><dt>Weekly snapshots</dt><dd>{formatNumber(totalMembers * totalWeeks)}</dd></div>
          </dl>
          <Weekline total={totalWeeks} current={0} status="preview" />
          <div className="sim-trust-note">
            <ShieldCheck size={16} aria-hidden />
            <p><strong>Real state stays untouched.</strong> Every artifact carries the run, persona, generator, and seed provenance.</p>
          </div>
        </aside>
      </div>

      <footer className="sim-workflow-footer">
        <button className="sim-button secondary" type="button" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>
          <ArrowLeft size={15} aria-hidden /> Back
        </button>
        <span>{step + 1} of {STEPS.length}</span>
        {step < STEPS.length - 1 ? (
          <button className="sim-button primary" type="button" onClick={() => setStep(Math.min(STEPS.length - 1, step + 1))}>
            Continue <ArrowRight size={15} aria-hidden />
          </button>
        ) : (
          <button className="sim-button primary" type="button" disabled={!validation.valid} onClick={onStart}>
            <Play size={15} aria-hidden /> Start simulated run
          </button>
        )}
      </footer>
    </section>
  );
}

function PersonaStep({ draft, setDraft }: { draft: SimulationConfig; setDraft: React.Dispatch<React.SetStateAction<SimulationConfig>> }) {
  const [query, setQuery] = useState("");
  const [inspected, setInspected] = useState<SimulationPersona | null>(null);
  const selected = new Map(draft.members.map((member) => [member.personaId, member.count]));
  const visible = PERSONA_CATALOG.filter((persona) => `${persona.displayName} ${persona.role}`.toLowerCase().includes(query.toLowerCase()));

  const togglePersona = (persona: SimulationPersona) => {
    setDraft((current) => {
      const exists = current.members.some((member) => member.personaId === persona.id);
      return {
        ...current,
        members: exists
          ? current.members.filter((member) => member.personaId !== persona.id)
          : [...current.members, { personaId: persona.id, count: 1 }],
      };
    });
  };

  return (
    <fieldset className="sim-fieldset">
      <legend>Build the synthetic team</legend>
      <div className="persona-toolbar">
        <div className="sim-search">
          <Search size={17} aria-hidden />
          <input aria-label="Search persona catalog" placeholder="Search by role" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <span className="persona-selection-count" aria-live="polite">
          <Users size={14} aria-hidden />
          {memberCount(draft)} member{memberCount(draft) === 1 ? "" : "s"} selected
        </span>
      </div>
      <p className="sim-field-help">Choose one or more roles, then set how many synthetic members each role represents.</p>
      <div className="persona-grid">
        {visible.map((persona) => {
          const count = selected.get(persona.id);
          return (
            <article className={`persona-card${count ? " is-selected" : ""}`} key={persona.id}>
              <button
                className="persona-select"
                type="button"
                aria-label={`${count ? "Remove" : "Add"} ${persona.displayName} ${count ? "from" : "to"} the synthetic team`}
                aria-pressed={Boolean(count)}
                onClick={() => togglePersona(persona)}
              >
                <span className="persona-icon"><UserRoundCog size={17} aria-hidden /></span>
                <span className="persona-copy"><strong>{persona.displayName}</strong><small>{persona.role} · persona v{persona.version}</small></span>
                <span className="persona-check" aria-hidden>{count ? <Check size={14} /> : <Plus size={14} />}</span>
              </button>
              <div className="persona-meta">
                <span><strong>{persona.deepWorkCadence.blockMinutes.typical} min</strong> focus block</span>
                <span><strong>{persona.meetingBehavior.weeklyMinutes.typical} min</strong> meetings / week</span>
              </div>
              <div className="persona-card-actions">
                <button type="button" onClick={() => setInspected(persona)}>View details</button>
                {count && (
                  <label className="persona-count"><span>Members</span><input aria-label={`${persona.displayName} simulated member count`} type="number" min={1} max={20} value={count} onChange={(event) => {
                    const next = Math.max(1, Math.min(20, Number(event.target.value) || 1));
                    setDraft((current) => ({ ...current, members: current.members.map((member) => member.personaId === persona.id ? { ...member, count: next } : member) }));
                  }} /></label>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {visible.length === 0 && <div className="sim-empty"><Users size={20} aria-hidden /><strong>No personas match.</strong><p>Clear the search to return to the complete versioned catalog.</p><button type="button" onClick={() => setQuery("")}>Clear search</button></div>}
      {inspected && <PersonaDrawer persona={inspected} onClose={() => setInspected(null)} />}
    </fieldset>
  );
}

function PersonaDrawer({ persona, onClose }: { persona: SimulationPersona; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <div className="sim-drawer-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="sim-drawer" role="dialog" aria-modal="true" aria-labelledby="persona-drawer-title">
        <header><div><SyntheticBadge compact /><h2 id="persona-drawer-title">{persona.displayName}</h2><p>{persona.role} · persona v{persona.version}</p></div><button ref={closeRef} type="button" aria-label="Close persona details" onClick={onClose}><X size={17} aria-hidden /></button></header>
        <section><h3>Responsibility patterns</h3><ul>{persona.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul></section>
        <section><h3>Typical projects</h3><div className="sim-chip-list">{persona.projects.map((item) => <span key={item}>{item}</span>)}</div></section>
        <section><h3>Work rhythm</h3><dl className="persona-details"><div><dt>Workday</dt><dd>{persona.typicalWorkday.start}–{persona.typicalWorkday.end}</dd></div><div><dt>Reactive load</dt><dd>{persona.reactiveLoad.typicalPercent}% typical</dd></div><div><dt>Interruptions</dt><dd>{persona.interruptions.perFocusHour}/focus hr</dd></div><div><dt>Stakeholders</dt><dd>{persona.stakeholders.join(", ")}</dd></div></dl></section>
        <section><h3>Sandbox app families</h3><div className="sim-chip-list">{persona.appContexts.map((item) => <span key={item.family}>{item.family}</span>)}</div></section>
      </aside>
    </div>
  );
}

function SpanStep({ draft, setDraft }: { draft: SimulationConfig; setDraft: React.Dispatch<React.SetStateAction<SimulationConfig>> }) {
  return (
    <fieldset className="sim-fieldset">
      <legend>Virtual span</legend>
      <p className="sim-field-help">Generation uses a virtual clock. Multi-year spans advance in week-sized resumable chunks.</p>
      <div className="sim-form-grid two">
        <label><span>Start date</span><input type="date" value={draft.startDate} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label><span>Timezone</span><select value={draft.timezone} onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}>{TIMEZONES.map((timezone) => <option key={timezone}>{timezone}</option>)}</select></label>
        <label><span>Duration</span><input type="number" min={1} max={draft.span.unit === "years" ? 5 : 260} value={draft.span.value} onChange={(event) => setDraft((current) => ({ ...current, span: { ...current.span, value: Math.max(1, Number(event.target.value) || 1) } }))} /></label>
        <label><span>Unit</span><select value={draft.span.unit} onChange={(event) => setDraft((current) => ({ ...current, span: { ...current.span, unit: event.target.value as SimulationConfig["span"]["unit"] } }))}><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option></select></label>
        <label><span>Workday starts</span><input type="time" value={draft.workingHours.start} onChange={(event) => setDraft((current) => ({ ...current, workingHours: { ...current.workingHours, start: event.target.value } }))} /></label>
        <label><span>Workday ends</span><input type="time" value={draft.workingHours.end} onChange={(event) => setDraft((current) => ({ ...current, workingHours: { ...current.workingHours, end: event.target.value } }))} /></label>
      </div>
      <div className="sim-subsection">
        <h3>Working days</h3>
        <div className="weekday-grid" role="group" aria-label="Working days">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, index) => {
            const day = (index + 1) as SimulationConfig["workDays"][number];
            const active = draft.workDays.includes(day);
            return <button key={label} type="button" aria-pressed={active} onClick={() => setDraft((current) => ({ ...current, workDays: active ? current.workDays.filter((item) => item !== day) : [...current.workDays, day].sort() }))}>{label}</button>;
          })}
        </div>
      </div>
      <div className="sim-subsection compact-copy"><CalendarDays size={18} aria-hidden /><div><h3>Holiday and PTO behavior</h3><p>{draft.holidays.length} holidays and {draft.pto.length} PTO ranges are currently pinned in the deterministic configuration.</p></div></div>
    </fieldset>
  );
}

function ScenarioStep({
  draft,
  setDraft,
  setScenarioField,
}: {
  draft: SimulationConfig;
  setDraft: React.Dispatch<React.SetStateAction<SimulationConfig>>;
  setScenarioField: <K extends keyof SimulationConfig["scenario"]>(key: K, value: SimulationConfig["scenario"][K]) => void;
}) {
  const controls: Array<{ key: "meetingDensity" | "reactiveLoad" | "fragmentation" | "overtime" | "interruptions"; label: string }> = [
    { key: "meetingDensity", label: "Meeting density" },
    { key: "reactiveLoad", label: "Reactive load" },
    { key: "fragmentation", label: "Fragmentation" },
    { key: "interruptions", label: "Interruptions" },
    { key: "overtime", label: "Overtime pressure" },
  ];
  return (
    <fieldset className="sim-fieldset">
      <legend>Scenario conditions</legend>
      <p className="sim-field-help">Controls influence correlated behavior. They never write final capacity percentages directly.</p>
      <div className="scenario-presets" role="group" aria-label="Scenario preset">
        {SCENARIOS.map((scenario) => <button type="button" key={scenario.id} aria-pressed={draft.scenario.kind === scenario.id} onClick={() => setScenarioField("kind", scenario.id)}>{scenario.label}</button>)}
      </div>
      <label className="sim-full-field"><span>Scenario title</span><input value={draft.scenario.title} onChange={(event) => setScenarioField("title", event.target.value)} /></label>
      <label className="sim-full-field"><span>Scenario direction</span><textarea rows={4} value={draft.scenario.direction} onChange={(event) => setScenarioField("direction", event.target.value)} /><small>Validated as simulator constraints; never inserted as authoritative metrics.</small></label>
      <div className="scenario-controls">
        {controls.map((control) => (
          <label key={control.key}>
            <span>{control.label}<output>{draft.scenario[control.key]}%</output></span>
            <input type="range" min={0} max={100} step={5} value={draft.scenario[control.key]} onChange={(event) => setScenarioField(control.key, Number(event.target.value))} />
          </label>
        ))}
        <label><span>Concurrent projects<output>{draft.scenario.projectCount}</output></span><input type="range" min={1} max={12} value={draft.scenario.projectCount} onChange={(event) => setScenarioField("projectCount", Number(event.target.value))} /></label>
      </div>
      <div className="sim-form-grid two"><label><span>Deterministic seed</span><input value={draft.seed} onChange={(event) => setDraft((current) => ({ ...current, seed: event.target.value }))} /></label><label><span>Scenario version</span><input value={draft.scenario.version} readOnly /></label></div>
    </fieldset>
  );
}

function SharingStep({ draft, setDraft }: { draft: SimulationConfig; setDraft: React.Dispatch<React.SetStateAction<SimulationConfig>> }) {
  const choices: Array<{ id: SharingLevel; title: string; body: string }> = [
    { id: "summary", title: "Summary", body: "Capacity, workload, risk, confidence, and freshness only." },
    { id: "summary+categories", title: "Summary + categories", body: "Adds aggregate work-category and mode allocation." },
    { id: "summary+categories+projects", title: "Summary + categories + projects", body: "Uses approved synthetic project labels in the isolated planning view." },
  ];
  return (
    <fieldset className="sim-fieldset">
      <legend>Sharing policy</legend>
      <p className="sim-field-help">This creates a consent-safe representation for an isolated manager simulation view. Real team metrics remain unchanged.</p>
      <div className="sharing-options">
        {choices.map((choice) => (
          <label key={choice.id} className={draft.sharingPolicy.level === choice.id ? "is-selected" : ""}>
            <input type="radio" name="sharing" value={choice.id} checked={draft.sharingPolicy.level === choice.id} onChange={() => setDraft((current) => ({ ...current, sharingPolicy: { level: choice.id } }))} />
            <span><strong>{choice.title}</strong><small>{choice.body}</small></span>
          </label>
        ))}
      </div>
      <section className="shared-preview" aria-label="Isolated manager preview">
        <header><div><span className="sim-kicker">Isolated manager preview</span><h3>Senior Data Analyst</h3></div><SyntheticBadge /></header>
        <div className="shared-preview-grid"><div><span>Reliable capacity</span><strong>Derived at run time</strong></div><div><span>Reactive load</span><strong>Derived at run time</strong></div><div><span>Sharing scope</span><strong>{choices.find((choice) => choice.id === draft.sharingPolicy.level)?.title}</strong></div></div>
        <p><LockKeyhole size={14} aria-hidden /> Raw evidence, notes, screenshots, real identities, and window titles never enter this snapshot.</p>
      </section>
    </fieldset>
  );
}

function PreflightStep({ draft, setDraft, validation, playbackEnabled }: { draft: SimulationConfig; setDraft: React.Dispatch<React.SetStateAction<SimulationConfig>>; validation: ReturnType<typeof validateSimulationConfig>; playbackEnabled: boolean }) {
  const estimate = memberCount(draft) * spanWeeks(draft);
  return (
    <fieldset className="sim-fieldset">
      <legend>Preflight preview</legend>
      <div className={`preflight-status ${validation.valid ? "is-valid" : "is-invalid"}`} role="status">
        {validation.valid ? <ShieldCheck size={20} aria-hidden /> : <CircleAlert size={20} aria-hidden />}
        <div><strong>{validation.valid ? "Ready for deterministic generation" : "Preflight needs attention"}</strong><p>{validation.valid ? "The simulator can generate this span without reading or changing personal Weekform state." : validation.errors.join(" ")}</p></div>
      </div>
      <div className="preflight-grid">
        <section><span className="sim-kicker">Canonical inputs</span><dl><div><dt>Personas / members</dt><dd>{draft.members.length} / {memberCount(draft)}</dd></div><div><dt>Date / span</dt><dd>{formatDate(draft.startDate)} · {draft.span.value} {draft.span.unit}</dd></div><div><dt>Timezone</dt><dd>{draft.timezone}</dd></div><div><dt>Scenario</dt><dd>{scenarioLabel(draft.scenario.kind)}</dd></div><div><dt>Seed</dt><dd><code>{draft.seed}</code></dd></div><div><dt>Generator</dt><dd>v{draft.generatorVersion}</dd></div></dl></section>
        <section><span className="sim-kicker">Estimated output</span><dl><div><dt>Member-weeks</dt><dd>{formatNumber(estimate)}</dd></div><div><dt>Evidence range</dt><dd>{formatNumber(estimate * 460)}–{formatNumber(estimate * 720)}</dd></div><div><dt>Snapshots</dt><dd>{formatNumber(estimate)}</dd></div><div><dt>Sharing</dt><dd>{draft.sharingPolicy.level}</dd></div></dl></section>
      </div>
      <div className="execution-modes" role="radiogroup" aria-label="Execution mode">
        {(["fast-forward", "local-playback"] as ExecutionMode[]).map((mode) => (
          <label key={mode} className={`${draft.executionMode === mode ? "is-selected" : ""}${mode === "local-playback" && !playbackEnabled ? " is-disabled" : ""}`}>
            <input type="radio" name="execution-mode" checked={draft.executionMode === mode} disabled={mode === "local-playback" && !playbackEnabled} onChange={() => setDraft((current) => ({ ...current, executionMode: mode }))} />
            {mode === "fast-forward" ? <LoaderCircle size={18} aria-hidden /> : <Activity size={18} aria-hidden />}
            <span><strong>{mode === "fast-forward" ? "Fast Forward" : "Controlled Local Playback"}</strong><small>{mode === "fast-forward" ? "Required, chunked historical generation through the real pipeline." : playbackEnabled ? "Weekform-owned localhost sandbox pages, synthetic credentials, and no external mutations." : "Disabled until VITE_ENABLE_SPAN_SIMULATOR_PLAYBACK=true is set locally."}</small></span>
          </label>
        ))}
      </div>
      <p className="sim-contract-note"><ClipboardCheck size={16} aria-hidden /> Starting records run creation in the synthetic audit trail. Playback requires one additional explicit confirmation.</p>
    </fieldset>
  );
}

function RunScreen({ headingRef, run, onCancel, onResume, onResults }: { headingRef: React.RefObject<HTMLHeadingElement>; run: StoredSimulationRun; onCancel: () => void; onResume: () => void; onResults: () => void }) {
  const total = spanWeeks(run.config);
  const current = run.checkpoint.nextWeekIndex;
  const progress = Math.round((Math.min(current, total) / total) * 100);
  const phases = ["Signals", "Sessions", "Work blocks", "Review", "Capacity", "Forecasts", "Shared snapshots", "Validation"];
  const phase = phases[Math.min(phases.length - 1, current % phases.length)];
  const playback = run.config.executionMode === "local-playback" ? buildLocalPlaybackPlan(run.config) : null;
  return (
    <section className="sim-run-screen" aria-labelledby="sim-run-title">
      <header className="sim-page-header run-header"><div><span className="sim-kicker">{run.status === "running" ? "Generation in progress" : "Generation checkpoint"}</span><h1 ref={headingRef} tabIndex={-1} id="sim-run-title">{run.name}</h1><p><SyntheticBadge compact /> <code>{run.id}</code> · seed <code>{run.config.seed}</code></p></div>{run.status === "running" ? <button className="sim-button danger" type="button" onClick={onCancel}><Pause size={15} aria-hidden /> Cancel run</button> : run.status === "canceled" || run.status === "failed" ? <button className="sim-button primary" type="button" onClick={onResume}><Play size={15} aria-hidden /> Resume checkpoint</button> : <button className="sim-button primary" type="button" onClick={onResults}>View results <ArrowRight size={15} aria-hidden /></button>}</header>
      {run.error && <div className="sim-inline-alert error" role="alert"><CircleAlert size={16} aria-hidden />{run.error}</div>}
      <section className="run-stage" aria-live="polite" aria-busy={run.status === "running"}>
        <div className="run-stage-top"><div className="run-pulse">{run.status === "running" ? <LoaderCircle className="spinning" size={20} aria-hidden /> : <Pause size={20} aria-hidden />}</div><div><span>Virtual clock</span><strong>{run.status === "running" ? phase : run.status === "canceled" ? "Canceled safely" : run.status}</strong></div><b>{progress}%</b></div>
        <Weekline total={total} current={current} status={run.status} />
        <div className="run-facts"><div><span>Virtual week</span><strong>{Math.min(current + (run.status === "running" ? 1 : 0), total)} / {total}</strong></div><div><span>Persona</span><strong>{PERSONA_CATALOG.find((persona) => persona.id === run.config.members[0]?.personaId)?.displayName ?? "Synthetic member"}</strong></div><div><span>Phase</span><strong>{phase}</strong></div><div><span>Checkpoint</span><strong>{formatTimestamp(run.updatedAt)}</strong></div></div>
      </section>
      {playback && <PlaybackPanel plan={playback} current={current} />}
      <section className="run-log"><header><span className="sim-kicker">Chunk log</span><strong>Resumable week checkpoints</strong></header><div>{Array.from({ length: current }, (_, index) => <div key={index}><CheckCircle2 size={14} aria-hidden /><span>Virtual week {index + 1}</span><small>Signals → sessions → work blocks → derived outputs</small></div>).reverse().slice(0, 8)}</div>{current === 0 && <p>Generation is preparing the first synthetic week.</p>}</section>
    </section>
  );
}

function PlaybackPanel({ plan, current }: { plan: LocalPlaybackPlan; current: number }) {
  const action = plan.actions[current % plan.actions.length];
  return (
    <section className="playback-panel">
      <header><div><span className="sim-kicker">Controlled local playback</span><h2>Sandbox action plan</h2></div><SyntheticBadge /></header>
      <div className="playback-safety"><span><ShieldCheck size={14} aria-hidden /> Dedicated profile</span><span><LockKeyhole size={14} aria-hidden /> Synthetic credentials</span><span><X size={14} aria-hidden /> External mutations disabled</span></div>
      {action && <div className="playback-current"><span>{action.type}</span><code>{action.url}</code><a href={action.url} target="_blank" rel="noreferrer">Open sandbox preview <ArrowRight size={13} aria-hidden /></a></div>}
    </section>
  );
}

function ResultsScreen({ headingRef, run, otherRuns, onClone, onArchive, onDelete, onCompare }: { headingRef: React.RefObject<HTMLHeadingElement>; run: StoredSimulationRun; otherRuns: StoredSimulationRun[]; onClone: () => void; onArchive: () => void; onDelete: () => void; onCompare: (id: string) => void }) {
  const [tab, setTab] = useState<ResultTab>("overview");
  const dataset = run.dataset!;
  const resultTabs: Array<{ id: ResultTab; label: string }> = [
    { id: "overview", label: "Overview" }, { id: "timeline", label: "Timeline" }, { id: "evidence", label: "Evidence & reviews" }, { id: "forecast", label: "Forecasts & acceleration" }, { id: "shared", label: "Shared view" }, { id: "quality", label: "Quality" }, { id: "audit", label: "Audit" },
  ];
  return (
    <section className="sim-results" aria-labelledby="sim-results-title">
      <header className="sim-page-header"><div><span className="sim-kicker">Completed synthetic span</span><h1 ref={headingRef} tabIndex={-1} id="sim-results-title">{run.name}</h1><p><SyntheticBadge compact /> {dataset.members.length} member{dataset.members.length === 1 ? "" : "s"} · {dataset.weeklySnapshots.length} member-weeks · fingerprint <code>{compactId(dataset.canonicalFingerprint)}</code></p></div><div className="sim-header-actions"><button className="sim-button secondary" type="button" onClick={onClone}><Copy size={14} aria-hidden /> Clone</button><button className="sim-button secondary" type="button" onClick={() => downloadText(`${run.id}.json`, serializeSimulationJson(dataset), "application/json")}><FileJson size={14} aria-hidden /> JSON</button><button className="sim-button secondary" type="button" onClick={() => downloadText(`${run.id}-weeks.csv`, serializeWeeklySnapshotsCsv(dataset), "text/csv")}><Download size={14} aria-hidden /> CSV</button><button className="sim-icon-button" type="button" aria-label={run.archived ? "Restore run" : "Archive run"} onClick={onArchive}><Archive size={16} aria-hidden /></button><button className="sim-icon-button danger" type="button" aria-label="Permanently delete run" onClick={onDelete}><Trash2 size={16} aria-hidden /></button></div></header>
      {otherRuns.length > 0 && <label className="compare-select"><span>Compare with</span><select defaultValue="" onChange={(event) => { if (event.target.value) onCompare(event.target.value); }}><option value="">Choose another completed run</option>{otherRuns.map((other) => <option key={other.id} value={other.id}>{other.name} · {other.config.seed}</option>)}</select></label>}
      <div className="sim-tabs" role="tablist" aria-label="Simulation result views">{resultTabs.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} key={item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
      <div className="sim-tab-panel" role="tabpanel">
        {tab === "overview" && <OverviewResult dataset={dataset} />}
        {tab === "timeline" && <TimelineResult dataset={dataset} />}
        {tab === "evidence" && <EvidenceResult dataset={dataset} />}
        {tab === "forecast" && <ForecastResult dataset={dataset} />}
        {tab === "shared" && <SharedResult dataset={dataset} />}
        {tab === "quality" && <QualityResult dataset={dataset} />}
        {tab === "audit" && <AuditResult dataset={dataset} />}
      </div>
    </section>
  );
}

function OverviewResult({ dataset }: { dataset: SimulationDataset }) {
  const latest = dataset.weeklySnapshots[dataset.weeklySnapshots.length - 1]?.payload;
  return <div className="result-stack"><div className="result-metrics"><Metric label="Artifacts" value={formatNumber(artifactCount(dataset))} helper="Canonical synthetic records" /><Metric label="Reliable capacity" value={`${Math.round(latest?.reliable_new_work_capacity_pct ?? 0)}%`} helper="Latest derived week" /><Metric label="Reactive load" value={`${Math.round(latest?.reactive_pct ?? 0)}%`} helper="Latest derived week" /><Metric label="Realism quality" value={`${Math.round(dataset.realismReport.score)}%`} helper={`${dataset.realismReport.checksRun} checks run`} /></div><TrendChart weeks={dataset.weeklySnapshots} /><section className="result-section"><header><div><span className="sim-kicker">Provenance</span><h2>Real Weekform pipeline</h2></div><ShieldCheck size={18} aria-hidden /></header><div className="provenance-flow">{dataset.provenance.map((item, index) => <span key={item}>{item}{index < dataset.provenance.length - 1 && <ChevronRight size={13} aria-hidden />}</span>)}</div></section></div>;
}

function Metric({ label, value, helper }: { label: string; value: string; helper: string }) { return <div className="result-metric"><span>{label}</span><strong>{value}</strong><small>{helper}</small></div>; }

function TrendChart({ weeks }: { weeks: SimulationWeekSnapshot[] }) {
  const points = weeks.slice(0, 52);
  const maxX = Math.max(1, points.length - 1);
  const series = [
    { key: "reliable_new_work_capacity_pct", label: "Reliable capacity", className: "capacity" },
    { key: "reactive_pct", label: "Reactive", className: "reactive" },
    { key: "meeting_pct", label: "Meetings", className: "meetings" },
  ] as const;
  const coords = (key: typeof series[number]["key"]) => points.map((week, index) => `${24 + (index / maxX) * 672},${18 + (1 - Math.max(0, Math.min(100, week.payload[key])) / 100) * 180}`).join(" ");
  return <section className="result-section trend-section"><header><div><span className="sim-kicker">Longitudinal history</span><h2>Workload shape across the span</h2></div><div className="trend-legend">{series.map((item) => <span className={item.className} key={item.key}><i />{item.label}</span>)}</div></header><svg viewBox="0 0 720 220" role="img" aria-label={`Line chart of capacity, reactive load, and meetings across ${points.length} synthetic member-weeks`}>{[0,25,50,75,100].map((tick) => <g key={tick}><line x1="24" x2="696" y1={18 + (1 - tick / 100) * 180} y2={18 + (1 - tick / 100) * 180} /><text x="20" y={22 + (1 - tick / 100) * 180} textAnchor="end">{tick}</text></g>)}{series.map((item) => <polyline key={item.key} className={item.className} points={coords(item.key)} />)}</svg><div className="sr-only"><table><caption>Weekly simulation trend values</caption><thead><tr><th>Week</th>{series.map((item) => <th key={item.key}>{item.label}</th>)}</tr></thead><tbody>{points.map((week) => <tr key={week.stamp.canonicalArtifactId}><th>{week.weekId}</th>{series.map((item) => <td key={item.key}>{Math.round(week.payload[item.key])}%</td>)}</tr>)}</tbody></table></div></section>;
}

function TimelineResult({ dataset }: { dataset: SimulationDataset }) {
  const blocks = dataset.artifacts.workBlocks.slice(0, 80);
  return <section className="result-section"><header><div><span className="sim-kicker">Daily and weekly timeline</span><h2>Reviewable synthetic work blocks</h2></div><span>{formatNumber(dataset.artifacts.workBlocks.length)} total</span></header><div className="timeline-list">{blocks.map((artifact) => <article key={artifact.stamp.canonicalArtifactId}><time dateTime={artifact.payload.start_time}>{formatTimestamp(artifact.payload.start_time)}</time><div><strong>{artifact.payload.project_name}</strong><span>{artifact.payload.category} · {artifact.payload.mode}</span></div><span>{Math.round(artifact.payload.estimated_capacity_pct)}% of week</span><SyntheticBadge compact /></article>)}</div>{dataset.artifacts.workBlocks.length > blocks.length && <p className="result-footnote">Showing the first {blocks.length} of {formatNumber(dataset.artifacts.workBlocks.length)} blocks. Export JSON for the complete canonical timeline.</p>}</section>;
}

function EvidenceResult({ dataset }: { dataset: SimulationDataset }) {
  const counts = [{ label: "Raw events", value: dataset.artifacts.rawEvents.length }, { label: "Window samples", value: dataset.artifacts.activeWindowSamples.length }, { label: "Sessions", value: dataset.artifacts.activitySessions.length }, { label: "Work blocks", value: dataset.artifacts.workBlocks.length }, { label: "Corrections", value: dataset.artifacts.corrections.length }];
  return <div className="result-stack"><div className="evidence-funnel">{counts.map((item, index) => <div key={item.label}><span>{item.label}</span><strong>{formatNumber(item.value)}</strong>{index < counts.length - 1 && <ChevronRight size={16} aria-hidden />}</div>)}</div><section className="result-section"><header><div><span className="sim-kicker">Generated review behavior</span><h2>Corrections remain inspectable</h2></div></header><div className="audit-rows">{dataset.artifacts.corrections.slice(0, 30).map((artifact) => <details key={artifact.stamp.canonicalArtifactId}><summary><span>{artifact.payload.field}</span><strong>{artifact.payload.reason}</strong><SyntheticBadge compact /></summary><pre>{JSON.stringify(artifact.payload, null, 2)}</pre></details>)}</div></section></div>;
}

function ForecastResult({ dataset }: { dataset: SimulationDataset }) {
  return <div className="result-grid two"><section className="result-section"><header><div><span className="sim-kicker">Synthetic projections</span><h2>Forecasts</h2></div><Gauge size={18} aria-hidden /></header><div className="forecast-list">{dataset.artifacts.forecasts.slice(-12).map((artifact) => <article key={artifact.stamp.canonicalArtifactId}><div><strong>{artifact.payload.weekId}</strong><span>{artifact.payload.label}</span></div><b>{Math.round(artifact.payload.reliableNewWorkCapacityPct)}%</b><small>{Math.round(artifact.payload.confidence * 100)}% confidence</small></article>)}</div></section><section className="result-section"><header><div><span className="sim-kicker">Acceleration</span><h2>Evidence-grounded opportunities</h2></div><Sparkles size={18} aria-hidden /></header><div className="acceleration-list">{dataset.artifacts.accelerationSignals.slice(0, 12).map((artifact) => <article key={artifact.stamp.canonicalArtifactId}><strong>{artifact.payload.title}</strong><p>{artifact.payload.detail}</p><span>{artifact.payload.estimated_minutes_saved_per_week} min/week potential · {Math.round(artifact.payload.confidence * 100)}% confidence</span></article>)}</div></section></div>;
}

function SharedResult({ dataset }: { dataset: SimulationDataset }) {
  const [included, setIncluded] = useState(false);
  const latestByMember = dataset.members.map((member) => ({ member, snapshot: [...dataset.artifacts.sharedSnapshots].reverse().find((item) => item.stamp.memberId === member.memberId) }));
  return <div className="result-stack"><div className="simulation-toggle"><div><strong>Show simulations in isolated planning view</strong><p>Off by default. This never adds synthetic members to real team metrics.</p></div><button type="button" role="switch" aria-checked={included} onClick={() => setIncluded(!included)}><span />{included ? "Shown" : "Hidden"}</button></div>{included ? <div className="manager-grid">{latestByMember.map(({ member, snapshot }) => <article key={member.memberId}><header><div><SyntheticBadge compact /><h3>{member.displayName}</h3><span>{member.role}</span></div><span>Planning view only</span></header><div><Metric label="Reliable capacity" value={`${Math.round(snapshot?.payload.metrics.reliableNewWorkCapacityPct ?? 0)}%`} helper="Derived summary" /><Metric label="Reactive" value={`${Math.round(snapshot?.payload.metrics.reactivePct ?? 0)}%`} helper="Derived summary" /><Metric label="Meetings" value={`${Math.round(snapshot?.payload.metrics.meetingPct ?? 0)}%`} helper="Derived summary" /></div><footer>{snapshot?.payload.shareLevel ?? dataset.config.sharingPolicy.level}</footer></article>)}</div> : <div className="sim-empty"><Users size={22} aria-hidden /><strong>Simulated members are hidden.</strong><p>Turn on the isolated planning view to inspect consent-safe synthetic snapshots.</p></div>}</div>;
}

function QualityResult({ dataset }: { dataset: SimulationDataset }) {
  const validated = validateSimulationDataset(dataset);
  const violations = [...dataset.realismReport.violations, ...validated.violations];
  return <div className="result-stack"><div className={`quality-hero ${validated.valid && dataset.realismReport.valid ? "is-valid" : "is-warning"}`}><div className="quality-score"><strong>{Math.round(dataset.realismReport.score)}</strong><span>/100 realism</span></div><div><h2>{validated.valid && dataset.realismReport.valid ? "Constraints and privacy checks passed" : "Quality checks found issues"}</h2><p>{dataset.realismReport.checksRun} realism checks plus canonical privacy validation. Synthetic provenance remains inspectable on every artifact.</p></div></div><section className="result-section"><header><div><span className="sim-kicker">Constraint report</span><h2>{violations.length} violation{violations.length === 1 ? "" : "s"}</h2></div></header>{violations.length === 0 ? <div className="quality-pass"><CheckCircle2 size={18} aria-hidden /><div><strong>No impossible overlaps, PII, paths, or metric inconsistencies found.</strong><p>The same seed and versioned inputs can be replayed to confirm determinism.</p></div></div> : <div className="violation-list">{violations.map((item, index) => <article key={`${item.code}-${index}`} data-severity={item.severity}><span>{item.severity}</span><div><strong>{item.code}</strong><p>{item.message}</p></div><code>{item.weekId ?? item.artifactId ?? "run"}</code></article>)}</div>}</section></div>;
}

function AuditResult({ dataset }: { dataset: SimulationDataset }) {
  return <section className="result-section"><header><div><span className="sim-kicker">Synthetic audit history</span><h2>Run lifecycle and derivation events</h2></div><span>{dataset.artifacts.auditEvents.length} events</span></header><div className="audit-rows">{[...dataset.artifacts.auditEvents].reverse().map((artifact) => <details key={artifact.stamp.canonicalArtifactId}><summary><time dateTime={artifact.payload.timestamp}>{formatTimestamp(artifact.payload.timestamp)}</time><strong>{artifact.payload.title}</strong><span>{artifact.payload.privacy_level}</span><SyntheticBadge compact /></summary><p>{artifact.payload.summary}</p><pre>{JSON.stringify(artifact.payload.details, null, 2)}</pre></details>)}</div></section>;
}

function HistoryScreen({ headingRef, runs, compareIds, setCompareIds, onOpen, onResume, onClone, onArchive, onDelete, onNew }: { headingRef: React.RefObject<HTMLHeadingElement>; runs: StoredSimulationRun[]; compareIds: string[]; setCompareIds: React.Dispatch<React.SetStateAction<string[]>>; onOpen: (run: StoredSimulationRun) => void; onResume: (run: StoredSimulationRun) => void; onClone: (run: StoredSimulationRun) => void; onArchive: (run: StoredSimulationRun) => void; onDelete: (run: StoredSimulationRun) => void; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const visible = runs.filter((run) => (showArchived || !run.archived) && `${run.name} ${run.id} ${run.config.seed}`.toLowerCase().includes(query.toLowerCase()));
  const toggleCompare = (id: string) => setCompareIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 2 ? [...current, id] : [current[1], id]);
  return <section className="sim-history" aria-labelledby="sim-history-title"><header className="sim-page-header"><div><span className="sim-kicker">Results & history</span><h1 ref={headingRef} tabIndex={-1} id="sim-history-title">Simulation runs</h1><p>Replay, inspect, compare, export, archive, or permanently delete isolated synthetic datasets.</p></div><button className="sim-button primary" type="button" onClick={onNew}><Plus size={15} aria-hidden /> New simulation</button></header><div className="history-toolbar"><div className="sim-search"><Search size={16} aria-hidden /><input aria-label="Search simulation runs" placeholder="Search run, ID, or seed" value={query} onChange={(event) => setQuery(event.target.value)} /></div><label><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label><span>{compareIds.length}/2 selected to compare</span></div>{visible.length === 0 ? <div className="sim-empty"><History size={22} aria-hidden /><strong>{runs.length === 0 ? "No simulation runs yet." : "No runs match."}</strong><p>{runs.length === 0 ? "Create the golden 26-week analyst scenario or configure a new synthetic team." : "Clear the search or include archived runs."}</p><button type="button" onClick={runs.length === 0 ? onNew : () => setQuery("")}>{runs.length === 0 ? "Create simulation" : "Clear search"}</button></div> : <div className="history-list">{visible.map((run) => <article key={run.id} className={run.archived ? "is-archived" : ""}><label className="compare-check"><input type="checkbox" disabled={!run.dataset || run.status !== "complete"} checked={compareIds.includes(run.id)} onChange={() => toggleCompare(run.id)} /><span className="sr-only">Select {run.name} for comparison</span></label><button className="history-main" type="button" onClick={() => onOpen(run)}><div><span className={`run-status ${run.status}`}>{run.status}</span>{run.archived && <span className="run-status archived">archived</span>}<SyntheticBadge compact /></div><strong>{run.name}</strong><small>{run.id}</small></button><dl><div><dt>Span</dt><dd>{run.config.span.value} {run.config.span.unit}</dd></div><div><dt>Scenario</dt><dd>{scenarioLabel(run.config.scenario.kind)}</dd></div><div><dt>Seed</dt><dd>{run.config.seed}</dd></div><div><dt>Updated</dt><dd>{formatTimestamp(run.updatedAt)}</dd></div></dl><div className="history-actions">{run.status === "canceled" || run.status === "failed" ? <button type="button" onClick={() => onResume(run)}><Play size={14} aria-hidden /> Resume</button> : null}<button type="button" onClick={() => onClone(run)}><Copy size={14} aria-hidden /> Clone</button><button type="button" onClick={() => onArchive(run)}><Archive size={14} aria-hidden />{run.archived ? "Restore" : "Archive"}</button><button className="danger" type="button" disabled={run.status === "running"} onClick={() => onDelete(run)}><Trash2 size={14} aria-hidden /> Delete</button></div></article>)}</div>}</section>;
}

function ComparePanel({ runs, onClose }: { runs: StoredSimulationRun[]; onClose: () => void }) {
  const [left, right] = runs;
  const leftWeeks = left.dataset!.weeklySnapshots;
  const rightWeeks = right.dataset!.weeklySnapshots;
  const leftLatest = leftWeeks[leftWeeks.length - 1].payload;
  const rightLatest = rightWeeks[rightWeeks.length - 1].payload;
  const rows = [{ label: "Reliable capacity", left: leftLatest.reliable_new_work_capacity_pct, right: rightLatest.reliable_new_work_capacity_pct }, { label: "Reactive load", left: leftLatest.reactive_pct, right: rightLatest.reactive_pct }, { label: "Meeting load", left: leftLatest.meeting_pct, right: rightLatest.meeting_pct }, { label: "Fragmentation", left: leftLatest.fragmented_work_pct, right: rightLatest.fragmented_work_pct }];
  return <div className="compare-overlay" role="dialog" aria-modal="true" aria-labelledby="compare-title"><div className="compare-panel"><header><div><span className="sim-kicker">Side-by-side run comparison</span><h2 id="compare-title">Different conditions, inspectable outcomes</h2><p>Deltas describe workload shape; they never rank people or imply performance.</p></div><button type="button" aria-label="Close comparison" onClick={onClose}><X size={17} aria-hidden /></button></header><div className="compare-head"><div><SyntheticBadge compact /><strong>{left.name}</strong><span>Seed {left.config.seed} · {left.config.span.value} {left.config.span.unit}</span></div><div><SyntheticBadge compact /><strong>{right.name}</strong><span>Seed {right.config.seed} · {right.config.span.value} {right.config.span.unit}</span></div></div><div className="compare-table">{rows.map((row) => <div key={row.label}><span>{row.label}</span><strong>{Math.round(row.left)}%</strong><b>{Math.round(row.right - row.left) > 0 ? "+" : ""}{Math.round(row.right - row.left)} pts</b><strong>{Math.round(row.right)}%</strong></div>)}</div><div className="compare-quality"><span>{Math.round(left.dataset!.realismReport.score)}/100 realism</span><span>{Math.round(right.dataset!.realismReport.score)}/100 realism</span></div></div></div>;
}

function PersonaCatalog({ headingRef, onUse }: { headingRef: React.RefObject<HTMLHeadingElement>; onUse: (persona: SimulationPersona) => void }) {
  const [selected, setSelected] = useState(PERSONA_CATALOG[0]);
  return <section className="persona-catalog" aria-labelledby="persona-catalog-title"><header className="sim-page-header"><div><span className="sim-kicker">Versioned realism system</span><h1 ref={headingRef} tabIndex={-1} id="persona-catalog-title">Persona catalog</h1><p>Role-specific constraints create correlated work rhythms instead of random noise.</p></div><SyntheticBadge /></header><div className="catalog-layout"><nav aria-label="Simulation personas">{PERSONA_CATALOG.map((persona) => <button type="button" className={selected.id === persona.id ? "is-active" : ""} key={persona.id} onClick={() => setSelected(persona)}><UserRoundCog size={16} aria-hidden /><span><strong>{persona.displayName}</strong><small>{persona.role} · v{persona.version}</small></span></button>)}</nav><article className="catalog-detail"><header><div><SyntheticBadge compact /><h2>{selected.displayName}</h2><p>{selected.role} · schema {selected.schemaVersion} · v{selected.version}</p></div><button className="sim-button primary" type="button" onClick={() => onUse(selected)}>Use persona <ArrowRight size={14} aria-hidden /></button></header><div className="catalog-sections"><section><h3>Responsibilities</h3><ul>{selected.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul></section><section><h3>Projects</h3><div className="sim-chip-list">{selected.projects.map((item) => <span key={item}>{item}</span>)}</div></section><section><h3>Deep-work cadence</h3><p>{selected.deepWorkCadence.blockMinutes.typical}-minute blocks, usually starting at {selected.deepWorkCadence.preferredStartHours.map((hour) => `${hour}:00`).join(" or ")}.</p></section><section><h3>Reactive profile</h3><p>{selected.reactiveLoad.typicalPercent}% typical reactive load with {selected.reactiveLoad.burstsPerDay.typical} bursts per day.</p></section><section><h3>App context families</h3><div className="sim-chip-list">{selected.appContexts.map((item) => <span key={item.family}>{item.family} · {item.appName}</span>)}</div></section><section><h3>Seasonal pressures</h3><ul>{selected.seasonalPressures.map((item) => <li key={item}>{item}</li>)}</ul></section></div></article></div></section>;
}

function ConfirmPlayback({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  return <div className="sim-dialog-overlay"><section className="sim-dialog" role="alertdialog" aria-modal="true" aria-labelledby="playback-confirm-title"><div className="sim-dialog-icon"><ShieldCheck size={20} aria-hidden /></div><h2 id="playback-confirm-title">Confirm controlled local playback</h2><p>Weekform will open only its localhost sandbox pages in a dedicated synthetic profile. It will not automate real applications, use real credentials, or permit external mutations.</p><ul><li><Check size={13} aria-hidden /> Cancelable immediately</li><li><Check size={13} aria-hidden /> Synthetic credentials only</li><li><Check size={13} aria-hidden /> Same canonical event adapter as Fast Forward</li></ul><div className="sim-dialog-actions"><button ref={cancelRef} className="sim-button secondary" type="button" onClick={onCancel}>Cancel</button><button className="sim-button primary" type="button" onClick={onConfirm}>Confirm and start playback</button></div></section></div>;
}

function DeleteRunDialog({ run, onCancel, onDelete }: { run: StoredSimulationRun; onCancel: () => void; onDelete: () => void }) {
  const [value, setValue] = useState("");
  return <div className="sim-dialog-overlay"><section className="sim-dialog danger-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-run-title"><div className="sim-dialog-icon"><Trash2 size={20} aria-hidden /></div><h2 id="delete-run-title">Permanently delete this run?</h2><p>This removes the checkpoint, canonical artifacts, weekly snapshots, quality report, and synthetic audit history from the local simulator store.</p><label><span>Type <code>{run.id}</code> to confirm</span><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} /></label><div className="sim-dialog-actions"><button className="sim-button secondary" type="button" onClick={onCancel}>Cancel</button><button className="sim-button danger" type="button" disabled={value !== run.id} onClick={onDelete}>Delete permanently</button></div></section></div>;
}

function MissingRun({ headingRef, onHistory }: { headingRef: React.RefObject<HTMLHeadingElement>; onHistory: () => void }) {
  return <section className="sim-empty full"><Database size={24} aria-hidden /><h1 ref={headingRef} tabIndex={-1}>This simulation is not available.</h1><p>It may have been deleted, or its generated dataset is not complete yet.</p><button type="button" onClick={onHistory}>Return to run history</button></section>;
}

function SimulatorSandbox({ surface }: { surface: string }) {
  const surfaceName = surface.replace(/-/g, " ");
  const items = ["Synthetic Q3 operating review", "Dashboard migration checkpoint", "Quarter-end variance analysis", "Forecast validation queue"];
  return <main className="sandbox-app"><header><div><WeekformMark /><strong>Weekform Sandbox</strong></div><SyntheticBadge /><span>Localhost only · no external mutations</span></header><section><aside><span className="sim-kicker">Mock application</span><h1>{surfaceName}</h1><p>This controlled page emits only canonical synthetic simulator actions.</p><nav>{["Inbox", "Workspace", "Reports", "Planning"].map((item, index) => <button type="button" key={item} className={index === 1 ? "is-active" : ""}>{item}</button>)}</nav></aside><div className="sandbox-workspace"><header><div><span className="sim-kicker">Simulated work queue</span><h2>Quarter-end reporting + dashboard migration</h2></div><button type="button" data-synthetic-action="open-dashboard">Synthetic action</button></header>{surface === "documents" && <label className="sim-full-field"><span>SIMULATED scenario notes</span><textarea data-synthetic-input="notes" defaultValue="" /></label>}<div className="sandbox-grid">{items.map((item, index) => <article key={item}><span>{index % 2 === 0 ? "Analysis" : "Migration"}</span><strong>{item}</strong><p>Generated context for a sandboxed {surfaceName} session.</p><button type="button">Open mock item</button></article>)}</div></div></section><footer><ShieldCheck size={14} aria-hidden /> Dedicated synthetic profile · external network disabled · cancel from Span Simulator</footer></main>;
}

function SimulatorSandboxLocked() {
  return <main className="sim-access-shell"><section className="sim-access-card" aria-labelledby="sandbox-locked-title"><div className="sim-access-mark"><LockKeyhole /></div><span className="sim-kicker">Weekform controlled playback</span><h1 id="sandbox-locked-title">Sandbox playback is locked.</h1><p>This localhost-only surface requires the dedicated playback flag and an allowlisted mock application route.</p><div className="sim-gate-note"><ShieldCheck size={17} aria-hidden /><div><strong>Dedicated playback gate</strong><span>Set <code>VITE_ENABLE_SPAN_SIMULATOR_PLAYBACK=true</code> only for explicit local sandbox sessions.</span></div></div><a className="sim-button secondary" href="/manager-access/span-simulator">Return to Span Simulator</a></section></main>;
}
