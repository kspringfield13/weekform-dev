import {
  Activity,
  Archive,
  ArrowRight,
  BarChart3,
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
  MousePointer2,
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
import { applyScenarioPreset } from "../../../../packages/simulator/src/presets";
import { getPersonaWorkCatalog } from "../../../../packages/simulator/src/workCatalog";
import type {
  ExecutionMode,
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
import { LiveSimulationStage } from "./LiveSimulationStage";
import "./span-simulator.css";

type AdminView = "new" | "history" | "personas" | "run" | "results";
type ResultTab = "decision" | "evidence" | "forecast" | "integrity";

const LOCAL_SIMULATOR_AVAILABLE = import.meta.env.DEV;
const PLAYBACK_FEATURE_ENABLED = LOCAL_SIMULATOR_AVAILABLE;
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
        <h1 id="sim-access-title">Simulation is locked.</h1>
        <p>
          {LOCAL_SIMULATOR_AVAILABLE
            ? decision.reason
            : "The local Simulation tool is available only in development."}
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
    return (
      <AccessBoundary>
        {PLAYBACK_FEATURE_ENABLED && isAllowedPlaybackSurface(sandboxMatch[1])
          ? <SimulatorSandbox surface={sandboxMatch[1]} />
          : <SimulatorSandboxLocked />}
      </AccessBoundary>
    );
  }
  return (
    <AccessBoundary>
      <SpanSimulatorApp />
    </AccessBoundary>
  );
}

function SpanSimulatorApp() {
  const [view, setView] = useState<AdminView>("new");
  const [draft, setDraft] = useState<SimulationConfig>(cloneGoldenConfig);
  const [runs, setRuns] = useState<StoredSimulationRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [repositoryReady, setRepositoryReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [playbackConfirmation, setPlaybackConfirmation] = useState(false);
  const [deleteRun, setDeleteRun] = useState<StoredSimulationRun | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [livePlaybackPaused, setLivePlaybackPaused] = useState(false);
  const [livePlaybackSpeed, setLivePlaybackSpeed] = useState(1);
  const [livePlaybackOutcome, setLivePlaybackOutcome] = useState<{ runId: string | null; complete: boolean; error: string | null }>({ runId: null, complete: false, error: null });
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
    const isLive = activeRun.config.executionMode === "local-playback";
    const activeOutcome = livePlaybackOutcome.runId === activeRun.id
      ? livePlaybackOutcome
      : { runId: activeRun.id, complete: false, error: null };
    if (isLive && activeOutcome.error) {
      updateRun(activeRun.id, (run) => ({
        ...run,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: `Live simulation stopped safely: ${activeOutcome.error}`,
      }));
      setToast("Live simulation stopped because an allowlisted action could not be completed.");
      return;
    }
    if (activeRun.checkpoint.status === "complete") {
      if (isLive && !activeOutcome.complete) return;
      updateRun(activeRun.id, (run) => ({
        ...run,
        status: "complete",
        updatedAt: new Date().toISOString(),
        error: null,
      }));
      setToast(isLive
        ? "Live simulation complete — the action sequence and deterministic span both finished."
        : "Simulation complete — every artifact remains permanently marked synthetic.");
      if (!isLive) setView("results");
      return;
    }
    if (isLive && livePlaybackPaused) return;
    const timeout = window.setTimeout(() => {
      try {
        const checkpoint = advanceSimulation(activeRun.config, activeRun.checkpoint, 1);
        const now = new Date().toISOString();
        updateRun(activeRun.id, (run) => ({
          ...run,
          checkpoint,
          dataset: checkpoint.dataset,
          status: checkpoint.status === "complete" && isLive ? "running" : checkpoint.status,
          updatedAt: now,
          error: null,
        }));
        if (checkpoint.status === "complete" && !isLive) {
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
    }, isLive
      ? Math.max(1100, Math.round(14_000 / spanWeeks(activeRun.config))) / livePlaybackSpeed
      : 90);
    return () => window.clearTimeout(timeout);
  }, [activeRun?.id, activeRun?.status, activeRun?.checkpoint.nextWeekIndex, activeRun?.checkpoint.status, livePlaybackPaused, livePlaybackSpeed, livePlaybackOutcome.runId, livePlaybackOutcome.complete, livePlaybackOutcome.error]);

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
      setToast("Live simulation is available only in local Vite development.");
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
    setLivePlaybackPaused(false);
    setLivePlaybackSpeed(1);
    setLivePlaybackOutcome({ runId: id, complete: false, error: null });
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
    setLivePlaybackPaused(false);
    setLivePlaybackOutcome({ runId: run.id, complete: false, error: null });
    setActiveRunId(run.id);
    navigate("run");
  };

  const cloneRun = (run: StoredSimulationRun) => {
    setDraft(structuredClone(run.config));
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
  const openMode = (executionMode: ExecutionMode) => {
    setDraft((current) => ({ ...current, executionMode }));
    navigate("new");
  };

  return (
    <div className="sim-app">
      <header className="sim-titlebar">
        <div className="sim-titlebar-brand">
          <WeekformMark />
          <strong>Weekform</strong>
          <span>/</span>
          <b>Simulation lab</b>
          <span className="admin-lab-badge">Admin lab</span>
        </div>
        <div className="sim-titlebar-actions">
          <span className="local-gate-chip"><ShieldCheck size={13} aria-hidden /> Local admin session</span>
          <a href="/manager-access">Back</a>
          <a href="/">Exit</a>
        </div>
      </header>

      <aside className="sim-sidebar" aria-label="Simulation navigation">
        <nav>
          <button type="button" className={view === "new" && draft.executionMode === "fast-forward" ? "is-active" : ""} onClick={() => openMode("fast-forward")}>
            <Database size={17} aria-hidden /><span><strong>New span</strong><small>Model a workload</small></span>
          </button>
          <button type="button" className={view === "new" && draft.executionMode === "local-playback" ? "is-active" : ""} onClick={() => openMode("local-playback")}>
            <Activity size={17} aria-hidden /><span><strong>Watch live</strong><small>Replay in Weekform</small></span>
          </button>
          <button type="button" className={view === "history" || view === "results" || view === "run" ? "is-active" : ""} onClick={() => navigate("history")}>
            <History size={17} aria-hidden /><span><strong>Runs</strong><small>{runs.length} saved</small></span>
          </button>
          <button type="button" className={view === "personas" ? "is-active" : ""} onClick={() => navigate("personas")}>
            <Users size={17} aria-hidden /><span><strong>Roles</strong><small>{PERSONA_CATALOG.length} profiles</small></span>
          </button>
        </nav>
        <section className="sim-isolation-card" aria-label="Synthetic data isolation">
          <ShieldCheck size={16} aria-hidden />
          <span><strong>Isolated by design</strong><small>Local, synthetic, no cloud writes</small></span>
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
            draft={draft}
            setDraft={setDraft}
            validation={validation}
            playbackEnabled={PLAYBACK_FEATURE_ENABLED}
            onStart={beginRun}
          />
        )}
        {view === "run" && activeRun && (
          <RunScreen
            headingRef={headingRef}
            run={activeRun}
            livePaused={livePlaybackPaused}
            liveSpeed={livePlaybackSpeed}
            onLivePausedChange={setLivePlaybackPaused}
            onLiveSpeedChange={setLivePlaybackSpeed}
            onLiveComplete={() => setLivePlaybackOutcome({ runId: activeRun.id, complete: true, error: null })}
            onLiveFailure={(message) => setLivePlaybackOutcome({ runId: activeRun.id, complete: false, error: message })}
            onLiveRestart={() => setLivePlaybackOutcome({ runId: activeRun.id, complete: false, error: null })}
            onCancel={cancelActiveRun}
            onResume={() => resumeRun(activeRun)}
            onResults={() => navigate("results")}
          />
        )}
        {view === "run" && !activeRun && <MissingRun headingRef={headingRef} onHistory={() => navigate("history")} />}
        {view === "results" && activeRun?.dataset && (
          <ResultsScreen
            headingRef={headingRef}
            run={activeRun}
            otherRuns={completeRuns.filter((run) => run.id !== activeRun.id)}
            compareId={compareIds.find((id) => id !== activeRun.id) ?? ""}
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
          navigate("new");
        }} />}
        {comparedRuns.length === 2 && <ComparePanel runs={comparedRuns} onClose={() => setCompareIds([])} />}
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
  draft,
  setDraft,
  validation,
  playbackEnabled,
  onStart,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>;
  draft: SimulationConfig;
  setDraft: React.Dispatch<React.SetStateAction<SimulationConfig>>;
  validation: ReturnType<typeof validateSimulationConfig>;
  playbackEnabled: boolean;
  onStart: () => void;
}) {
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const [personaQuery, setPersonaQuery] = useState("");
  const totalWeeks = spanWeeks(draft);
  const totalMembers = memberCount(draft);
  const memberWeeks = totalMembers * totalWeeks;
  const visiblePersonas = PERSONA_CATALOG.filter((persona) => (
    `${persona.displayName} ${persona.role}`.toLowerCase().includes(personaQuery.trim().toLowerCase())
  ));
  const selectedPersonas = draft.members.map((member) => ({
    member,
    persona: PERSONA_CATALOG.find((persona) => persona.id === member.personaId),
  }));
  const setScenarioField = <K extends keyof SimulationConfig["scenario"]>(key: K, value: SimulationConfig["scenario"][K]) => {
    setDraft((current) => ({ ...current, scenario: { ...current.scenario, [key]: value } }));
  };
  const togglePersona = (persona: SimulationPersona) => {
    setDraft((current) => {
      const selected = current.members.some((member) => member.personaId === persona.id);
      return {
        ...current,
        members: selected
          ? current.members.filter((member) => member.personaId !== persona.id)
          : [...current.members, { personaId: persona.id, count: 1 }],
      };
    });
  };
  const pressureControls: Array<{
    key: "meetingDensity" | "reactiveLoad" | "fragmentation";
    label: string;
  }> = [
    { key: "meetingDensity", label: "Meetings" },
    { key: "reactiveLoad", label: "Reactive" },
    { key: "fragmentation", label: "Fragmentation" },
  ];
  const spanMax = draft.span.unit === "years" ? 10 : draft.span.unit === "months" ? 60 : 260;
  const normalizedSpan = Math.max(4, Math.min(100, (totalWeeks / 260) * 100));

  useEffect(() => {
    setPersonaPickerOpen(false);
    setPersonaQuery("");
  }, [draft.executionMode]);

  return (
    <section className="sim-workflow sim-cockpit" aria-labelledby="sim-wizard-title">
      <header className="sim-page-header cockpit-header">
        <div>
          <span className="sim-kicker">Span simulator</span>
          <h1 id="sim-wizard-title" ref={headingRef} tabIndex={-1}>See what the workload becomes.</h1>
          <p>Set the people, pressure, and horizon. Weekform derives the rest.</p>
        </div>
        <div className="cockpit-header-actions">
          <button type="button" className="sim-button ghost" onClick={() => { setDraft(cloneGoldenConfig()); setPersonaPickerOpen(false); setPersonaQuery(""); }}><RotateCcw size={14} aria-hidden /> Reset</button>
          <SyntheticBadge />
        </div>
      </header>

      <div className="sim-mode-switch" role="radiogroup" aria-label="Simulation function">
        <label className={draft.executionMode === "fast-forward" ? "is-selected" : ""}>
          <input type="radio" name="simulation-function" checked={draft.executionMode === "fast-forward"} onChange={() => setDraft((current) => ({ ...current, executionMode: "fast-forward" }))} />
          <Database size={18} aria-hidden />
          <span><strong>Fast forward</strong><small>Weeks to years</small></span>
        </label>
        <label className={draft.executionMode === "local-playback" ? "is-selected" : ""}>
          <input type="radio" name="simulation-function" checked={draft.executionMode === "local-playback"} disabled={!playbackEnabled} onChange={() => setDraft((current) => ({ ...current, executionMode: "local-playback" }))} />
          <MousePointer2 size={18} aria-hidden />
          <span><strong>Watch live</strong><small>Local UI playback</small></span>
        </label>
      </div>

      <div className="cockpit-grid">
        <div className="cockpit-primary">
          <section className="cockpit-card people-card" aria-labelledby="sim-people-title">
            <header className="cockpit-card-header">
              <div><span className="cockpit-index">01</span><div><h2 id="sim-people-title">People</h2><p>{totalMembers} synthetic member{totalMembers === 1 ? "" : "s"}</p></div></div>
              <button className="sim-button secondary compact" type="button" aria-expanded={personaPickerOpen} onClick={() => setPersonaPickerOpen((current) => !current)}><Plus size={14} aria-hidden /> Add role</button>
            </header>
            <div className="selected-personas">
              {selectedPersonas.map(({ member, persona }) => (
                <article key={member.personaId}>
                  <div className="persona-monogram" aria-hidden>{persona?.role.split(" ").map((part) => part[0]).slice(0, 2).join("") ?? "WF"}</div>
                  <div><strong>{persona?.displayName ?? member.personaId}</strong><span>{persona?.role}</span></div>
                  <label><span className="sr-only">{persona?.displayName} count</span><button type="button" aria-label={`Remove one ${persona?.displayName}`} disabled={member.count <= 1} onClick={() => setDraft((current) => ({ ...current, members: current.members.map((item) => item.personaId === member.personaId ? { ...item, count: Math.max(1, item.count - 1) } : item) }))}>−</button><output>{member.count}</output><button type="button" aria-label={`Add one ${persona?.displayName}`} onClick={() => setDraft((current) => ({ ...current, members: current.members.map((item) => item.personaId === member.personaId ? { ...item, count: Math.min(20, item.count + 1) } : item) }))}>+</button></label>
                  <button className="remove-persona" type="button" aria-label={`Remove ${persona?.displayName}`} onClick={() => persona && togglePersona(persona)}><X size={14} aria-hidden /></button>
                </article>
              ))}
              {selectedPersonas.length === 0 && <button type="button" className="empty-persona" onClick={() => setPersonaPickerOpen(true)}><Plus size={17} aria-hidden /> Choose a role</button>}
            </div>
            {personaPickerOpen && (
              <div className="persona-picker" role="region" aria-label="Persona catalog">
                <label className="sim-search"><Search size={15} aria-hidden /><input autoFocus aria-label="Search persona catalog" placeholder="Find a role" value={personaQuery} onChange={(event) => setPersonaQuery(event.target.value)} /></label>
                <div>{visiblePersonas.map((persona) => {
                  const selected = draft.members.some((member) => member.personaId === persona.id);
                  return <button type="button" key={persona.id} aria-pressed={selected} onClick={() => togglePersona(persona)}><span className="persona-monogram" aria-hidden>{persona.role.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{persona.displayName}</strong><small>{persona.role}</small></span>{selected ? <Check size={15} aria-hidden /> : <Plus size={15} aria-hidden />}</button>;
                })}</div>
              </div>
            )}
          </section>

          <section className="cockpit-card pressure-card" aria-labelledby="sim-pressure-title">
            <header className="cockpit-card-header"><div><span className="cockpit-index">02</span><div><h2 id="sim-pressure-title">Pressure</h2><p>{scenarioLabel(draft.scenario.kind)}</p></div></div></header>
            <div className="scenario-presets cockpit-presets" role="group" aria-label="Scenario preset">
              {SCENARIOS.map((scenario) => <button type="button" key={scenario.id} aria-pressed={draft.scenario.kind === scenario.id} onClick={() => setDraft((current) => applyScenarioPreset(current, scenario.id))}>{scenario.label}</button>)}
            </div>
            <div className="pressure-controls">
              {pressureControls.map((control) => (
                <label key={control.key}>
                  <span>{control.label}<output>{draft.scenario[control.key]}%</output></span>
                  <input aria-label={`${control.label} pressure`} type="range" min={0} max={100} step={1} value={draft.scenario[control.key]} onChange={(event) => setScenarioField(control.key, Number(event.target.value))} />
                </label>
              ))}
            </div>
          </section>

          <details className="cockpit-advanced">
            <summary><SlidersHorizontal size={15} aria-hidden /><span><strong>Advanced setup</strong><small>Schedule, sharing, seed, and fine pressure</small></span><ChevronRight size={15} aria-hidden /></summary>
            <div className="advanced-grid">
              <label><span>Start date</span><input type="date" value={draft.startDate} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))} /></label>
              <label><span>Timezone</span><select value={draft.timezone} onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}>{TIMEZONES.map((timezone) => <option key={timezone}>{timezone}</option>)}</select></label>
              <label><span>Sharing</span><select value={draft.sharingPolicy.level} onChange={(event) => setDraft((current) => ({ ...current, sharingPolicy: { level: event.target.value as SharingLevel } }))}><option value="summary">Summary only</option><option value="summary+categories">Summary + categories</option><option value="summary+categories+projects">Summary + projects</option></select></label>
              <label><span>Seed</span><input value={draft.seed} onChange={(event) => setDraft((current) => ({ ...current, seed: event.target.value }))} /></label>
              <label><span>Workday starts</span><input type="time" value={draft.workingHours.start} onChange={(event) => setDraft((current) => ({ ...current, workingHours: { ...current.workingHours, start: event.target.value } }))} /></label>
              <label><span>Workday ends</span><input type="time" value={draft.workingHours.end} onChange={(event) => setDraft((current) => ({ ...current, workingHours: { ...current.workingHours, end: event.target.value } }))} /></label>
            </div>
            <div className="advanced-pressure-grid">
              <label><span>Interruptions <output>{draft.scenario.interruptions}%</output></span><input aria-label="Interruption pressure" type="range" min={0} max={100} step={1} value={draft.scenario.interruptions} onChange={(event) => setScenarioField("interruptions", Number(event.target.value))} /></label>
              <label><span>Overtime <output>{draft.scenario.overtime}%</output></span><input aria-label="Overtime pressure" type="range" min={0} max={100} step={1} value={draft.scenario.overtime} onChange={(event) => setScenarioField("overtime", Number(event.target.value))} /></label>
              <label><span>Projects <output>{draft.scenario.projectCount}</output></span><input aria-label="Concurrent projects" type="range" min={1} max={12} value={draft.scenario.projectCount} onChange={(event) => setScenarioField("projectCount", Number(event.target.value))} /></label>
            </div>
            <label className="advanced-direction"><span>Scenario direction</span><textarea rows={2} value={draft.scenario.direction} onChange={(event) => setScenarioField("direction", event.target.value)} /></label>
          </details>
        </div>

        <aside className="span-lens" aria-labelledby="sim-horizon-title">
          <header><span className="cockpit-index">03</span><span>Time lens</span></header>
          <div className="span-lens-value"><strong>{draft.span.value}</strong><span>{draft.span.unit}</span></div>
          <p id="sim-horizon-title">{totalWeeks} virtual weeks</p>
          <div className="span-lens-track" aria-hidden><span style={{ width: `${normalizedSpan}%` }} /><i /><i /><i /><i /></div>
          <label className="span-range"><span className="sr-only">Span duration</span><input type="range" min={1} max={spanMax} value={draft.span.value} onChange={(event) => setDraft((current) => ({ ...current, span: { ...current.span, value: Number(event.target.value) } }))} /></label>
          <div className="span-inputs"><label><span>Length</span><input type="number" min={1} max={spanMax} value={draft.span.value} onChange={(event) => setDraft((current) => ({ ...current, span: { ...current.span, value: Math.max(1, Math.min(spanMax, Number(event.target.value) || 1)) } }))} /></label><label><span>Unit</span><select value={draft.span.unit} onChange={(event) => setDraft((current) => ({ ...current, span: { value: Math.min(event.target.value === "years" ? 10 : event.target.value === "months" ? 60 : 260, current.span.value), unit: event.target.value as SimulationConfig["span"]["unit"] } }))}><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option></select></label></div>
          <div className="lens-metrics">
            <div><span>Member-weeks</span><strong>{formatNumber(memberWeeks)}</strong></div>
            <div><span>Evidence</span><strong>{formatNumber(memberWeeks * 460)}–{formatNumber(memberWeeks * 720)}</strong></div>
            <div><span>Snapshots</span><strong>{formatNumber(memberWeeks)}</strong></div>
          </div>
          <div className={`lens-readiness ${validation.valid ? "is-ready" : "is-blocked"}`} role="status">
            {validation.valid ? <ShieldCheck size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}
            <span><strong>{validation.valid ? "Ready" : "Needs attention"}</strong><small>{validation.valid ? "Deterministic and isolated" : validation.errors[0]}</small></span>
          </div>
          <button className="sim-button primary lens-launch" type="button" disabled={!validation.valid} onClick={onStart}>
            {draft.executionMode === "fast-forward" ? <Sparkles size={15} aria-hidden /> : <Play size={15} aria-hidden />}
            {draft.executionMode === "fast-forward" ? "Generate span" : "Start live"}
            <ArrowRight size={15} aria-hidden />
          </button>
          <p className="lens-trust"><LockKeyhole size={13} aria-hidden /> Synthetic only · local store · audited</p>
        </aside>
      </div>
    </section>
  );
}

function trapDialogFocus(event: React.KeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )).filter((element) => element.getAttribute("aria-hidden") !== "true");
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function RunScreen({ headingRef, run, livePaused, liveSpeed, onLivePausedChange, onLiveSpeedChange, onLiveComplete, onLiveFailure, onLiveRestart, onCancel, onResume, onResults }: { headingRef: React.RefObject<HTMLHeadingElement>; run: StoredSimulationRun; livePaused: boolean; liveSpeed: number; onLivePausedChange: (paused: boolean) => void; onLiveSpeedChange: (speed: number) => void; onLiveComplete: () => void; onLiveFailure: (message: string) => void; onLiveRestart: () => void; onCancel: () => void; onResume: () => void; onResults: () => void }) {
  const total = spanWeeks(run.config);
  const current = run.checkpoint.nextWeekIndex;
  const progress = Math.round((Math.min(current, total) / total) * 100);
  const phases = ["Signals", "Sessions", "Work blocks", "Review", "Capacity", "Forecasts", "Shared snapshots", "Validation"];
  const phase = phases[Math.min(phases.length - 1, current % phases.length)];
  const playback = useMemo(
    () => run.config.executionMode === "local-playback" ? buildLocalPlaybackPlan(run.config, window.location.origin) : null,
    [run.id, run.config.executionMode],
  );
  const awaitingLiveSequence = Boolean(playback && run.status === "running" && run.checkpoint.status === "complete");
  return (
    <section className="sim-run-screen" aria-labelledby="sim-run-title">
      <header className="sim-page-header run-header"><div><span className="sim-kicker">{run.status === "running" ? awaitingLiveSequence ? "Live sequence in progress" : "Generation in progress" : run.status === "complete" ? "Simulation complete" : "Generation checkpoint"}</span><h1 ref={headingRef} tabIndex={-1} id="sim-run-title">{run.name}</h1><p><SyntheticBadge compact /> <code>{run.id}</code> · seed <code>{run.config.seed}</code></p></div>{run.status === "running" ? <button className="sim-button danger" type="button" onClick={onCancel}><Pause size={15} aria-hidden /> Cancel run</button> : run.status === "canceled" || run.status === "failed" ? <button className="sim-button primary" type="button" onClick={onResume}><Play size={15} aria-hidden /> Resume checkpoint</button> : <button className="sim-button primary" type="button" onClick={onResults}>View results <ArrowRight size={15} aria-hidden /></button>}</header>
      {run.error && <div className="sim-inline-alert error" role="alert"><CircleAlert size={16} aria-hidden />{run.error}</div>}
      <section className="run-stage" aria-live="polite" aria-busy={run.status === "running"}>
        <div className="run-stage-top"><div className="run-pulse">{run.status === "running" ? <LoaderCircle className="spinning" size={20} aria-hidden /> : <Pause size={20} aria-hidden />}</div><div><span>Virtual clock</span><strong>{run.status === "running" ? awaitingLiveSequence ? "Live actions" : phase : run.status === "canceled" ? "Canceled safely" : run.status}</strong></div><b>{progress}%</b></div>
        <Weekline total={total} current={current} status={run.status} />
        <div className="run-facts"><div><span>Virtual week</span><strong>{Math.min(current + (run.status === "running" ? 1 : 0), total)} / {total}</strong></div><div><span>Persona</span><strong>{PERSONA_CATALOG.find((persona) => persona.id === run.config.members[0]?.personaId)?.displayName ?? "Synthetic member"}</strong></div><div><span>Phase</span><strong>{awaitingLiveSequence ? "Live UI" : phase}</strong></div><div><span>Checkpoint</span><strong>{formatTimestamp(run.updatedAt)}</strong></div></div>
      </section>
      {playback && (
        <LiveSimulationStage
          plan={playback}
          status={run.status}
          currentWeek={current}
          totalWeeks={total}
          paused={livePaused}
          speed={liveSpeed}
          onPausedChange={onLivePausedChange}
          onSpeedChange={onLiveSpeedChange}
          onComplete={onLiveComplete}
          onFailure={onLiveFailure}
          onRestart={onLiveRestart}
        />
      )}
      <section className="run-log"><header><span className="sim-kicker">Chunk log</span><strong>Resumable week checkpoints</strong></header><div>{Array.from({ length: current }, (_, index) => <div key={index}><CheckCircle2 size={14} aria-hidden /><span>Virtual week {index + 1}</span><small>Signals → sessions → work blocks → derived outputs</small></div>).reverse().slice(0, 8)}</div>{current === 0 && <p>Generation is preparing the first synthetic week.</p>}</section>
    </section>
  );
}

function ResultsScreen({ headingRef, run, otherRuns, compareId, onClone, onArchive, onDelete, onCompare }: { headingRef: React.RefObject<HTMLHeadingElement>; run: StoredSimulationRun; otherRuns: StoredSimulationRun[]; compareId: string; onClone: () => void; onArchive: () => void; onDelete: () => void; onCompare: (id: string) => void }) {
  const [tab, setTab] = useState<ResultTab>("decision");
  const dataset = run.dataset!;
  const latest = dataset.weeklySnapshots[dataset.weeklySnapshots.length - 1]?.payload;
  const resultTabs: Array<{ id: ResultTab; label: string }> = [
    { id: "decision", label: "Decision" },
    { id: "evidence", label: "Evidence" },
    { id: "forecast", label: "Forecast" },
    { id: "integrity", label: "Integrity" },
  ];
  const moveTab = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % resultTabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + resultTabs.length) % resultTabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = resultTabs.length - 1;
    else return;
    event.preventDefault();
    const tablist = event.currentTarget.parentElement;
    setTab(resultTabs[nextIndex].id);
    window.requestAnimationFrame(() => tablist?.querySelectorAll<HTMLButtonElement>("[role='tab']")[nextIndex]?.focus());
  };
  return (
    <section className="sim-results" aria-labelledby="sim-results-title">
      <header className="sim-page-header results-header"><div><span className="sim-kicker">Span complete · {scenarioLabel(run.config.scenario.kind)}</span><h1 ref={headingRef} tabIndex={-1} id="sim-results-title"><strong>{Math.round(latest?.reliable_new_work_capacity_pct ?? 0)}%</strong> reliable capacity</h1><p><SyntheticBadge compact /> {dataset.members.length} member{dataset.members.length === 1 ? "" : "s"} · {dataset.weeklySnapshots.length} member-weeks · <code>{compactId(dataset.canonicalFingerprint)}</code></p></div><div className="sim-header-actions"><button className="sim-button secondary" type="button" onClick={onClone}><Copy size={14} aria-hidden /> Clone</button><details className="result-export-menu"><summary className="sim-button secondary"><Download size={14} aria-hidden /> Export <ChevronRight size={13} aria-hidden /></summary><div><button type="button" onClick={() => downloadText(`${run.id}.json`, serializeSimulationJson(dataset), "application/json")}><FileJson size={14} aria-hidden /><span><strong>JSON dataset</strong><small>Canonical artifacts</small></span></button><button type="button" onClick={() => downloadText(`${run.id}-weeks.csv`, serializeWeeklySnapshotsCsv(dataset), "text/csv")}><Download size={14} aria-hidden /><span><strong>Weekly CSV</strong><small>Derived snapshots</small></span></button></div></details><button className="sim-icon-button" type="button" aria-label={run.archived ? "Restore run" : "Archive run"} onClick={onArchive}><Archive size={16} aria-hidden /></button><button className="sim-icon-button danger" type="button" aria-label="Permanently delete run" onClick={onDelete}><Trash2 size={16} aria-hidden /></button></div></header>
      {otherRuns.length > 0 && <label className="compare-select"><span>Compare with</span><select value={compareId} onChange={(event) => { if (event.target.value) onCompare(event.target.value); }}><option value="">Choose another completed run</option>{otherRuns.map((other) => <option key={other.id} value={other.id}>{other.name} · {other.config.seed}</option>)}</select></label>}
      <div className="sim-tabs result-tabs" role="tablist" aria-label="Simulation result views">{resultTabs.map((item, index) => <button type="button" role="tab" aria-controls={`result-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} key={item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)} onKeyDown={(event) => moveTab(event, index)}>{item.label}</button>)}</div>
      <div className="sim-tab-panel" role="tabpanel" id={`result-panel-${tab}`}>
        {tab === "decision" && <OverviewResult dataset={dataset} />}
        {tab === "evidence" && <div className="result-stack"><EvidenceResult dataset={dataset} /><WorkWorldResult dataset={dataset} /><TimelineResult dataset={dataset} /></div>}
        {tab === "forecast" && <div className="result-stack"><ForecastResult dataset={dataset} /><SharedResult dataset={dataset} /></div>}
        {tab === "integrity" && <div className="result-stack"><QualityResult dataset={dataset} /><AuditResult dataset={dataset} /></div>}
      </div>
    </section>
  );
}

function OverviewResult({ dataset }: { dataset: SimulationDataset }) {
  const latest = dataset.weeklySnapshots[dataset.weeklySnapshots.length - 1]?.payload;
  return <div className="result-stack"><div className="result-metrics"><Metric label="Artifacts" value={formatNumber(artifactCount(dataset))} helper="Canonical records" /><Metric label="Reactive load" value={`${Math.round(latest?.reactive_pct ?? 0)}%`} helper="Latest week" /><Metric label="Carryover risk" value={`${Math.round(latest?.carryover_risk_pct ?? 0)}%`} helper="Latest week" /><Metric label="Quality" value={`${Math.round(dataset.realismReport.score)}%`} helper={`${dataset.realismReport.checksRun} checks`} /></div><TrendChart weeks={dataset.weeklySnapshots} /><section className="result-section"><header><div><span className="sim-kicker">Provenance</span><h2>Weekform pipeline</h2></div><ShieldCheck size={18} aria-hidden /></header><div className="provenance-flow">{dataset.provenance.map((item, index) => <span key={item}>{item}{index < dataset.provenance.length - 1 && <ChevronRight size={13} aria-hidden />}</span>)}</div></section></div>;
}

function WorkWorldResult({ dataset }: { dataset: SimulationDataset }) {
  const workItems = [...(dataset.artifacts.workItems ?? [])].reverse();
  const communications = [...(dataset.artifacts.communications ?? [])].reverse();
  const businessRecords = [...(dataset.artifacts.businessRecords ?? [])].reverse();
  return (
    <div className="result-stack work-world-result">
      <div className="result-metrics">
        <Metric label="Duties & tasks" value={formatNumber(workItems.length)} helper="Role-specific work items" />
        <Metric label="Communications" value={formatNumber(communications.length)} helper="Chat, email, meetings, comments" />
        <Metric label="Business records" value={formatNumber(businessRecords.length)} helper="Bounded operating measures" />
        <Metric label="Projects" value={formatNumber(new Set(workItems.map((item) => item.payload.project)).size)} helper="Synthetic portfolio" />
      </div>
      <div className="result-grid two">
        <section className="result-section work-item-ledger">
          <header><div><span className="sim-kicker">Persona duties</span><h2>Concrete work across the span</h2></div><ClipboardCheck size={18} aria-hidden /></header>
          <div>{workItems.slice(0, 18).map((artifact) => <article key={artifact.stamp.canonicalArtifactId}><span className={`work-status ${artifact.payload.status}`}>{artifact.payload.status}</span><div><strong>{artifact.payload.title}</strong><p>{artifact.payload.deliverable}</p><small>{artifact.payload.project} · {artifact.payload.actualMinutes} min · due {formatTimestamp(artifact.payload.dueAt)}</small></div></article>)}</div>
        </section>
        <section className="result-section communication-ledger">
          <header><div><span className="sim-kicker">Communication rhythm</span><h2>Reasonable coordination, not random noise</h2></div><Activity size={18} aria-hidden /></header>
          <div>{communications.slice(0, 18).map((artifact) => <article key={artifact.stamp.canonicalArtifactId}><span>{artifact.payload.channel}</span><div><strong>{artifact.payload.subject}</strong><p>{artifact.payload.purpose}</p><small>{artifact.payload.stakeholderGroup} · {artifact.payload.messageCount} exchange{artifact.payload.messageCount === 1 ? "" : "s"} · {artifact.payload.responseMinutes} min response</small></div></article>)}</div>
        </section>
      </div>
      <section className="result-section business-records">
        <header><div><span className="sim-kicker">Synthetic business data</span><h2>Plausible measures tied back to the work</h2></div><BarChart3 size={18} aria-hidden /></header>
        <div>{businessRecords.slice(0, 24).map((artifact) => <article key={artifact.stamp.canonicalArtifactId}><span>{artifact.payload.label}</span><strong>{artifact.payload.value} <small>{artifact.payload.unit}</small></strong><p>Target {artifact.payload.target} · {artifact.payload.variancePct > 0 ? "+" : ""}{artifact.payload.variancePct}% · {artifact.payload.trend}</p><small>{artifact.payload.relatedProject}</small></article>)}</div>
      </section>
    </div>
  );
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
  return <section className="result-section trend-section"><header><div><span className="sim-kicker">{points.length} member-weeks</span><h2>Workload shape</h2></div><div className="trend-legend">{series.map((item) => <span className={item.className} key={item.key}><i />{item.label}</span>)}</div></header><svg viewBox="0 0 720 220" role="img" aria-label={`Line chart of capacity, reactive load, and meetings across ${points.length} synthetic member-weeks`}>{[0,25,50,75,100].map((tick) => <g key={tick}><line x1="24" x2="696" y1={18 + (1 - tick / 100) * 180} y2={18 + (1 - tick / 100) * 180} /><text x="20" y={22 + (1 - tick / 100) * 180} textAnchor="end">{tick}</text></g>)}{series.map((item) => <polyline key={item.key} className={item.className} points={coords(item.key)} />)}</svg><div className="sr-only"><table><caption>Weekly simulation trend values</caption><thead><tr><th>Week</th>{series.map((item) => <th key={item.key}>{item.label}</th>)}</tr></thead><tbody>{points.map((week) => <tr key={week.stamp.canonicalArtifactId}><th>{week.weekId}</th>{series.map((item) => <td key={item.key}>{Math.round(week.payload[item.key])}%</td>)}</tr>)}</tbody></table></div></section>;
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
  return <div className="result-stack"><div className={`quality-hero ${validated.valid && dataset.realismReport.valid ? "is-valid" : "is-warning"}`}><div className="quality-score"><strong>{Math.round(dataset.realismReport.score)}</strong><span>/100 constraints</span></div><div><h2>{validated.valid && dataset.realismReport.valid ? "Constraints and privacy checks passed" : "Quality checks found issues"}</h2><p>{dataset.realismReport.checksRun} dataset constraints cover provenance, privacy, links, and plausible business bounds. Synthetic provenance remains inspectable on every artifact.</p></div></div><section className="result-section"><header><div><span className="sim-kicker">Constraint report</span><h2>{violations.length} violation{violations.length === 1 ? "" : "s"}</h2></div></header>{violations.length === 0 ? <div className="quality-pass"><CheckCircle2 size={18} aria-hidden /><div><strong>No provenance, privacy, span, work-link, or business-bound violations found.</strong><p>The same seed and versioned inputs can be replayed to confirm determinism.</p></div></div> : <div className="violation-list">{violations.map((item, index) => <article key={`${item.code}-${index}`} data-severity={item.severity}><span>{item.severity}</span><div><strong>{item.code}</strong><p>{item.message}</p></div><code>{item.weekId ?? item.artifactId ?? "run"}</code></article>)}</div>}</section></div>;
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
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [left, right] = runs;
  const leftWeeks = left.dataset!.weeklySnapshots;
  const rightWeeks = right.dataset!.weeklySnapshots;
  const leftLatest = leftWeeks[leftWeeks.length - 1].payload;
  const rightLatest = rightWeeks[rightWeeks.length - 1].payload;
  const rows = [{ label: "Reliable capacity", left: leftLatest.reliable_new_work_capacity_pct, right: rightLatest.reliable_new_work_capacity_pct }, { label: "Reactive load", left: leftLatest.reactive_pct, right: rightLatest.reactive_pct }, { label: "Meeting load", left: leftLatest.meeting_pct, right: rightLatest.meeting_pct }, { label: "Fragmentation", left: leftLatest.fragmented_work_pct, right: rightLatest.fragmented_work_pct }];
  useEffect(() => {
    closeRef.current?.focus();
    return () => restoreFocusRef.current?.focus();
  }, []);
  return <div className="compare-overlay" role="presentation"><div className="compare-panel" role="dialog" aria-modal="true" aria-labelledby="compare-title" onKeyDown={(event) => trapDialogFocus(event, onClose)}><header><div><span className="sim-kicker">Side-by-side run comparison</span><h2 id="compare-title">Different conditions, inspectable outcomes</h2><p>Deltas describe workload shape; they never rank people or imply performance.</p></div><button ref={closeRef} type="button" aria-label="Close comparison" onClick={onClose}><X size={17} aria-hidden /></button></header><div className="compare-head"><div><SyntheticBadge compact /><strong>{left.name}</strong><span>Seed {left.config.seed} · {left.config.span.value} {left.config.span.unit}</span></div><div><SyntheticBadge compact /><strong>{right.name}</strong><span>Seed {right.config.seed} · {right.config.span.value} {right.config.span.unit}</span></div></div><div className="compare-table">{rows.map((row) => <div key={row.label}><span>{row.label}</span><strong>{Math.round(row.left)}%</strong><b>{Math.round(row.right - row.left) > 0 ? "+" : ""}{Math.round(row.right - row.left)} pts</b><strong>{Math.round(row.right)}%</strong></div>)}</div><div className="compare-quality"><span>{Math.round(left.dataset!.realismReport.score)}/100 constraints</span><span>{Math.round(right.dataset!.realismReport.score)}/100 constraints</span></div></div></div>;
}

function PersonaCatalog({ headingRef, onUse }: { headingRef: React.RefObject<HTMLHeadingElement>; onUse: (persona: SimulationPersona) => void }) {
  const [selected, setSelected] = useState(PERSONA_CATALOG[0]);
  return <section className="persona-catalog" aria-labelledby="persona-catalog-title"><header className="sim-page-header"><div><span className="sim-kicker">Versioned realism system</span><h1 ref={headingRef} tabIndex={-1} id="persona-catalog-title">Persona catalog</h1><p>Role-specific constraints create correlated work rhythms instead of random noise.</p></div><SyntheticBadge /></header><div className="catalog-layout"><nav aria-label="Simulation personas">{PERSONA_CATALOG.map((persona) => <button type="button" className={selected.id === persona.id ? "is-active" : ""} key={persona.id} onClick={() => setSelected(persona)}><UserRoundCog size={16} aria-hidden /><span><strong>{persona.displayName}</strong><small>{persona.role} · v{persona.version}</small></span></button>)}</nav><article className="catalog-detail"><header><div><SyntheticBadge compact /><h2>{selected.displayName}</h2><p>{selected.role} · schema {selected.schemaVersion} · v{selected.version}</p></div><button className="sim-button primary" type="button" onClick={() => onUse(selected)}>Use persona <ArrowRight size={14} aria-hidden /></button></header><div className="catalog-sections"><section><h3>Responsibilities</h3><ul>{selected.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul></section><section><h3>Projects</h3><div className="sim-chip-list">{selected.projects.map((item) => <span key={item}>{item}</span>)}</div></section><section><h3>Deep-work cadence</h3><p>{selected.deepWorkCadence.blockMinutes.typical}-minute blocks, usually starting at {selected.deepWorkCadence.preferredStartHours.map((hour) => `${hour}:00`).join(" or ")}.</p></section><section><h3>Reactive profile</h3><p>{selected.reactiveLoad.typicalPercent}% typical reactive load with {selected.reactiveLoad.burstsPerDay.typical} bursts per day.</p></section><section><h3>App context families</h3><div className="sim-chip-list">{selected.appContexts.map((item) => <span key={item.family}>{item.family} · {item.appName}</span>)}</div></section><section><h3>Seasonal pressures</h3><ul>{selected.seasonalPressures.map((item) => <li key={item}>{item}</li>)}</ul></section></div></article></div></section>;
}

function ConfirmPlayback({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    cancelRef.current?.focus();
    return () => restoreFocusRef.current?.focus();
  }, []);
  return <div className="sim-dialog-overlay"><section className="sim-dialog" role="alertdialog" aria-modal="true" aria-labelledby="playback-confirm-title" onKeyDown={(event) => trapDialogFocus(event, onCancel)}><div className="sim-dialog-icon"><ShieldCheck size={20} aria-hidden /></div><h2 id="playback-confirm-title">Confirm controlled live simulation</h2><p>Weekform will run an embedded, same-origin synthetic business session and operate the real Weekform demo UI. It will not move the macOS cursor, automate external applications, use real credentials, or permit network mutations.</p><ul><li><Check size={13} aria-hidden /> Pause or cancel immediately</li><li><Check size={13} aria-hidden /> Synthetic identities and in-memory Weekform state only</li><li><Check size={13} aria-hidden /> Same persona work catalog as Generate span</li></ul><div className="sim-dialog-actions"><button ref={cancelRef} className="sim-button secondary" type="button" onClick={onCancel}>Cancel</button><button className="sim-button primary" type="button" onClick={onConfirm}>Confirm and start simulation</button></div></section></div>;
}

function DeleteRunDialog({ run, onCancel, onDelete }: { run: StoredSimulationRun; onCancel: () => void; onDelete: () => void }) {
  const [value, setValue] = useState("");
  return <div className="sim-dialog-overlay"><section className="sim-dialog danger-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-run-title"><div className="sim-dialog-icon"><Trash2 size={20} aria-hidden /></div><h2 id="delete-run-title">Permanently delete this run?</h2><p>This removes the checkpoint, canonical artifacts, weekly snapshots, quality report, and synthetic audit history from the local simulator store.</p><label><span>Type <code>{run.id}</code> to confirm</span><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} /></label><div className="sim-dialog-actions"><button className="sim-button secondary" type="button" onClick={onCancel}>Cancel</button><button className="sim-button danger" type="button" disabled={value !== run.id} onClick={onDelete}>Delete permanently</button></div></section></div>;
}

function MissingRun({ headingRef, onHistory }: { headingRef: React.RefObject<HTMLHeadingElement>; onHistory: () => void }) {
  return <section className="sim-empty full"><Database size={24} aria-hidden /><h1 ref={headingRef} tabIndex={-1}>This simulation is not available.</h1><p>It may have been deleted, or its generated dataset is not complete yet.</p><button type="button" onClick={onHistory}>Return to run history</button></section>;
}

function SimulatorSandbox({ surface }: { surface: string }) {
  const personaId = new URLSearchParams(window.location.search).get("persona") ?? "data-analyst";
  const persona = PERSONA_CATALOG.find((entry) => entry.id === personaId) ?? PERSONA_CATALOG[0];
  const catalog = getPersonaWorkCatalog(persona.id)!;
  const surfaceName = surface.replace(/-/g, " ");
  const [openedItem, setOpenedItem] = useState<string | null>(null);
  const [replyPrepared, setReplyPrepared] = useState(false);
  const surfaceTitle = {
    projects: "Priority work queue",
    documents: "Work product draft",
    chat: "Stakeholder coordination",
    bi: "Operating measures",
    code: "Delivery workspace",
    crm: "Relationship workspace",
    email: "Synthetic correspondence",
    meetings: "Working session",
  }[surface] ?? "Synthetic workspace";

  return (
    <main className="sandbox-app">
      <header><div><WeekformMark /><strong>Weekform Business Sandbox</strong></div><SyntheticBadge /><span>Localhost only · no external mutations</span></header>
      <section>
        <aside>
          <span className="sim-kicker">{persona.role} workspace</span>
          <h1>{surfaceName}</h1>
          <p>{persona.responsibilities[0]}</p>
          <nav>{["Queue", "Work", "Measures", "Decisions"].map((item, index) => <button type="button" key={item} className={index === 1 ? "is-active" : ""}>{item}</button>)}</nav>
        </aside>
        <div className="sandbox-workspace">
          <header>
            <div><span className="sim-kicker">SIMULATED · {surfaceTitle}</span><h2>{catalog.duties[0].title}</h2><p>{catalog.duties[0].deliverable}</p></div>
            <button type="button" data-synthetic-action="open-work-item" onClick={() => setOpenedItem(catalog.duties[0].id)}>{openedItem ? "Work item open" : "Open priority item"}</button>
          </header>

          {surface === "documents" && (
            <label className="sim-full-field sandbox-note-field"><span>SIMULATED work note</span><textarea data-synthetic-input="notes" defaultValue="" placeholder={`Draft ${catalog.duties[0].deliverable.toLowerCase()}`} /></label>
          )}
          {surface === "chat" && (
            <section className="sandbox-conversation" aria-label="Synthetic stakeholder conversation">
              <div><span>{persona.stakeholders[0]}</span><p><strong>SIMULATED</strong> {catalog.communicationPatterns[0].subject}. Can you confirm the decision boundary and timing?</p></div>
              {replyPrepared && <div className="is-reply"><span>{persona.displayName}</span><p><strong>SIMULATED</strong> I have the request. I’ll attach the evidence and confirm the next step in the work record.</p></div>}
              <button type="button" data-synthetic-action="reply" onClick={() => setReplyPrepared(true)}>{replyPrepared ? "Mock reply prepared" : "Prepare mock reply"}</button>
            </section>
          )}

          <div className="sandbox-measures" aria-label="Synthetic business measures">
            {catalog.businessMeasures.map((measure) => <article key={measure.label}><span>{measure.label}</span><strong>{measure.baseline} <small>{measure.unit}</small></strong><p>Target {measure.target} · plausible {measure.plausibleMin}–{measure.plausibleMax}</p></article>)}
          </div>
          <div className="sandbox-grid">
            {catalog.duties.map((duty, index) => <article key={duty.id} className={openedItem === duty.id ? "is-open" : ""}><span>{duty.category}</span><strong>SIMULATED — {duty.title}</strong><p>{duty.deliverable}</p><footer><em>{duty.typicalMinutes} min</em><b>{duty.priority}</b></footer><button type="button" onClick={() => setOpenedItem(duty.id)}>{openedItem === duty.id ? "Selected" : "Open work item"}</button></article>)}
          </div>
        </div>
      </section>
      <footer><ShieldCheck size={14} aria-hidden /> Embedded synthetic session · same-origin only · no network writes · cancel from Simulation</footer>
    </main>
  );
}

function SimulatorSandboxLocked() {
  return <main className="sim-access-shell"><section className="sim-access-card" aria-labelledby="sandbox-locked-title"><div className="sim-access-mark"><LockKeyhole /></div><span className="sim-kicker">Weekform live simulation</span><h1 id="sandbox-locked-title">Synthetic surface is locked.</h1><p>This route is available only inside the local development Simulation tool and only for an allowlisted same-origin business surface.</p><div className="sim-gate-note"><ShieldCheck size={17} aria-hidden /><div><strong>Development-only boundary</strong><span>Open Live simulation through authenticated Manager Access; production and external URLs remain blocked.</span></div></div><a className="sim-button secondary" href="/manager-access/simulation">Return to Simulation</a></section></main>;
}
