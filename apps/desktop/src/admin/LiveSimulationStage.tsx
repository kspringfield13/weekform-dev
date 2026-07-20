import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Gauge,
  MousePointer2,
  Pause,
  Play,
  RefreshCcw,
  ShieldCheck,
  SkipForward,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { getPersona } from "../../../../packages/simulator/src/personas";
import { isAllowedPlaybackUrl } from "../../../../packages/simulator/src/playback";
import type { LocalPlaybackAction, LocalPlaybackPlan } from "../../../../packages/simulator/src/types";

type LiveRunStatus = "running" | "canceled" | "complete" | "failed";

interface TranscriptEntry {
  id: string;
  label: string;
  detail: string;
  appName: string;
}

interface CursorPosition {
  x: number;
  y: number;
  visible: boolean;
  pressing: boolean;
}

function findTarget(
  frame: HTMLIFrameElement,
  selector: string,
  signal: AbortSignal,
): Promise<HTMLElement | null> {
  const document = frame.contentDocument;
  if (!document) return Promise.resolve(null);
  const existing = document.querySelector<HTMLElement>(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (target: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve(target);
    };
    const observer = new MutationObserver(() => {
      const target = document.querySelector<HTMLElement>(selector);
      if (target) finish(target);
    });
    const timeout = window.setTimeout(() => finish(null), 2600);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    signal.addEventListener("abort", () => finish(null), { once: true });
  });
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => resolve(true), milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      resolve(false);
    }, { once: true });
  });
}

function setInputValue(target: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = target instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(target, value);
  target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

function actionReceipt(action: LocalPlaybackAction) {
  if (action.surface === "weekform" && action.selector === ".block-confirm") {
    return "Real demo handler → in-memory review state updated";
  }
  if (action.surface === "weekform" && action.selector === "[data-tour='week']") {
    return "Real Weekform navigation → capacity surface opened";
  }
  if (action.surface === "weekform") return "Real Weekform demo interaction completed";
  if (action.type === "type") return "Synthetic work note staged in the local sandbox";
  if (action.appName.includes("Chat")) return "Synthetic communication staged in the local sandbox";
  return "Scripted role action completed in the local sandbox";
}

export function LiveSimulationStage({
  plan,
  status,
  currentWeek,
  totalWeeks,
  paused,
  speed,
  onPausedChange,
  onSpeedChange,
  onComplete,
  onFailure,
  onRestart,
}: {
  plan: LocalPlaybackPlan;
  status: LiveRunStatus;
  currentWeek: number;
  totalWeeks: number;
  paused: boolean;
  speed: number;
  onPausedChange: (paused: boolean) => void;
  onSpeedChange: (speed: number) => void;
  onComplete: () => void;
  onFailure: (message: string) => void;
  onRestart: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onCompleteRef = useRef(onComplete);
  const onFailureRef = useRef(onFailure);
  const onRestartRef = useRef(onRestart);
  const previousStatusRef = useRef(status);
  const firstActionUrl = plan.actions[0]?.url;
  const safeFirstActionUrl = firstActionUrl && isAllowedPlaybackUrl(firstActionUrl) ? firstActionUrl : "about:blank";
  const [actionIndex, setActionIndex] = useState(0);
  const [frameUrl, setFrameUrl] = useState(safeFirstActionUrl);
  const [frameReady, setFrameReady] = useState(false);
  const [stepRequested, setStepRequested] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [cursor, setCursor] = useState<CursorPosition>({ x: 80, y: 90, visible: false, pressing: false });
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const action = plan.actions[actionIndex];
  const sequenceComplete = plan.actions.length > 0 && actionIndex >= plan.actions.length && !failure;
  const persona = getPersona(action?.personaId ?? plan.actions[0]?.personaId ?? "");
  const displayedAppName = action?.appName
    ?? (sequenceComplete ? plan.actions[plan.actions.length - 1]?.appName : undefined)
    ?? "Preparing simulation";
  const progress = Math.round((Math.min(currentWeek, Math.max(1, totalWeeks)) / Math.max(1, totalWeeks)) * 100);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onFailureRef.current = onFailure;
    onRestartRef.current = onRestart;
  }, [onComplete, onFailure, onRestart]);

  useEffect(() => {
    const firstUrl = plan.actions[0]?.url;
    const nextFailure = !firstUrl || !isAllowedPlaybackUrl(firstUrl)
      ? "The live simulation plan has no safe first action."
      : null;
    setActionIndex(0);
    setFrameUrl(nextFailure ? "about:blank" : firstUrl);
    setFrameReady(false);
    setTranscript([]);
    setFailure(nextFailure);
    setCursor((current) => ({ ...current, visible: false, pressing: false }));
  }, [plan]);

  useEffect(() => {
    if (failure) onFailureRef.current(failure);
  }, [failure]);

  useEffect(() => {
    if (status !== "running") {
      setCursor((current) => ({ ...current, visible: false, pressing: false }));
    }
  }, [status]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    if (status !== "running" || previousStatus === "running") return;
    const firstUrl = plan.actions[0]?.url;
    const nextFailure = !firstUrl || !isAllowedPlaybackUrl(firstUrl)
      ? "The live simulation plan has no safe first action."
      : null;
    setActionIndex(0);
    setFrameUrl(nextFailure ? "about:blank" : firstUrl);
    setFrameReady(false);
    setStepRequested(false);
    setTranscript([]);
    setFailure(nextFailure);
    setCursor((current) => ({ ...current, visible: false, pressing: false }));
  }, [plan, status]);

  useEffect(() => {
    if (!action || status !== "running" || failure || (paused && !stepRequested)) return;
    const controller = new AbortController();
    const { signal } = controller;

    const execute = async () => {
      if (!isAllowedPlaybackUrl(action.url)) {
        setFailure("The next playback URL is outside the simulation allowlist.");
        return;
      }
      if (frameUrl !== action.url) {
        setFrameReady(false);
        setFrameUrl(action.url);
        return;
      }
      if (!frameReady) return;

      const frame = frameRef.current;
      const viewport = viewportRef.current;
      if (!frame || !viewport) return;
      const target = action.selector ? await findTarget(frame, action.selector, signal) : null;
      if (signal.aborted) return;
      if (action.selector && !target) {
        setFailure(`The live simulator could not find its allowlisted target: ${action.label}`);
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const targetRect = target?.getBoundingClientRect();
      const nextPosition = targetRect
        ? {
            x: frameRect.left - viewportRect.left + targetRect.left + Math.min(targetRect.width / 2, 56),
            y: frameRect.top - viewportRect.top + targetRect.top + Math.min(targetRect.height / 2, 24),
          }
        : { x: Math.max(80, frameRect.width * 0.56), y: Math.max(92, frameRect.height * 0.34) };
      setCursor({ ...nextPosition, visible: true, pressing: false });
      if (!await wait(reducedMotion ? 80 : Math.round(460 / speed), signal)) return;

      if (action.type === "click" && target) {
        setCursor((current) => ({ ...current, pressing: true }));
        target.click();
        if (!await wait(reducedMotion ? 60 : 150, signal)) return;
        setCursor((current) => ({ ...current, pressing: false }));
      } else if (action.type === "type" && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        setInputValue(target, action.value ?? "");
        setCursor((current) => ({ ...current, pressing: true }));
        if (!await wait(reducedMotion ? 60 : 140, signal)) return;
        setCursor((current) => ({ ...current, pressing: false }));
      }

      if (!await wait(Math.max(260, Math.round((action.durationMs ?? 800) / speed)), signal)) return;
      setTranscript((current) => [{ id: action.actionId, label: action.label, detail: actionReceipt(action), appName: action.appName }, ...current].slice(0, 7));
      const nextIndex = actionIndex + 1;
      setActionIndex(nextIndex);
      if (nextIndex >= plan.actions.length) {
        setCursor((current) => ({ ...current, visible: false, pressing: false }));
        onCompleteRef.current();
      }
      if (stepRequested) setStepRequested(false);
    };

    void execute();
    return () => controller.abort();
  }, [action, actionIndex, failure, frameReady, frameUrl, paused, plan.actions.length, reducedMotion, speed, status, stepRequested]);

  const restart = () => {
    const firstUrl = plan.actions[0]?.url;
    if (!firstUrl || !isAllowedPlaybackUrl(firstUrl)) {
      setFailure("The live simulation plan has no safe first action.");
      return;
    }
    setActionIndex(0);
    setFrameUrl(firstUrl);
    setFrameReady(false);
    setTranscript([]);
    setFailure(null);
    setCursor((current) => ({ ...current, visible: false, pressing: false }));
    onPausedChange(false);
    onRestartRef.current();
  };

  return (
    <section className="live-simulation" aria-labelledby="live-simulation-title">
      <header className="live-simulation-header">
        <div>
          <span className="sim-kicker">Live simulation</span>
          <h2 id="live-simulation-title">Watch role work move into Weekform</h2>
          <p>{persona?.displayName ?? "Synthetic persona"} · scripted business work and matching persona-shaped demo evidence, followed by real Weekform review and navigation handlers.</p>
        </div>
        <div className="live-controls" aria-label="Live simulation controls">
          <span className={`live-status ${failure ? "failed" : sequenceComplete ? "complete" : paused ? "paused" : status}`}>
            {failure ? <CircleAlert size={13} aria-hidden /> : sequenceComplete || status === "complete" ? <CheckCircle2 size={12} aria-hidden /> : status === "running" && !paused ? <span aria-hidden /> : <Pause size={12} aria-hidden />}
            {failure ? "Blocked" : sequenceComplete ? "Sequence complete" : paused ? "Paused" : status}
          </span>
          <button type="button" disabled={status !== "running" || Boolean(failure) || sequenceComplete} onClick={() => onPausedChange(!paused)}>
            {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}{paused ? "Resume" : "Pause"}
          </button>
          <button type="button" disabled={!paused || status !== "running" || Boolean(failure) || sequenceComplete} onClick={() => setStepRequested(true)}>
            <SkipForward size={14} aria-hidden /> Step
          </button>
          <label><span>Speed</span><select aria-label="Simulation speed" value={speed} onChange={(event) => onSpeedChange(Number(event.target.value))}><option value={0.75}>0.75×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label>
          <button type="button" disabled={status !== "running" || Boolean(failure)} aria-label="Restart live action sequence" onClick={restart}><RefreshCcw size={14} aria-hidden /></button>
        </div>
      </header>

      <div className="live-span-rail" aria-label={`Virtual span progress ${progress}%`}>
        <div><span>Business action</span><ChevronRight size={13} aria-hidden /><span>Staged context</span><ChevronRight size={13} aria-hidden /><span>Demo review</span><ChevronRight size={13} aria-hidden /><strong>Weekform decision</strong></div>
        <i><b style={{ width: `${progress}%` }} /></i>
        <small>Virtual week {Math.min(currentWeek + (status === "running" ? 1 : 0), totalWeeks)} of {totalWeeks}</small>
      </div>

      {failure && (
        <div className="sim-inline-alert error" role="alert"><CircleAlert size={16} aria-hidden />{failure}<button type="button" onClick={restart}>Restart safely</button></div>
      )}

      <div className="live-stage-layout">
        <div className="live-viewport" ref={viewportRef}>
          <div className="live-window-chrome">
            <div aria-hidden><i /><i /><i /></div>
            <strong>{displayedAppName}</strong>
            <span><ShieldCheck size={12} aria-hidden /> SIMULATED · LOCAL ONLY</span>
          </div>
          <iframe
            ref={frameRef}
            className="live-simulation-frame"
            src={frameUrl}
            title={`Synthetic ${persona?.role ?? "work"} simulation surface`}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            onLoad={() => setFrameReady(true)}
          />
          <div
            className={`simulated-cursor${cursor.visible ? " is-visible" : ""}${cursor.pressing ? " is-pressing" : ""}`}
            style={{ transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)` }}
            aria-hidden="true"
          >
            <MousePointer2 size={25} fill="currentColor" />
            <span />
          </div>
          <div className="live-now-card" aria-live="polite">
            <span>{status === "complete" ? "Simulation complete" : sequenceComplete ? "Action sequence complete" : action?.surface === "weekform" ? "Inside Weekform" : "Doing simulated work"}</span>
            <strong>{status === "complete" ? "The evidence loop reached its final checkpoint" : sequenceComplete ? "Waiting for deterministic span generation" : action?.label ?? "Preparing the first action"}</strong>
            <small>{status === "complete" ? "Inspect the transcript or open the generated span results." : sequenceComplete ? "The run completes only after both this sequence and the span engine finish." : action?.detail}</small>
          </div>
        </div>

        <aside className="live-transcript" aria-label="Simulation evidence transcript">
          <header><div><span className="sim-kicker">Evidence ribbon</span><h3>Action → response</h3></div><Gauge size={16} aria-hidden /></header>
          <div className="live-next-action">
            <span>{status === "complete" ? "Final" : sequenceComplete ? "Ready" : "Now"}</span><strong>{status === "complete" ? "Simulation span complete" : sequenceComplete ? "Live action sequence complete" : action?.label}</strong><small>{status === "complete" ? "Weekform evidence retained below" : sequenceComplete ? "Waiting for the deterministic engine" : action?.appName}</small>
          </div>
          <ol role="log" aria-live="polite" aria-relevant="additions">
            {transcript.map((entry) => (
              <li key={entry.id}><CheckCircle2 size={14} aria-hidden /><div><span>{entry.appName}</span><strong>{entry.label}</strong><small>{entry.detail}</small></div></li>
            ))}
          </ol>
          {transcript.length === 0 && <p className="live-transcript-empty">The first completed business action will appear here with the Weekform evidence it creates.</p>}
        </aside>
      </div>
    </section>
  );
}
