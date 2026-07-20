import { lazy, Suspense, useMemo, useState, useEffect, useRef } from "react";
import {
  ArrowRight,
  BrainCircuit,
  CalendarRange,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Database,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type {
  WorkBlock,
  ActivitySession,
  OutlookCalendarEvent,
  UserCorrection,
  VisualContextInsight,
  WeeklyAIUsageSummary,
  WeeklyCapacitySnapshot,
  AIConfig,
} from "../../../../../packages/domain/src/models";
import type { AgentActionKind } from "../../services/agentTools";
import type { AgentChatMessage, AppActionResult, Screen } from "../../lib/types";
import type { PushToast } from "../../hooks/useToasts";
import { agentTools, AGENT_INSTRUCTIONS } from "../../services/agentTools";
import { getAIProviderPreset } from "../../services/aiProviders";
import { hasAIConnection, isCodexConnection } from "../../services/aiConnection";
import { normalizeWeekId } from "../../../../../packages/inference/src/capacity";
import { getCurrentIsoWeekId, getLocalDateKey } from "../../lib/date";
import { formatClockTime, formatCount } from "../../lib/format";
import { withAiTimeout } from "../../lib/aiTimeout";
import { AI_UNAVAILABLE_HINT } from "../../lib/constants";
import { scrollBehavior } from "../../lib/motion";
import {
  AGENT_CHAT_STORAGE_KEY,
  AGENT_DRAFT_STORAGE_KEY,
  clearAgentSessionStorage,
} from "../../services/agentSessionStorage";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { AgentMark } from "../common/AgentMark";
import type { tool as AiToolFn } from "ai";

const AgentMarkdown = lazy(() => import("./AgentMarkdown"));
const INITIAL_MESSAGE_COUNT = 24;
const MESSAGE_PAGE_SIZE = 20;
const FINAL_AGENT_TEXT_TIMEOUT_MS = 5000;
const AGENT_STREAM_TIMEOUT_MS = 20_000;
const AGENT_STREAM_TIMEOUT_MESSAGE =
  "The tool-enabled Agent stream did not produce a response within 20s";
const AGENT_PENDING_MESSAGE = "Reading your tracked context…";
const AGENT_THINKING_LABEL = "Thinking";
const AGENT_STREAM_REVEAL_MIN_MS = 900;
const AGENT_STREAM_REVEAL_MAX_MS = 2600;
const AGENT_STREAM_REVEAL_PER_LINE_MS = 120;
const GROUNDED_AGENT_FALLBACK_INSTRUCTIONS = `You are the Weekform Agent.

Answer using only the provided local Weekform facts and recent conversation.
Be concrete, concise, and honest about thin data.
If the user has raw sessions but no reviewed work blocks, explain that capacity and workload recommendations are limited until sessions are classified/reviewed.`;

type AgentActionStatus = "awaiting" | "running" | "completed" | "failed";

interface PendingAgentAction {
  id: string;
  kind: AgentActionKind;
  reason: string;
  status: AgentActionStatus;
  resultMessage?: string;
}

const AGENT_ACTION_COPY: Record<AgentActionKind, {
  title: string;
  description: string;
  confirmLabel: string;
  runningLabel: string;
  destination: Screen;
  destinationLabel: string;
}> = {
  classify_sessions: {
    title: "Classify raw activity",
    description: "Send eligible raw activity sessions through Weekform’s classifier and create draft work blocks for your review. Nothing is auto-confirmed.",
    confirmLabel: "Classify sessions",
    runningLabel: "Classifying sessions…",
    destination: "daily",
    destinationLabel: "Open Daily Review",
  },
  generate_forecast: {
    title: "Generate a new forecast",
    description: "Use the current reviewed workload, calendar, and corrections to refresh the next-week capacity forecast.",
    confirmLabel: "Generate forecast",
    runningLabel: "Generating forecast…",
    destination: "forecast",
    destinationLabel: "Open Forecast",
  },
  generate_narrative: {
    title: "Generate a weekly narrative",
    description: "Refresh the weekly narrative and replace the manager-ready summary draft using the current reviewed evidence.",
    confirmLabel: "Generate narrative",
    runningLabel: "Generating narrative…",
    destination: "narrative",
    destinationLabel: "Open Narrative",
  },
};

function detectExplicitAgentAction(message: string): AgentActionKind | null {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  const asksToClassify = /\b(classify|categorize|group)\b/.test(normalized)
    && /\b(raw|unclassified|eligible|activity|activities|session|sessions|work block|work blocks)\b/.test(normalized);
  if (asksToClassify) return "classify_sessions";

  const actionVerb = /\b(generate|create|refresh|update|regenerate|run|make)\b/;
  if (actionVerb.test(normalized) && /\bforecast\b/.test(normalized)) return "generate_forecast";
  if (
    actionVerb.test(normalized)
    && /\b(narrative|weekly summary|manager summary|manager-ready summary)\b/.test(normalized)
  ) return "generate_narrative";

  return null;
}

interface AgentScreenProps {
  blocks: WorkBlock[];
  snapshot: WeeklyCapacitySnapshot;
  activeWindowSessions: ActivitySession[];
  calendarEvents: OutlookCalendarEvent[];
  corrections: UserCorrection[];
  visualContextInsights: VisualContextInsight[];
  aiUsageSummary: WeeklyAIUsageSummary;
  todayKey: string;
  currentWeekRangeLabel: string;
  aiConfig: AIConfig | null;
  /** AI access exists (saved key or env fallback) — false grays the send control. */
  aiAvailable: boolean;
  hasNarrativeEvidence: boolean;
  onOpenScreen: (screen: Screen) => void;
  onClassifySessions: () => Promise<AppActionResult>;
  onGenerateForecast: () => Promise<AppActionResult>;
  onGenerateNarrative: () => Promise<AppActionResult>;
  pushToast: PushToast;
  /** Increments only after Reset Local Data is confirmed. */
  resetGeneration: number;
}

function AgentThinkingText() {
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDotCount((count) => (count % 3) + 1);
    }, 420);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="agent-thinking-text" aria-label="Thinking">
      <span>{AGENT_THINKING_LABEL}</span>
      <span className="agent-thinking-dots" aria-hidden>
        {".".repeat(dotCount)}
      </span>
    </span>
  );
}

// An assistant answer that quotes percentages gets a live footer grounding it in
// the current snapshot — the same evidence-citing habit the rest of the app has.
// Values are read from the snapshot at render time, never parsed from the answer.
const CAPACITY_CITATION_RE = /\d+(?:\.\d+)?\s?%/;

function CapacityContextStrip({ capacity, planned, reactive }: { capacity: number; planned: number; reactive: number }) {
  const plannedShare = Math.max(0, Math.min(100, planned));
  const reactiveShare = Math.max(0, Math.min(100 - plannedShare, reactive));
  const openShare = Math.round(Math.max(0, 100 - plannedShare - reactiveShare));
  return (
    <div
      className="agent-context-strip"
      role="group"
      aria-label={`Live week context: ${capacity}% reliable capacity, ${planned}% planned, ${reactive}% reactive`}
      title="Live values from this week's snapshot — shown so you can check the answer against your data, not parsed from the reply."
    >
      <span className="agent-context-label">This week</span>
      <span className="agent-context-bar" aria-hidden>
        <span className="is-planned" style={{ width: `${plannedShare}%` }} />
        <span className="is-reactive" style={{ width: `${reactiveShare}%` }} />
      </span>
      <span className="agent-context-chip"><strong>{capacity}%</strong> reliable</span>
      <span className="agent-context-chip">planned {planned}%</span>
      <span className="agent-context-chip">reactive {reactive}%</span>
      <span className="agent-context-chip">open {openShare}%</span>
    </div>
  );
}

function getStreamingRevealDuration(content: string) {
  const lineCount = Math.max(1, content.replace(/\r\n/g, "\n").split("\n").length);
  return Math.min(
    AGENT_STREAM_REVEAL_MAX_MS,
    Math.max(AGENT_STREAM_REVEAL_MIN_MS, 520 + lineCount * AGENT_STREAM_REVEAL_PER_LINE_MS)
  );
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

export function AgentScreen({
  blocks,
  snapshot,
  activeWindowSessions,
  calendarEvents,
  corrections,
  visualContextInsights,
  aiUsageSummary,
  todayKey,
  currentWeekRangeLabel,
  aiConfig,
  aiAvailable,
  hasNarrativeEvidence,
  onOpenScreen,
  onClassifySessions,
  onGenerateForecast,
  onGenerateNarrative,
  pushToast,
  resetGeneration,
}: AgentScreenProps) {
  const [messages, setMessages] = useState<AgentChatMessage[]>(() => {
    try {
      const cached = window.localStorage.getItem(AGENT_CHAT_STORAGE_KEY);
      const parsed = cached ? JSON.parse(cached) : [];
      return Array.isArray(parsed)
        ? parsed.filter((message) => {
            if (!message || typeof message.content !== "string") return false;
            return message.content.trim() !== "" && message.content !== AGENT_PENDING_MESSAGE;
          })
        : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState(() => {
    try {
      return window.localStorage.getItem(AGENT_DRAFT_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [isSending, setIsSending] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_MESSAGE_COUNT);
  const [analysisStage, setAnalysisStage] = useState(0);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAgentAction | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingActionRef = useRef<PendingAgentAction | null>(null);
  const agentOperationEpochRef = useRef(0);

  const topProjects = useMemo(() => {
    const totals = new Map<string, number>();
    // Scope to the snapshot's week so the briefing's "primary focus this week"
    // names the week's top project, matching the week-scoped `getPrimaryFocus`
    // tool (and the sibling `weekBlocks` memo's block.week_id predicate) instead
    // of surfacing a project that only dominated the full accumulated ledger.
    blocks
      .filter((block) => normalizeWeekId(block.week_id) === normalizeWeekId(snapshot.week_id))
      .forEach((block) => {
        const name = block.project_name?.trim() || "Unassigned work";
        totals.set(name, (totals.get(name) || 0) + block.estimated_capacity_pct);
      });
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, capacity]) => ({ name, capacity: Math.round(capacity) }));
  }, [blocks, snapshot.week_id]);

  // Matches App.tsx's `showOnboarding` empty-app condition: with zero blocks the
  // snapshot only emits its default caps, so the briefing must not claim a number.
  const hasSignal = blocks.length > 0;
  const sessionCount = activeWindowSessions.length;
  const hasRawSessions = sessionCount > 0;
  const signalStatusLabel = hasSignal
    ? `Data current · ${currentWeekRangeLabel}`
    : hasRawSessions
      ? `${formatCount(sessionCount)} raw session${sessionCount === 1 ? "" : "s"} captured · review to ground the Agent`
      : `Waiting for signal · ${currentWeekRangeLabel}`;
  const inputPlaceholder = hasSignal
    ? "Ask about your capacity, focus, or what to do next..."
    : hasRawSessions
      ? `Ask about your ${formatCount(sessionCount)} captured session${sessionCount === 1 ? "" : "s"}...`
      : "Ask about your capacity, focus, or what to do next...";

  // Read live from the snapshot — the Week screen owns the full dashboard; this is
  // just enough context to anchor the conversation.
  const briefing = useMemo(() => ({
    capacity: Math.round(snapshot.reliable_new_work_capacity_pct),
    planned: Math.round(snapshot.planned_pct),
    reactive: Math.round(snapshot.reactive_pct),
    carryoverRisk: Math.round(snapshot.carryover_risk_pct),
    primaryFocus: topProjects[0]?.name || "building your workload signal",
  }), [snapshot, topProjects]);

  const starterActions = [
    {
      icon: CalendarRange,
      iconClass: "calendar",
      title: "Plan within my capacity",
      description: "Shape a realistic week from the capacity you can rely on.",
      prompt: "Help me plan the rest of my week within my reliable capacity.",
    },
    {
      icon: Clock3,
      iconClass: "clock",
      title: "Summarize today",
      description: "Turn tracked sessions and calendar activity into a clear recap.",
      prompt: "Summarize my activity today and call out the most important work.",
    },
    {
      icon: ShieldCheck,
      iconClass: "shield",
      title: "Find workload risks",
      description: "Surface fragmentation, reactive load, and likely carryover.",
      prompt: "Find the biggest workload risks in my current week and explain what is driving them.",
    },
    {
      icon: BrainCircuit,
      iconClass: "brain",
      title: "Explain what changed",
      description: "Compare planned and reactive work using your local evidence.",
      prompt: "Explain what changed in my workload this week, especially planned versus reactive work.",
    },
  ];

  // Static, snapshot-derived follow-up prompts shown beneath the latest settled reply.
  // Reuses the handleSuggested path; the empty-state starterActions stay separate.
  const followUpSuggestions = useMemo(() => {
    const suggestions: string[] = [];
    if (snapshot.reactive_pct >= 30) suggestions.push("Why is my reactive load this high?");
    if (snapshot.carryover_risk_pct >= 30) suggestions.push("What's driving my carryover risk?");
    if (snapshot.reliable_new_work_capacity_pct < 30) suggestions.push("How can I free up reliable capacity?");
    suggestions.push("Plan around this");
    suggestions.push("What should I focus on next?");
    return suggestions.slice(0, 3);
  }, [snapshot]);

  // Scope the block + calendar surfaces to the snapshot's week so the tools that
  // report "the week" (getWeekWorkload / getPrimaryFocus / getCalendarSummary) agree
  // with the week-scoped `snapshot` instead of summing the full accumulated ledger as
  // one week's total. Mirrors useDerived.ts's weekBlocks/weekCalendarEvents scoping
  // (block.week_id equality; calendar events keyed by ISO week of start_time). Sessions
  // stay full — getDayActivity filters them by todayKey; corrections stay full ("recent").
  const weekBlocks = useMemo(
    () => blocks.filter((block) => normalizeWeekId(block.week_id) === normalizeWeekId(snapshot.week_id)),
    [blocks, snapshot.week_id]
  );
  const weekCalendarEvents = useMemo(
    () => calendarEvents.filter((event) => getCurrentIsoWeekId(new Date(event.start_time)) === snapshot.week_id),
    [calendarEvents, snapshot.week_id]
  );

  const unclassifiedSessionCount = useMemo(() => {
    const alreadyClassified = new Set(blocks.flatMap((block) => block.derived_from));
    return activeWindowSessions.filter(
      (session) => !alreadyClassified.has(session.session_id) && session.sample_count >= 2
    ).length;
  }, [activeWindowSessions, blocks]);

  function commitPendingAction(next: PendingAgentAction | null) {
    pendingActionRef.current = next;
    setPendingAction(next);
  }

  function requestAgentAction(kind: AgentActionKind, reason?: string): Record<string, unknown> {
    const existing = pendingActionRef.current;
    if (existing && (existing.status === "awaiting" || existing.status === "running")) {
      return {
        status: "already_pending",
        action: existing.kind,
        message: "An action is already waiting for approval or running. Ask the user to finish that action first.",
      };
    }

    if (!hasAIConnection(aiConfig, false)) {
      return {
        status: "unavailable",
        action: kind,
        message: "No AI connection is saved. Guide the user to Settings → AI assistance before proposing this action.",
      };
    }
    if (kind === "classify_sessions" && unclassifiedSessionCount === 0) {
      return {
        status: "unavailable",
        action: kind,
        message: "No unclassified active-window sessions are ready. Do not ask the user to paste sessions.",
      };
    }
    if (kind === "generate_forecast" && blocks.length === 0) {
      return {
        status: "unavailable",
        action: kind,
        message: "A forecast needs at least one work block. Recommend classification or review first.",
      };
    }
    if (kind === "generate_narrative" && !hasNarrativeEvidence) {
      return {
        status: "unavailable",
        action: kind,
        message: "There is not enough reviewed evidence for a narrative yet. Recommend classification or review first.",
      };
    }

    const copy = AGENT_ACTION_COPY[kind];
    const proposal: PendingAgentAction = {
      id: `agent-action-${Date.now()}`,
      kind,
      reason: reason?.trim().slice(0, 240) || copy.description,
      status: "awaiting",
    };
    commitPendingAction(proposal);
    return {
      status: "awaiting_user_confirmation",
      action: kind,
      title: copy.title,
      confirmationRequired: true,
      eligibleSessionCount: kind === "classify_sessions" ? unclassifiedSessionCount : undefined,
      message: "The approval card is ready. Ask the user to review and approve it; do not claim the action has run.",
    };
  }

  // Data context for tools (bound here)
  const context = {
    blocks: weekBlocks,
    snapshot,
    sessions: activeWindowSessions,
    calendarEvents: weekCalendarEvents,
    corrections,
    visualContextInsights,
    usageSummary: aiUsageSummary,
    todayKey,
    requestAgentAction,
  };

  useEffect(() => {
    void import("./AgentMarkdown");
  }, []);

  useEffect(() => {
    try {
      if (messages.length > 0) {
        window.localStorage.setItem(AGENT_CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-200)));
      } else {
        window.localStorage.removeItem(AGENT_CHAT_STORAGE_KEY);
      }
    } catch {
      // Keep the in-memory conversation if storage is full or disabled.
    }
  }, [messages]);

  useEffect(() => {
    try {
      if (input) window.localStorage.setItem(AGENT_DRAFT_STORAGE_KEY, input);
      else window.localStorage.removeItem(AGENT_DRAFT_STORAGE_KEY);
    } catch {
      // Draft persistence is best effort.
    }
  }, [input]);

  useEffect(() => {
    if (resetGeneration <= 0) return;
    agentOperationEpochRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    pendingActionRef.current = null;
    setMessages([]);
    setInput("");
    setIsSending(false);
    setIsStreaming(false);
    setStreamingMessageId(null);
    setVisibleMessageCount(INITIAL_MESSAGE_COUNT);
    setPendingAction(null);
    setConfirmingClear(false);
    clearAgentSessionStorage();
  }, [resetGeneration]);

  useEffect(() => () => {
    // Screen routing unmounts inactive screens. Invalidate any provider result
    // before aborting so an uncancellable native request cannot repopulate state.
    agentOperationEpochRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [input]);

  useEffect(() => {
    if (!isSending) {
      setAnalysisStage(0);
      return;
    }
    const timer = window.setInterval(() => {
      setAnalysisStage((current) => Math.min(current + 1, 2));
    }, 850);
    return () => window.clearInterval(timer);
  }, [isSending]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: scrollBehavior() });
  };

  useEffect(() => {
    if (visibleMessageCount === INITIAL_MESSAGE_COUNT) scrollToBottom();
  }, [messages, visibleMessageCount]);

  useEffect(() => {
    if (pendingAction && visibleMessageCount === INITIAL_MESSAGE_COUNT) scrollToBottom();
  }, [pendingAction, visibleMessageCount]);

  const visibleMessages = useMemo(
    () => messages.slice(Math.max(0, messages.length - visibleMessageCount)),
    [messages, visibleMessageCount]
  );
  const earlierMessageCount = Math.min(MESSAGE_PAGE_SIZE, messages.length - visibleMessages.length);

  // Single scoped announcement per completed assistant turn. The old `aria-live` on the whole
  // `.agent-messages` list re-announced the entire scrollback (and double-fired with the streaming
  // region) on any descendant mutation — a new turn, streaming token deltas, the copy button
  // flipping to "Copied", follow-up chips appearing. Instead, announce only the latest assistant
  // reply, and only once it has settled (not sending, not streaming). This covers every reply path
  // uniformly (streaming, timeout/interrupted, no-key fallback, Rust fallback, error) because it
  // keys on the settled content, not on which code path produced it. A stable string across
  // unrelated re-renders leaves the text node untouched, so `aria-live` stays silent.
  const latestAssistantAnnouncement = useMemo(() => {
    if (isSending || streamingMessageId) return "";
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      const message = visibleMessages[i];
      if (message.role === "assistant" && message.content && message.content !== AGENT_PENDING_MESSAGE) {
        return message.content;
      }
    }
    return "";
  }, [visibleMessages, isSending, streamingMessageId]);

  // Helper: resolve a Vercel AI SDK model from aiConfig for direct + local tool execution.
  // Follows Eve agent patterns (defineTool + instructions + generateText loop) but embedded
  // inside the app so tools can close over live app state (blocks, snapshot, etc).
  async function resolveAgentModel(config: AIConfig | null) {
    if (!config?.apiKey?.trim()) return null;
    const provider = config.provider;
    const apiKey = config.apiKey;
    // Fall back to the provider's own preset default, not a hardcoded retired OpenAI model.
    // Custom presets have no default, so that path still relies on the user-entered model.
    const modelId = config.model?.trim() || getAIProviderPreset(provider).model;
    const baseURL = config.baseUrl ? config.baseUrl.replace(/\/$/, "") : undefined;

    if (provider === "openai") {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey, baseURL })(modelId);
    }

    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    const compatibleProvider = createOpenAICompatible({
      name: provider,
      apiKey,
      baseURL: baseURL ?? getAIProviderPreset(provider).baseUrl,
    });
    return compatibleProvider(modelId);
  }

  // Wrap app tools for the AI SDK's inputSchema contract.
  // Execute is rebound to inject our app context (the "ctx" in a real Eve tool).
  // createTool is the `tool` helper from the ai SDK; t is intentionally `any` because Eve
  // tool execute signatures have narrow ctx types (e.g. { snapshot }) that are structurally
  // incompatible with a shared interface, but are always safe at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function createBoundTools(ctx: typeof context, createTool: typeof AiToolFn) {
    const toAiTool = (t: any) =>
      createTool({
        description: t.description,
        inputSchema: t.inputSchema ?? t.parameters,
        execute: async (input: Record<string, unknown>) => t.execute(input ?? {}, ctx),
      });

    return {
      getCapacitySnapshot: toAiTool(agentTools.getCapacitySnapshot),
      getWeekWorkload: toAiTool(agentTools.getWeekWorkload),
      getDayActivity: toAiTool(agentTools.getDayActivity),
      getPrimaryFocus: toAiTool(agentTools.getPrimaryFocus),
      getRecentCorrections: toAiTool(agentTools.getRecentCorrections),
      getCalendarSummary: toAiTool(agentTools.getCalendarSummary),
      getVisualInsightsSummary: toAiTool(agentTools.getVisualInsightsSummary),
      getUsageDigest: toAiTool(agentTools.getUsageDigest),
      requestSessionClassification: toAiTool(agentTools.requestSessionClassification),
      requestForecastGeneration: toAiTool(agentTools.requestForecastGeneration),
      requestNarrativeGeneration: toAiTool(agentTools.requestNarrativeGeneration),
    } as const;
  }

  async function buildGroundedAgentPrompt(history: AgentChatMessage[]) {
    const [
      capacitySnapshot,
      weekWorkload,
      dayActivity,
      primaryFocus,
      recentCorrections,
      calendarSummary,
      visualInsightsSummary,
      usageDigest,
    ] = await Promise.all([
      agentTools.getCapacitySnapshot.execute({}, context),
      agentTools.getWeekWorkload.execute({}, context),
      agentTools.getDayActivity.execute({ todayKey }, context),
      agentTools.getPrimaryFocus.execute({}, context),
      agentTools.getRecentCorrections.execute({ limit: 5 }, context),
      agentTools.getCalendarSummary.execute({}, context),
      agentTools.getVisualInsightsSummary.execute({ limit: 5 }, context),
      agentTools.getUsageDigest.execute({}, context),
    ]);

    const latestUserQuestion = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
    const recentConversation = history
      .slice(-8)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    return `Local Weekform facts:
${JSON.stringify(
  {
    weekRange: currentWeekRangeLabel,
    reviewedWorkBlocks: blocks.length,
    rawActiveWindowSessions: activeWindowSessions.length,
    importedCalendarEvents: calendarEvents.length,
    userCorrections: corrections.length,
    capacitySnapshot,
    weekWorkload,
    dayActivity,
    primaryFocus,
    recentCorrections,
    calendarSummary,
    visualInsightsSummary,
    usageDigest,
  },
  null,
  2
)}

Recent conversation:
${recentConversation}

Latest user question:
${latestUserQuestion}`;
  }

  function buildDeterministicAgentFallback(question: string, intro = "I could not get a complete AI response") {
    const top = [...new Set(blocks.map((b) => b.project_name?.trim()).filter(Boolean))]
      .slice(0, 3)
      .join(", ") || "none yet";
    const todaySessionCount = activeWindowSessions.filter(
      (s) => getLocalDateKey(new Date(s.start_time)) === todayKey
    ).length;
    const capLine = hasSignal
      ? `reliable new-work capacity ${Math.round(snapshot.reliable_new_work_capacity_pct)}%, allocated ${Math.round(snapshot.allocated_pct)}% (planned ${Math.round(snapshot.planned_pct)}%, reactive ${Math.round(snapshot.reactive_pct)}%)`
      : "no reviewed workload signal yet";
    const thinDataNote = blocks.length === 0
      ? `I can see ${formatCount(activeWindowSessions.length)} raw active-window session${activeWindowSessions.length === 1 ? "" : "s"}, but 0 reviewed work blocks. Classify/review sessions on Today to give me enough grounded workload data for planning.`
      : "";
    return [
      `${intro}, but here is what the local data says for "${question}".`,
      `Current capacity context: ${capLine}.`,
      `Top reviewed projects: ${top}. ${todaySessionCount} active session${todaySessionCount === 1 ? "" : "s"} tracked today and ${weekCalendarEvents.length} calendar event${weekCalendarEvents.length === 1 ? "" : "s"} imported for the week.`,
      thinDataNote,
    ].filter(Boolean).join(" ");
  }

  // Appends a user turn, then runs the assistant turn over the new history.
  // Used by both typed input and suggested question chips.
  async function sendMessage(messageText: string) {
    if (!messageText.trim() || isSending) return;

    const trimmedMessage = messageText.trim();
    const userMsg: AgentChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmedMessage,
      createdAt: new Date().toISOString(),
    };
    const updated = [...messages, userMsg];
    // Sending a message returns the user to the live tail, so re-arm the auto-scroll
    // effect (gated on `visibleMessageCount === INITIAL_MESSAGE_COUNT`). Without this, a
    // prior "Show earlier" click leaves the counter elevated forever, so the new turn and
    // its streaming reply would land below the fold with no scroll. No-op (byte-identical)
    // when history was never expanded, since the counter already holds INITIAL_MESSAGE_COUNT.
    setVisibleMessageCount(INITIAL_MESSAGE_COUNT);
    setInput("");

    // Clear requests to perform an existing Weekform action should never depend on the
    // language model deciding whether to call a tool. Stage the consent card directly;
    // the underlying mutation still cannot run until the user explicitly approves it.
    const explicitAction = detectExplicitAgentAction(trimmedMessage);
    if (explicitAction) {
      const actionCopy = AGENT_ACTION_COPY[explicitAction];
      const actionResult = requestAgentAction(explicitAction, actionCopy.description);
      const actionStatus = String(actionResult.status ?? "");
      const assistantContent = actionStatus === "awaiting_user_confirmation"
        ? `I can do that. I’ve prepared the ${actionCopy.title.toLowerCase()} action below. Review what it will do, then approve it when you’re ready.`
        : String(actionResult.message ?? "I couldn’t prepare that action right now.");
      const assistantMsg: AgentChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: assistantContent,
        createdAt: new Date().toISOString(),
      };
      setMessages([...updated, assistantMsg]);
      return;
    }

    setMessages(updated);
    await runAssistantTurn(updated);
  }

  // Streams an assistant reply for a conversation that already ends with a user turn.
  // Uses streamText for live typewriter-like responses (Eve style). An AbortController is
  // threaded into streamText so the Stop button can halt mid-stream and keep partial text.
  async function runAssistantTurn(history: AgentChatMessage[]) {
    setIsSending(true);
    setIsStreaming(false);
    setStreamingMessageId(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const operationEpoch = agentOperationEpochRef.current + 1;
    agentOperationEpochRef.current = operationEpoch;
    const isCurrentOperation = () => agentOperationEpochRef.current === operationEpoch;
    // Drives the Rust fallback prompt below if the SDK + grounded paths both fail.
    const latestUserQuestion = [...history].reverse().find((m) => m.role === "user")?.content ?? "";

    try {
      const sdkModel = await resolveAgentModel(aiConfig);
      if (!isCurrentOperation()) return;

      if (sdkModel) {
        const [{ generateText, streamText, tool: createTool, stepCountIs }] = await Promise.all([import("ai")]);
        if (!isCurrentOperation()) return;
        const boundTools = createBoundTools(context, createTool);

        const historyForModel = history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        // Start streaming immediately (model will invoke tools behind the scenes as needed)
        const streamResult = await streamText({
          model: sdkModel,
          system: AGENT_INSTRUCTIONS,
          messages: historyForModel,
          tools: boundTools,
          stopWhen: stepCountIs(6),
          abortSignal: controller.signal,
        });
        if (!isCurrentOperation()) return;

        const assistantId = `asst-${Date.now()}`;
        setMessages((prev) => [...prev, {
          id: assistantId,
          role: "assistant",
          content: AGENT_PENDING_MESSAGE,
          createdAt: new Date().toISOString(),
        }]);
        setStreamingMessageId(assistantId);
        setIsStreaming(true);

        let streamed = "";
        let streamTimedOut = false;
        let streamTimeout: ReturnType<typeof window.setTimeout> | null = null;
        const holdStreamingReveal = async (content: string) => {
          if (!content.trim() || controller.signal.aborted) return;
          await sleep(getStreamingRevealDuration(content), controller.signal);
        };
        const consumeStream = async () => {
          for await (const delta of streamResult.textStream) {
            if (streamTimedOut) return;
            streamed += delta;
          }
        };

        try {
          const streamStatus = await Promise.race([
            consumeStream().then(() => "done" as const),
            new Promise<"timeout">((resolve) => {
              streamTimeout = window.setTimeout(() => {
                streamTimedOut = true;
                controller.abort();
                resolve("timeout");
              }, AGENT_STREAM_TIMEOUT_MS);
            }),
          ]);

          if (streamStatus === "timeout") {
            if (!isCurrentOperation()) return;
            streamed = buildDeterministicAgentFallback(latestUserQuestion, AGENT_STREAM_TIMEOUT_MESSAGE);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: streamed, interrupted: false } : m))
            );
            await holdStreamingReveal(streamed);
            setIsStreaming(false);
            setStreamingMessageId(null);
            return;
          }
        } catch {
          if (!isCurrentOperation()) return;
          if (streamTimedOut) {
            streamed = buildDeterministicAgentFallback(latestUserQuestion, AGENT_STREAM_TIMEOUT_MESSAGE);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: streamed, interrupted: false } : m))
            );
            await holdStreamingReveal(streamed);
            setIsStreaming(false);
            setStreamingMessageId(null);
            return;
          }
          // User pressed Stop: keep whatever streamed so far, surface no error.
          if (controller.signal.aborted) {
            finalizeAbortedStream(assistantId, streamed);
            return;
          }
          // Partial content + a retryable interruption marker. Don't rethrow — the
          // Retry affordance on this message is the recovery path, so falling through
          // to the outer Rust fallback (a second, redundant reply) is undesirable.
          const interruptedContent = streamed.trim()
            ? streamed + "\n\n(Streaming interrupted)"
            : "I started analyzing your data with tools but the stream was interrupted.";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: interruptedContent, interrupted: true } : m
            )
          );
          setIsStreaming(false);
          setStreamingMessageId(null);
          return;
        } finally {
          if (streamTimeout) window.clearTimeout(streamTimeout);
        }

        // Stop pressed but the stream ended cleanly: keep partial text, no finalize.
        if (controller.signal.aborted) {
          finalizeAbortedStream(assistantId, streamed);
          return;
        }

        let finalText = "";
        try {
          finalText = (await withAiTimeout(Promise.resolve(streamResult.text), FINAL_AGENT_TEXT_TIMEOUT_MS)).trim();
        } catch {
          finalText = "";
        }
        if (!isCurrentOperation()) return;
        if (finalText && finalText !== streamed.trim()) {
          streamed = finalText;
        }

        // Some provider/model combinations complete tool calls but yield no final streamed text.
        // Retry once without tools, embedding the same local tool facts, so the user gets a useful
        // grounded answer instead of a dead-end "empty response" bubble.
        if (!streamed.trim()) {
          try {
            const groundedPrompt = await buildGroundedAgentPrompt(history);
            if (!isCurrentOperation()) return;
            const retry = await withAiTimeout(
              generateText({
                model: sdkModel,
                system: GROUNDED_AGENT_FALLBACK_INSTRUCTIONS,
                prompt: groundedPrompt,
                abortSignal: controller.signal,
              }),
              AGENT_STREAM_TIMEOUT_MS
            );
            if (!isCurrentOperation()) return;
            streamed = retry.text.trim();
          } catch {
            streamed = "";
          }

          if (!streamed.trim()) {
            streamed = buildDeterministicAgentFallback(latestUserQuestion);
          }

        }

        if (!isCurrentOperation()) return;

        // Commit the completed answer once so the reveal animates the formatted Markdown
        // tree. Rendering token deltas as plain lines made Markdown syntax flash before
        // ReactMarkdown replaced it with the polished response.
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: streamed, interrupted: false } : m))
        );
        await holdStreamingReveal(streamed);
        setMessages((prev) => prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                analysisSummary: `Reviewed ${weekBlocks.length} work block${weekBlocks.length === 1 ? "" : "s"}, ${activeWindowSessions.length} session${activeWindowSessions.length === 1 ? "" : "s"}, ${weekCalendarEvents.length} calendar event${weekCalendarEvents.length === 1 ? "" : "s"}, and ${corrections.length} correction${corrections.length === 1 ? "" : "s"}.`,
              }
            : message
        ));
        setIsStreaming(false);
        setStreamingMessageId(null);
        return;
      } else if (isCodexConnection(aiConfig)) {
        const groundedPrompt = await buildGroundedAgentPrompt(history);
        if (!isCurrentOperation()) return;
        const assistantId = `asst-${Date.now()}`;
        setMessages((prev) => [...prev, {
          id: assistantId,
          role: "assistant",
          content: AGENT_PENDING_MESSAGE,
          createdAt: new Date().toISOString(),
        }]);
        setStreamingMessageId(assistantId);
        setIsStreaming(true);
        const response = await withAiTimeout(
          invoke<{ response: string }>("chat_with_agent", {
            request: { prompt: groundedPrompt, ai_config: aiConfig },
          }),
          60_000,
        );
        if (!isCurrentOperation()) return;
        if (controller.signal.aborted) {
          finalizeAbortedStream(assistantId, "");
          return;
        }
        setMessages((prev) => prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: response.response,
                interrupted: false,
                analysisSummary: `Reviewed ${weekBlocks.length} work block${weekBlocks.length === 1 ? "" : "s"}, ${activeWindowSessions.length} session${activeWindowSessions.length === 1 ? "" : "s"}, ${weekCalendarEvents.length} calendar event${weekCalendarEvents.length === 1 ? "" : "s"}, and ${corrections.length} correction${corrections.length === 1 ? "" : "s"}.`,
              }
            : message
        ));
        setIsStreaming(false);
        setStreamingMessageId(null);
      } else {
        // Grounded fallback (no connection)
        const fallback = `I don't have an AI connection configured yet. ${buildDeterministicAgentFallback(latestUserQuestion, "Based on current local data")} Go to Settings → AI assistance to use a ChatGPT/Codex plan or add a provider API key.`;
        setMessages((prev) => [...prev, {
          id: `asst-${Date.now()}`,
          role: "assistant",
          content: fallback,
          createdAt: new Date().toISOString(),
          analysisSummary: `Read ${blocks.length} work block${blocks.length === 1 ? "" : "s"} and ${activeWindowSessions.length} tracked session${activeWindowSessions.length === 1 ? "" : "s"} locally.`,
        }]);
      }
    } catch (e: any) {
      // An abort that surfaced here (rather than inside the stream loop) is a user Stop,
      // not a failure — don't run the fallback or surface an error. The finally block
      // resets the streaming flags.
      if (!isCurrentOperation() || controller.signal.aborted) return;
      // Best effort fallback via the Rust path, then pure data
      try {
        const historyStr = history.map((m) => `${m.role}: ${m.content}`).join("\n");
        const fallbackPrompt = `You are the Weekform Agent focused only on capacity, workload and weekly focus. Use only the user's data. Conversation so far:\n${historyStr}\n\nLatest user question: ${latestUserQuestion}`;
        const resp = await withAiTimeout(
          invoke<{ response?: string }>("chat_with_agent", {
            request: { prompt: fallbackPrompt, ai_config: aiConfig || undefined },
          })
        );
        if (!isCurrentOperation()) return;
        const text =
          resp?.response ||
          `Capacity snapshot: ${snapshot ? snapshot.reliable_new_work_capacity_pct + "% reliable new-work" : "n/a"}. Focus projects: ${blocks.slice(0, 2).map((b) => b.project_name).join(", ") || "n/a"}.`;
        setMessages((prev) => [...prev, {
          id: `asst-${Date.now()}`,
          role: "assistant",
          content: text,
          createdAt: new Date().toISOString(),
          analysisSummary: `Reviewed available capacity and workload context through the local agent bridge.`,
        }]);
      } catch {
        if (!isCurrentOperation()) return;
        const errText = `Sorry, the Agent hit an error: ${e?.message || e}. Make sure your AI provider is set in Settings → AI assistance and you have data for the week.`;
        setMessages((prev) => [...prev, {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: errText,
          createdAt: new Date().toISOString(),
        }]);
      }
    } finally {
      if (isCurrentOperation()) {
        setIsSending(false);
        setIsStreaming(false);
        setStreamingMessageId(null);
      }
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  }

  // Public handlers
  async function handleSend() {
    await sendMessage(input);
  }

  function handleSuggested(question: string) {
    if (isSending || !aiAvailable) return;
    void sendMessage(question);
  }

  async function approvePendingAction() {
    const action = pendingActionRef.current;
    if (!action || action.status === "running") return;

    const runningAction = { ...action, status: "running" as const, resultMessage: undefined };
    commitPendingAction(runningAction);

    let result: AppActionResult;
    try {
      if (action.kind === "classify_sessions") result = await onClassifySessions();
      else if (action.kind === "generate_forecast") result = await onGenerateForecast();
      else result = await onGenerateNarrative();
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }

    const settledAction: PendingAgentAction = {
      ...runningAction,
      status: result.ok ? "completed" : "failed",
      resultMessage: result.message,
    };
    commitPendingAction(settledAction);
    if (result.ok) pushToast({ tone: "success", message: result.message });
  }

  function cancelPendingAction() {
    if (pendingActionRef.current?.status === "running") return;
    commitPendingAction(null);
  }

  // Abort the active stream; the partial assistant message stays put, no error surfaced.
  function stopGeneration() {
    abortControllerRef.current?.abort();
  }

  // Settle a stream the user stopped: keep partial text, but drop an empty placeholder so
  // it isn't persisted and replayed to the model as empty assistant content (some providers
  // reject that) and doesn't render as a blank bubble.
  function finalizeAbortedStream(assistantId: string, streamed: string) {
    if (!streamed.trim()) {
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } else {
      setMessages((prev) => prev.map((message) =>
        message.id === assistantId ? { ...message, content: streamed } : message
      ));
    }
    setIsStreaming(false);
    setStreamingMessageId(null);
  }

  // Re-run the assistant turn for an interrupted reply by replaying the history up to
  // (and including) the user turn that triggered it — dropping the failed reply first.
  function retryMessage(assistantId: string) {
    if (isSending) return;
    const index = messages.findIndex((m) => m.id === assistantId);
    if (index === -1) return;
    const history = messages.slice(0, index);
    if (!history.some((m) => m.role === "user")) return;
    setMessages(history);
    void runAssistantTurn(history);
  }

  function clearChat() {
    setMessages([]);
    commitPendingAction(null);
    setVisibleMessageCount(INITIAL_MESSAGE_COUNT);
    setIsStreaming(false);
    setStreamingMessageId(null);
    try {
      window.localStorage.removeItem(AGENT_CHAT_STORAGE_KEY);
    } catch {
      // The current view is still cleared.
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  async function copyMessage(message: AgentChatMessage) {
    try {
      // Non-optional so a missing clipboard (insecure webview) throws into the catch
      // rather than silently no-op'ing while we falsely announce success.
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId(null), 1200);
      pushToast({ tone: "success", message: "Copied to clipboard" });
    } catch {
      pushToast({ tone: "error", message: "Couldn't copy to the clipboard" });
    }
  }

  function loadEarlierMessages() {
    const container = messagesRef.current;
    const previousHeight = container?.scrollHeight || 0;
    setVisibleMessageCount((count) => Math.min(messages.length, count + MESSAGE_PAGE_SIZE));
    requestAnimationFrame(() => {
      if (container) container.scrollTop += container.scrollHeight - previousHeight;
    });
  }

  const riskLabel = briefing.carryoverRisk >= 50 ? "high carryover risk" : briefing.carryoverRisk >= 25 ? "carryover worth watching" : "low carryover risk";
  const analysisSteps = [
    "Reading workload context",
    "Comparing planned and reactive work",
    "Calculating capacity implications",
  ];
  const pendingActionCopy = pendingAction ? AGENT_ACTION_COPY[pendingAction.kind] : null;
  const PendingActionIcon = pendingAction?.kind === "classify_sessions"
    ? Database
    : pendingAction?.kind === "generate_forecast"
      ? CalendarRange
      : BrainCircuit;

  return (
    <section className="screen agent-screen">
      <div className="agent-page-header">
        <div>
          <p className="eyebrow">Ask Agent</p>
          <div className="agent-title-row">
            <span className="agent-title-icon"><AgentMark size={16} aria-hidden /></span>
            <h1>Weekform Agent</h1>
          </div>
          <p>Understand your capacity and decide what to work on next.</p>
        </div>
        <div className="agent-header-actions">
          <span className={`agent-data-freshness${hasSignal ? "" : " agent-data-freshness--waiting"}`}><span /> {signalStatusLabel}</span>
        {messages.length > 0 && (
          <button type="button" className="secondary-action" onClick={() => setConfirmingClear(true)} title="Clear chat">
            <Trash2 size={16} aria-hidden /> Clear
          </button>
        )}
        </div>
      </div>

      <div className="agent-workspace">
        <section className="agent-briefing" aria-label="Current workload context">
          <p className="briefing-line">
            <AgentMark size={13} aria-hidden />
            {hasSignal ? (
              <span>
                <strong>{briefing.capacity}%</strong> reliable capacity this week · primary focus{" "}
                <strong>{briefing.primaryFocus}</strong> · planned {briefing.planned}% / reactive{" "}
                {briefing.reactive}% · {riskLabel} — the full breakdown lives on the Week screen.
              </span>
            ) : (
              <span>
                {hasRawSessions
                  ? `${formatCount(sessionCount)} raw active-window session${sessionCount === 1 ? "" : "s"} captured — review today to ground the Agent.`
                  : "No tracked work yet — import a calendar or resume tracking to ground the Agent."}
              </span>
            )}
          </p>
          {hasSignal ? (
            <div className="briefing-actions">
              <button type="button" disabled={!aiAvailable} title={aiAvailable ? undefined : AI_UNAVAILABLE_HINT} onClick={() => handleSuggested("Explain why my reliable capacity is at its current level.")}>Explain forecast <ArrowRight size={14} aria-hidden /></button>
              <button type="button" disabled={!aiAvailable} title={aiAvailable ? undefined : AI_UNAVAILABLE_HINT} onClick={() => handleSuggested("Help me plan my week around my current reliable capacity.")}>Plan my week <ArrowRight size={14} aria-hidden /></button>
            </div>
          ) : hasRawSessions && (
            <div className="briefing-actions">
              <button type="button" onClick={() => onOpenScreen("daily")}>Review sessions <ArrowRight size={14} aria-hidden /></button>
            </div>
          )}
        </section>

        {messages.length === 0 && !isSending && (
          <section className="agent-starters" aria-label="Suggested agent actions">
            <div className="starter-heading">
              <div><span>Common questions</span><p>{hasSignal ? "The Agent will ground its answer in your tracked work." : "Review captured sessions for sharper answers."}</p></div>
            </div>
            <div className="starter-grid">
              {starterActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button key={action.title} type="button" disabled={!aiAvailable} title={aiAvailable ? undefined : AI_UNAVAILABLE_HINT} onClick={() => handleSuggested(action.prompt)}>
                    <span className={`starter-icon starter-icon--${action.iconClass}`}>
                      <Icon size={17} strokeWidth={1.9} aria-hidden />
                    </span>
                    <span><strong>{action.title}</strong><small>{action.description}</small></span>
                    <ArrowRight size={15} aria-hidden />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className={`agent-chat-container ${messages.length === 0 ? "is-empty" : ""}`}>
        <div className="agent-messages" ref={messagesRef}>
          {messages.length > visibleMessages.length && (
            <button className="load-earlier-messages" type="button" onClick={loadEarlierMessages}>
              Load {earlierMessageCount} earlier message{earlierMessageCount === 1 ? "" : "s"}
            </button>
          )}
          {visibleMessages.map((m, idx) => {
            const isCurrentStream = streamingMessageId === m.id;
            const isThinking = isCurrentStream && m.content === AGENT_PENDING_MESSAGE;
            const isRevealing = isCurrentStream && !isThinking;
            const isFailure = m.role === "assistant" && (m.interrupted === true || m.id.startsWith("err-"));
            return (
              <div key={m.id || idx} className={`agent-message ${m.role}`}>
                {m.role === "assistant" && (
                  <div className="agent-avatar">
                    <span className="sr-only">Assistant</span>
                    <AgentMark size={16} animated={isCurrentStream} aria-hidden />
                  </div>
                )}
                <div className="agent-bubble">
                  {m.role === "user" && <span className="sr-only">You: </span>}
                  <div
                    className={`agent-content${isCurrentStream ? " streaming" : ""}${isThinking ? " thinking" : ""}${isRevealing ? " revealing" : ""}`}
                    role={isFailure ? "alert" : undefined}
                  >
                    {isThinking ? (
                      <AgentThinkingText />
                    ) : m.role === "assistant" && isCurrentStream ? (
                      <Suspense fallback={<AgentThinkingText />}>
                        <AgentMarkdown content={m.content} />
                      </Suspense>
                    ) : m.role === "assistant" ? (
                      <Suspense fallback={<AgentThinkingText />}>
                        <AgentMarkdown content={m.content} />
                      </Suspense>
                    ) : (
                      m.content
                    )}
                  </div>
                  {!isCurrentStream &&
                    m.role === "assistant" &&
                    m.content &&
                    hasSignal &&
                    idx === visibleMessages.length - 1 &&
                    CAPACITY_CITATION_RE.test(m.content) && (
                      <CapacityContextStrip capacity={briefing.capacity} planned={briefing.planned} reactive={briefing.reactive} />
                    )}
                  {!isCurrentStream && m.content && (
                    <div className="agent-message-meta">
                      {m.createdAt && (
                        <time dateTime={m.createdAt}>
                          {formatClockTime(m.createdAt)}
                        </time>
                      )}
                      <button
                        type="button"
                        onClick={() => void copyMessage(m)}
                        title={copiedMessageId === m.id ? "Copied" : m.role === "assistant" ? "Copy response" : "Copy message"}
                        aria-label={copiedMessageId === m.id ? "Copied" : m.role === "assistant" ? "Copy response" : "Copy message"}
                      >
                        {copiedMessageId === m.id ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                      </button>
                      {m.role === "assistant" && m.analysisSummary && (
                        <button
                          type="button"
                          onClick={() => setExpandedDetails((value) => ({ ...value, [m.id]: !value[m.id] }))}
                          aria-expanded={Boolean(expandedDetails[m.id])}
                          aria-controls={`analysis-detail-${m.id}`}
                          aria-label="Toggle analysis details"
                        >
                          Analysis <ChevronDown size={13} aria-hidden />
                        </button>
                      )}
                    </div>
                  )}
                  {expandedDetails[m.id] && m.analysisSummary && (
                    <div id={`analysis-detail-${m.id}`} className="agent-analysis-detail">
                      <Database size={14} aria-hidden />
                      <span>{m.analysisSummary}</span>
                    </div>
                  )}
                  {!isCurrentStream &&
                    m.role === "assistant" &&
                    m.interrupted &&
                    idx === visibleMessages.length - 1 && (
                    <div className="agent-retry-row">
                      <button
                        type="button"
                        className="agent-retry-button"
                        onClick={() => retryMessage(m.id)}
                        disabled={isSending}
                      >
                        <RotateCcw size={13} aria-hidden /> Retry
                      </button>
                    </div>
                  )}
                  {!isCurrentStream &&
                    m.role === "assistant" &&
                    m.content &&
                    !m.interrupted &&
                    !isSending &&
                    idx === visibleMessages.length - 1 &&
                    followUpSuggestions.length > 0 && (
                      <div className="agent-followups" role="group" aria-label="Suggested follow-up questions">
                        {followUpSuggestions.map((question) => (
                          <button
                            key={question}
                            type="button"
                            className="agent-followup-chip"
                            disabled={!aiAvailable}
                            title={aiAvailable ? undefined : AI_UNAVAILABLE_HINT}
                            onClick={() => handleSuggested(question)}
                          >
                            {question} <ArrowRight size={12} aria-hidden />
                          </button>
                        ))}
                      </div>
                    )}
                </div>
              </div>
            );
          })}

          {pendingAction && pendingActionCopy && (
            <section
              className={`agent-action-card is-${pendingAction.status}`}
              aria-label={`${pendingActionCopy.title} action`}
              aria-live="polite"
            >
              <div className="agent-action-icon" aria-hidden>
                {pendingAction.status === "completed"
                  ? <Check size={16} />
                  : <PendingActionIcon size={16} />}
              </div>
              <div className="agent-action-copy">
                <span className="agent-action-eyebrow">
                  {pendingAction.status === "awaiting" && "Approval required"}
                  {pendingAction.status === "running" && "Running with your approval"}
                  {pendingAction.status === "completed" && "Action completed"}
                  {pendingAction.status === "failed" && "Action needs attention"}
                </span>
                <strong>{pendingActionCopy.title}</strong>
                <p>{pendingAction.resultMessage || pendingAction.reason}</p>
              </div>
              <div className="agent-action-controls">
                {pendingAction.status === "awaiting" && (
                  <>
                    <button
                      className="agent-action-confirm"
                      type="button"
                      onClick={() => void approvePendingAction()}
                      disabled={isSending}
                    >
                      {pendingActionCopy.confirmLabel}
                    </button>
                    <button type="button" onClick={cancelPendingAction} disabled={isSending}>Not now</button>
                  </>
                )}
                {pendingAction.status === "running" && (
                  <button className="agent-action-confirm" type="button" disabled>
                    <AgentMark size={13} animated aria-hidden /> {pendingActionCopy.runningLabel}
                  </button>
                )}
                {pendingAction.status === "completed" && (
                  <>
                    <button
                      className="agent-action-confirm"
                      type="button"
                      onClick={() => onOpenScreen(pendingActionCopy.destination)}
                    >
                      {pendingActionCopy.destinationLabel} <ArrowRight size={13} aria-hidden />
                    </button>
                    <button type="button" onClick={cancelPendingAction}>Dismiss</button>
                  </>
                )}
                {pendingAction.status === "failed" && (
                  <>
                    <button className="agent-action-confirm" type="button" onClick={() => void approvePendingAction()}>
                      Try again
                    </button>
                    <button type="button" onClick={cancelPendingAction}>Dismiss</button>
                  </>
                )}
              </div>
            </section>
          )}

          {isSending && !streamingMessageId && (
            <div className="agent-progress" role="status">
              <div className="agent-progress-head">
                <span className="agent-pulse"><AgentMark size={15} animated aria-hidden /></span>
                <div><strong>Working through your workload</strong><small>Using local activity, calendar, blocks, and corrections</small></div>
              </div>
              <div className="agent-progress-steps">
                {analysisSteps.map((step, index) => (
                  <div className={index < analysisStage ? "is-complete" : index === analysisStage ? "is-active" : ""} key={step}>
                    <span>{index < analysisStage ? <Check size={11} aria-hidden /> : index + 1}</span>{step}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          {latestAssistantAnnouncement}
        </div>
      </div>

      <div className="agent-composer-shell">
        <div className="agent-input-area">
          <textarea
            ref={inputRef}
            className="agent-input"
            aria-label="Ask about your capacity, focus, or what to do next"
            placeholder={inputPlaceholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            rows={1}
          />
          {isStreaming ? (
            <button
              type="button"
              className="agent-send agent-stop"
              onClick={stopGeneration}
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square size={15} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              className="agent-send"
              onClick={handleSend}
              disabled={!input.trim() || isSending || !aiAvailable}
              title={aiAvailable ? "Send" : AI_UNAVAILABLE_HINT}
              aria-label="Send message"
            >
              {isSending ? <AgentMark size={16} animated aria-hidden /> : <Send size={16} aria-hidden />}
            </button>
          )}
        </div>
      </div>
      </div>

      {confirmingClear && (
        <ConfirmDialog
          title="Clear this conversation?"
          description="This clears this saved conversation from your device. It can't be undone."
          confirmLabel="Clear conversation"
          onConfirm={() => {
            setConfirmingClear(false);
            clearChat();
          }}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </section>
  );
}
