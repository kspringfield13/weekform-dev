import { lazy, Suspense, useMemo, useState, useEffect, useRef, type CSSProperties } from "react";
import {
  ArrowRight,
  Bot,
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
  Sparkles,
  Square,
  Trash2,
  User,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type {
  WorkBlock,
  ActivitySession,
  OutlookCalendarEvent,
  UserCorrection,
  VisualContextInsight,
  WeeklyCapacitySnapshot,
  AIConfig,
} from "../../../../../packages/domain/src/models";
import type { AgentChatMessage } from "../../lib/types";
import type { PushToast } from "../../hooks/useToasts";
import { agentTools, AGENT_INSTRUCTIONS } from "../../services/agentTools";
import { getAIProviderPreset } from "../../services/aiProviders";
import { getCurrentIsoWeekId, getLocalDateKey } from "../../lib/date";
import { formatClockTime, formatCount } from "../../lib/format";
import { withAiTimeout } from "../../lib/aiTimeout";
import { scrollBehavior } from "../../lib/motion";
import { ConfirmDialog } from "../common/ConfirmDialog";
import type { tool as AiToolFn } from "ai";
import type { Screen } from "../../lib/types";

const AgentMarkdown = lazy(() => import("./AgentMarkdown"));
const CHAT_STORAGE_KEY = "clear-capacity.agent-chat.v2";
const DRAFT_STORAGE_KEY = "clear-capacity.agent-draft.v1";
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
const GROUNDED_AGENT_FALLBACK_INSTRUCTIONS = `You are the ClearCapacity Agent.

Answer using only the provided local ClearCapacity facts and recent conversation.
Be concrete, concise, and honest about thin data.
If the user has raw sessions but no reviewed work blocks, explain that capacity and workload recommendations are limited until sessions are classified/reviewed.`;

interface AgentScreenProps {
  blocks: WorkBlock[];
  snapshot: WeeklyCapacitySnapshot;
  activeWindowSessions: ActivitySession[];
  calendarEvents: OutlookCalendarEvent[];
  corrections: UserCorrection[];
  visualContextInsights: VisualContextInsight[];
  todayKey: string;
  currentWeekRangeLabel: string;
  aiConfig: AIConfig | null;
  onOpenScreen: (screen: Screen) => void;
  pushToast: PushToast;
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

function StreamingAgentContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  return (
    <div className="agent-streaming-content">
      {lines.map((line, index) => (
        <span
          key={`stream-line-${index}`}
          className={`agent-stream-line${line.trim() ? "" : " is-empty"}`}
          style={{ "--line-index": index } as CSSProperties}
        >
          <span className="agent-stream-line-text">{line || "\u00a0"}</span>
        </span>
      ))}
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
  todayKey,
  currentWeekRangeLabel,
  aiConfig,
  onOpenScreen,
  pushToast,
}: AgentScreenProps) {
  const [messages, setMessages] = useState<AgentChatMessage[]>(() => {
    try {
      const cached = window.localStorage.getItem(CHAT_STORAGE_KEY);
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
      return window.localStorage.getItem(DRAFT_STORAGE_KEY) || "";
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const topProjects = useMemo(() => {
    const totals = new Map<string, number>();
    // Scope to the snapshot's week so the briefing's "primary focus this week"
    // names the week's top project, matching the week-scoped `getPrimaryFocus`
    // tool (and the sibling `weekBlocks` memo's block.week_id predicate) instead
    // of surfacing a project that only dominated the full accumulated ledger.
    blocks
      .filter((block) => block.week_id === snapshot.week_id)
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
    () => blocks.filter((block) => block.week_id === snapshot.week_id),
    [blocks, snapshot.week_id]
  );
  const weekCalendarEvents = useMemo(
    () => calendarEvents.filter((event) => getCurrentIsoWeekId(new Date(event.start_time)) === snapshot.week_id),
    [calendarEvents, snapshot.week_id]
  );

  // Data context for tools (bound here)
  const context = {
    blocks: weekBlocks,
    snapshot,
    sessions: activeWindowSessions,
    calendarEvents: weekCalendarEvents,
    corrections,
    visualContextInsights,
    todayKey,
  };

  useEffect(() => {
    void import("./AgentMarkdown");
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-200)));
    } catch {
      // Keep the in-memory conversation if storage is full or disabled.
    }
  }, [messages]);

  useEffect(() => {
    try {
      if (input) window.localStorage.setItem(DRAFT_STORAGE_KEY, input);
      else window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // Draft persistence is best effort.
    }
  }, [input]);

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
    // Fall back to the provider's own preset default, not a hardcoded "gpt-4o". Custom presets
    // have no default, so that path still relies on the user-entered model.
    const modelId = config.model?.trim() || getAIProviderPreset(provider).model;
    const baseURL = config.baseUrl ? config.baseUrl.replace(/\/$/, "") : undefined;

    // All providers use an OpenAI-compatible endpoint.
    // Use "compatible" for 3rd-party / non-strict OpenAI endpoints.
    const isCustomish = provider === "custom" || provider === "grok" || provider === "deepseek";
    const { createOpenAI } = await import("@ai-sdk/openai");
    const openaiProvider = createOpenAI({
      apiKey,
      baseURL,
      compatibility: isCustomish ? "compatible" : "strict",
    });
    return openaiProvider(modelId);
  }

  // Wrap Eve-style tools (inputSchema) for the ai SDK (expects parameters).
  // Execute is rebound to inject our app context (the "ctx" in a real Eve tool).
  // createTool is the `tool` helper from the ai SDK; t is intentionally `any` because Eve
  // tool execute signatures have narrow ctx types (e.g. { snapshot }) that are structurally
  // incompatible with a shared interface, but are always safe at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function createBoundTools(ctx: typeof context, createTool: typeof AiToolFn) {
    const toAiTool = (t: any) =>
      createTool({
        description: t.description,
        parameters: t.inputSchema ?? t.parameters,
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
    ] = await Promise.all([
      agentTools.getCapacitySnapshot.execute({}, context),
      agentTools.getWeekWorkload.execute({}, context),
      agentTools.getDayActivity.execute({ todayKey }, context),
      agentTools.getPrimaryFocus.execute({}, context),
      agentTools.getRecentCorrections.execute({ limit: 5 }, context),
      agentTools.getCalendarSummary.execute({}, context),
      agentTools.getVisualInsightsSummary.execute({ limit: 5 }, context),
    ]);

    const latestUserQuestion = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
    const recentConversation = history
      .slice(-8)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    return `Local ClearCapacity facts:
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

    const userMsg: AgentChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: messageText.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
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
    // Drives the Rust fallback prompt below if the SDK + grounded paths both fail.
    const latestUserQuestion = [...history].reverse().find((m) => m.role === "user")?.content ?? "";

    try {
      const sdkModel = await resolveAgentModel(aiConfig);

      if (sdkModel) {
        const [{ generateText, streamText, tool: createTool }] = await Promise.all([import("ai")]);
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
          maxSteps: 6,
          abortSignal: controller.signal,
        });

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
        let firstStreamedAt: number | null = null;
        let streamTimedOut = false;
        let streamTimeout: ReturnType<typeof window.setTimeout> | null = null;
        const holdStreamingReveal = async (content: string) => {
          if (!content.trim() || controller.signal.aborted) return;
          const startedAt = firstStreamedAt ?? Date.now();
          const elapsed = Date.now() - startedAt;
          await sleep(getStreamingRevealDuration(content) - elapsed, controller.signal);
        };
        const consumeStream = async () => {
          for await (const delta of streamResult.textStream) {
            if (streamTimedOut) return;
            streamed += delta;
            firstStreamedAt ??= Date.now();
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: streamed } : m))
            );
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
            streamed = buildDeterministicAgentFallback(latestUserQuestion, AGENT_STREAM_TIMEOUT_MESSAGE);
            firstStreamedAt = Date.now();
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: streamed, interrupted: false } : m))
            );
            await holdStreamingReveal(streamed);
            setIsStreaming(false);
            setStreamingMessageId(null);
            return;
          }
        } catch {
          if (streamTimedOut) {
            streamed = buildDeterministicAgentFallback(latestUserQuestion, AGENT_STREAM_TIMEOUT_MESSAGE);
            firstStreamedAt = Date.now();
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
          finalText = (await withAiTimeout(streamResult.text, FINAL_AGENT_TEXT_TIMEOUT_MS)).trim();
        } catch {
          finalText = "";
        }
        if (finalText && finalText !== streamed.trim()) {
          streamed = finalText;
          firstStreamedAt = Date.now();
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: streamed } : m))
          );
        }

        // Some provider/model combinations complete tool calls but yield no final streamed text.
        // Retry once without tools, embedding the same local tool facts, so the user gets a useful
        // grounded answer instead of a dead-end "empty response" bubble.
        if (!streamed.trim()) {
          try {
            const groundedPrompt = await buildGroundedAgentPrompt(history);
            const retry = await withAiTimeout(
              generateText({
                model: sdkModel,
                system: GROUNDED_AGENT_FALLBACK_INSTRUCTIONS,
                prompt: groundedPrompt,
                abortSignal: controller.signal,
              }),
              AGENT_STREAM_TIMEOUT_MS
            );
            streamed = retry.text.trim();
          } catch {
            streamed = "";
          }

          if (!streamed.trim()) {
            streamed = buildDeterministicAgentFallback(latestUserQuestion);
          }

          firstStreamedAt = Date.now();
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: streamed, interrupted: false } : m))
          );
        }

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
      } else {
        // Grounded fallback (no key)
        const fallback = `I don't have an AI provider configured yet. ${buildDeterministicAgentFallback(latestUserQuestion, "Based on current local data")} Go to Settings → AI assistance to add a key (OpenAI, Grok, DeepSeek, or custom).`;
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
      if (controller.signal.aborted) return;
      // Best effort fallback via the Rust path, then pure data
      try {
        const historyStr = history.map((m) => `${m.role}: ${m.content}`).join("\n");
        const fallbackPrompt = `You are the ClearCapacity Agent focused only on capacity, workload and weekly focus. Use only the user's data. Conversation so far:\n${historyStr}\n\nLatest user question: ${latestUserQuestion}`;
        const resp = await withAiTimeout(
          invoke<{ response?: string }>("chat_with_agent", {
            request: { prompt: fallbackPrompt, ai_config: aiConfig || undefined },
          })
        );
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
        const errText = `Sorry, the Agent hit an error: ${e?.message || e}. Make sure your AI provider is set in Settings → AI assistance and you have data for the week.`;
        setMessages((prev) => [...prev, {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: errText,
          createdAt: new Date().toISOString(),
        }]);
      }
    } finally {
      setIsSending(false);
      setIsStreaming(false);
      setStreamingMessageId(null);
      abortControllerRef.current = null;
    }
  }

  // Public handlers
  async function handleSend() {
    await sendMessage(input);
  }

  function handleSuggested(question: string) {
    if (isSending) return;
    void sendMessage(question);
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
    setVisibleMessageCount(INITIAL_MESSAGE_COUNT);
    setIsStreaming(false);
    setStreamingMessageId(null);
    try {
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
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

  return (
    <section className="screen agent-screen">
      <div className="agent-page-header">
        <div>
          <div className="agent-title-row">
            <span className="agent-title-icon"><Sparkles size={16} aria-hidden /></span>
            <h1>Workload Agent</h1>
          </div>
          <p>Understand your capacity and decide what to work on next.</p>
        </div>
        <div className="agent-header-actions">
          <span className={`agent-data-freshness${hasSignal ? "" : " agent-data-freshness--waiting"}`}><span /> {signalStatusLabel}</span>
        {messages.length > 0 && (
          <button className="secondary-action" onClick={() => setConfirmingClear(true)} title="Clear chat">
            <Trash2 size={16} aria-hidden /> Clear
          </button>
        )}
        </div>
      </div>

      <div className="agent-workspace">
        <section className="agent-briefing" aria-label="Current workload context">
          <p className="briefing-line">
            <Sparkles size={13} aria-hidden />
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
              <button type="button" onClick={() => handleSuggested("Explain why my reliable capacity is at its current level.")}>Explain forecast <ArrowRight size={14} aria-hidden /></button>
              <button type="button" onClick={() => handleSuggested("Help me plan my week around my current reliable capacity.")}>Plan my week <ArrowRight size={14} aria-hidden /></button>
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
                  <button key={action.title} type="button" onClick={() => handleSuggested(action.prompt)}>
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
            return (
              <div key={m.id || idx} className={`agent-message ${m.role}`}>
                <div className="agent-avatar">
                  {m.role === "assistant" ? <Bot size={16} /> : <User size={16} />}
                </div>
                <div className="agent-bubble">
                  <div className={`agent-content${isCurrentStream ? " streaming" : ""}${isThinking ? " thinking" : ""}`}>
                    {isThinking ? (
                      <AgentThinkingText />
                    ) : m.role === "assistant" && isCurrentStream ? (
                      <StreamingAgentContent content={m.content} />
                    ) : m.role === "assistant" ? (
                      <Suspense fallback={<span>{m.content}</span>}>
                        <AgentMarkdown content={m.content} />
                      </Suspense>
                    ) : (
                      m.content
                    )}
                  </div>
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
                          aria-label="Toggle analysis details"
                        >
                          Analysis <ChevronDown size={13} aria-hidden />
                        </button>
                      )}
                    </div>
                  )}
                  {expandedDetails[m.id] && m.analysisSummary && (
                    <div className="agent-analysis-detail">
                      <Database size={14} aria-hidden />
                      <span>{m.analysisSummary}</span>
                    </div>
                  )}
                  {!isCurrentStream && m.role === "assistant" && m.interrupted && (
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

          {isSending && !streamingMessageId && (
            <div className="agent-progress" role="status">
              <div className="agent-progress-head">
                <span className="agent-pulse"><BrainCircuit size={15} aria-hidden /></span>
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
              className="agent-send agent-stop"
              onClick={stopGeneration}
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square size={15} aria-hidden />
            </button>
          ) : (
            <button
              className="agent-send"
              onClick={handleSend}
              disabled={!input.trim() || isSending}
              title="Send"
              aria-label="Send message"
            >
              <Send size={16} aria-hidden />
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
