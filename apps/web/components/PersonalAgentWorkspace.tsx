"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import styles from "./PersonalAgentWorkspace.module.css";

function pct(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function AgentSignalMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="personal-agent-mark"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2.5 12c1.6-4.8 3.15-4.8 4.75 0s3.15 4.8 4.75 0 3.15-4.8 4.75 0 3.15 4.8 4.75 0" />
    </svg>
  );
}

type StarterIconKind = "calendar" | "clock" | "shield" | "brain";

function StarterIcon({ kind }: { kind: StarterIconKind }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "calendar" ? <><path d="M8 2v4M16 2v4M3 10h18" /><rect x="3" y="4" width="18" height="17" rx="2" /></> : null}
      {kind === "clock" ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> : null}
      {kind === "shield" ? <><path d="M12 3 5 6v5c0 4.5 2.7 8.1 7 10 4.3-1.9 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></> : null}
      {kind === "brain" ? <><path d="M9.5 4.5A3 3 0 0 0 5 7a3 3 0 0 0-1 5.5A3.5 3.5 0 0 0 9.5 18M14.5 4.5A3 3 0 0 1 19 7a3 3 0 0 1 1 5.5 3.5 3.5 0 0 1-5.5 5.5M9.5 4.5v15M14.5 4.5v15M7 10h2.5M14.5 14H17" /></> : null}
    </svg>
  );
}

const STARTER_ACTIONS = [
  {
    icon: "calendar",
    title: "Plan within my capacity",
    description: "Shape a realistic week from the capacity you can rely on.",
    prompt: "Help me plan the rest of my week within my reliable capacity.",
  },
  {
    icon: "clock",
    title: "Summarize today",
    description: "Turn published workload signals into a clear weekly recap.",
    prompt: "Summarize what the latest review-safe workload summary says about my week.",
  },
  {
    icon: "shield",
    title: "Find workload risks",
    description: "Surface fragmentation, reactive load, and likely carryover.",
    prompt: "Find the biggest workload risks in my current week and explain what is driving them.",
  },
  {
    icon: "brain",
    title: "Explain what changed",
    description: "Compare planned and reactive work using your local evidence.",
    prompt: "Explain my planned versus reactive workload from the latest published summary.",
  },
] as const;

interface AgentReply {
  answer: string;
  evidence: string[];
  limitations: string[];
  mode: "model" | "fallback" | "mac_handoff";
  fallbackReason?: "not_configured" | "provider_error" | "timeout" | "invalid_response";
  model?: string;
}

interface ConversationTurn extends AgentReply {
  question: string;
}

function isAgentReply(value: unknown): value is AgentReply {
  if (typeof value !== "object" || value === null) return false;
  const reply = value as Record<string, unknown>;
  return typeof reply.answer === "string"
    && Array.isArray(reply.evidence) && reply.evidence.every((item) => typeof item === "string")
    && Array.isArray(reply.limitations) && reply.limitations.every((item) => typeof item === "string")
    && (reply.mode === "model" || reply.mode === "fallback" || reply.mode === "mac_handoff");
}

function responseLabel(turn: ConversationTurn): string {
  if (turn.mode === "model") return `AI answer${turn.model ? ` · ${turn.model}` : ""}`;
  if (turn.mode === "mac_handoff") return "Mac approval required · no action run";
  if (turn.fallbackReason === "timeout") return "Review-safe fallback · provider timed out";
  if (turn.fallbackReason === "provider_error" || turn.fallbackReason === "invalid_response") return "Review-safe fallback · provider unavailable";
  return "Review-safe answer · AI provider not configured";
}

export function PersonalAgentWorkspace({ replica }: { replica: PersonalWorkloadReplicaV1 | null }) {
  const capacity = replica?.capacity;
  const hasSignal = Boolean(replica);
  const currentStatus = hasSignal ? `Data current · ${replica?.weekId}` : "Waiting for signal";
  const carryover = pct(capacity?.carryoverRiskPct);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(nextQuestion: string) {
    const cleanQuestion = nextQuestion.trim();
    if (!hasSignal || isSending || !cleanQuestion || cleanQuestion.length > 600) return;
    setError(null);
    setIsSending(true);
    try {
      const response = await fetch("/api/personal-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: cleanQuestion }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : "Weekform Agent could not answer right now. Try again.";
        setError(message);
        return;
      }
      if (!isAgentReply(payload)) {
        setError("Weekform Agent returned an invalid response. Nothing was applied.");
        return;
      }
      setTurns((current) => [...current, { ...payload, question: cleanQuestion }].slice(-24));
      setQuestion("");
    } catch {
      setError("Weekform Agent could not reach the server. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <section className="web-desktop-screen personal-agent-workspace" aria-labelledby="personal-agent-title">
      <header className="personal-agent-page-header">
        <div>
          <p className="personal-agent-eyebrow">Ask Agent</p>
          <div className="personal-agent-title-row">
            <span className="personal-agent-title-icon"><AgentSignalMark /></span>
            <h1 id="personal-agent-title">Weekform Agent</h1>
          </div>
          <p>Understand your capacity and decide what to work on next.</p>
        </div>
        <span className={`personal-agent-freshness${hasSignal ? "" : " is-waiting"}`}>
          <span aria-hidden="true" />
          {currentStatus}
        </span>
      </header>

      <div className="personal-agent-workspace-body">
        <section className="personal-agent-briefing" aria-label="Current workload context">
          <p>
            <AgentSignalMark size={13} />
            {hasSignal ? (
              <span>
                <strong>Reliable capacity {pct(capacity?.reliableNewWorkCapacityPct)}</strong> this week · Planned{" "}
                {pct(capacity?.plannedPct)} / Reactive {pct(capacity?.reactivePct)} · carryover risk {carryover} — the full
                breakdown lives on the Week screen.
              </span>
            ) : (
              <span>No review-safe week is connected yet — open Weekform for Mac to publish a derived summary.</span>
            )}
          </p>
          <span className="personal-agent-briefing-boundary">Private supporting evidence stays local</span>
        </section>

        <section className="personal-agent-starters" aria-label="Suggested agent actions">
          <div className="personal-agent-starter-heading">
            <span>Common questions</span>
            <p>Grounded only in the review-safe summary published by your Mac. Raw supporting evidence stays local.</p>
          </div>
          <div className="personal-agent-starter-grid">
            {STARTER_ACTIONS.map((action) => (
              <button
                key={action.title}
                type="button"
                disabled={!hasSignal || isSending}
                aria-disabled={!hasSignal || isSending}
                title={!hasSignal ? `${action.title} needs a review-safe week from Weekform for Mac` : undefined}
                onClick={() => void ask(action.prompt)}
              >
                <span className="personal-agent-starter-icon"><StarterIcon kind={action.icon} /></span>
                <span><strong>{action.title}</strong><small>{action.description}</small></span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </section>

        <div className={`personal-agent-chat-shell${turns.length ? ` ${styles.hasConversation}` : ""}`} aria-live="polite">
          {!hasSignal ? <div className="personal-agent-boundary" role="status">
            <span className="personal-agent-boundary-mark"><AgentSignalMark size={18} /></span>
            <div>
              <h2>Connect a review-safe week to use Web Ask.</h2>
              <p>
                Weekform Web does not receive raw activity, titles, notes, screenshots, or AI credentials.
                Publish a derived workload summary from Mac before asking questions here.
              </p>
            </div>
            <div className="personal-agent-actions">
              <Link className="button button-primary" href="/download">Get Weekform for Mac</Link>
            </div>
          </div> : null}
          {hasSignal && turns.length === 0 ? (
            <div className={styles.emptyState} role="status">
              <span className="personal-agent-boundary-mark"><AgentSignalMark size={18} /></span>
              <div>
                <h2>Ask this published week.</h2>
                <p>Questions go to Weekform&apos;s authenticated server and, when configured, its AI provider. Each request includes your typed question and a minimized review-safe evidence catalog. The conversation is temporary on this page, requests use no-store processing, and you should not enter sensitive, confidential, or regulated information.</p>
              </div>
            </div>
          ) : null}
          {turns.length ? <div className={styles.messages}>
            {turns.map((turn, index) => (
              <div className={styles.turn} key={`${index}-${turn.question}`}>
                <article className={styles.userMessage} aria-label="Your question">
                  <p>{turn.question}</p>
                </article>
                <article className={styles.agentMessage} aria-label="Weekform Agent answer">
                  <span className={styles.avatar}><AgentSignalMark size={15} /></span>
                  <div>
                    <p className={styles.answer}>{turn.answer}</p>
                    <span className={styles.responseMode}>{responseLabel(turn)}</span>
                    {turn.evidence.length ? (
                      <details className={styles.evidence}>
                        <summary>{turn.evidence.length} review-safe evidence reference{turn.evidence.length === 1 ? "" : "s"}</summary>
                        <ul>{turn.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
                      </details>
                    ) : null}
                    {turn.limitations.map((limitation) => <p className={styles.limitation} key={limitation}>{limitation}</p>)}
                    {turn.mode === "mac_handoff" ? <Link className={styles.macLink} href="/download">Get Weekform for Mac</Link> : null}
                  </div>
                </article>
              </div>
            ))}
          </div> : null}
          {isSending ? <div className={styles.thinking} role="status"><AgentSignalMark size={15} /> Reviewing published signals…</div> : null}
        </div>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <form className="personal-agent-composer" onSubmit={submit}>
          <textarea
            rows={1}
            value={question}
            maxLength={600}
            disabled={!hasSignal || isSending}
            onChange={(event) => setQuestion(event.target.value)}
            aria-label="Ask about your capacity, focus, or what to do next"
            placeholder="Ask about your capacity, focus, or what to do next…"
          />
          <button type="submit" aria-label="Send question" aria-disabled={!hasSignal || isSending || !question.trim()} disabled={!hasSignal || isSending || !question.trim()}>↑</button>
        </form>
      </div>
    </section>
  );
}
