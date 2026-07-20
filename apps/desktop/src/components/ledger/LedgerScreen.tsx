import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Search, PieChart, Monitor, X, Upload } from "lucide-react";
import type {
  WorkBlock,
  ActiveWindowSample,
  ActivitySession,
  VisualContextInsight
} from "../../../../../packages/domain/src/models";
import type { Screen } from "../../lib/types";
import { scrollBehavior } from "../../lib/motion";
import { compactCategory } from "../../lib/format";
import { formatCount, pct } from "../../lib/format";
import { BlockCard } from "./BlockCard";
import { EmptyState } from "../common/EmptyState";
import { ActivityCapturePanel } from "./ActivityCapturePanel";
import { ActivityHeatmap } from "./ActivityHeatmap";

export function LedgerScreen({
  blocks,
  activeWindowSamples,
  activeWindowSessions,
  visualContextInsights,
  captureError,
  classificationStatus,
  classificationError,
  visualContextStatus,
  visualContextError,
  paused,
  aiAvailable,
  onClassifySessions,
  onConfirm,
  onExclude,
  onRelabel,
  onOpenScreen
}: {
  blocks: WorkBlock[];
  activeWindowSamples: ActiveWindowSample[];
  activeWindowSessions: ActivitySession[];
  visualContextInsights: VisualContextInsight[];
  captureError: string | null;
  classificationStatus: "idle" | "classifying" | "error";
  classificationError: string | null;
  visualContextStatus: "idle" | "capturing" | "error";
  visualContextError: string | null;
  paused: boolean;
  aiAvailable: boolean;
  onClassifySessions: () => void;
  onConfirm: (blockId: string) => void;
  onExclude: (blockId: string) => void;
  onRelabel: (blockId: string, field: keyof WorkBlock, value: WorkBlock[keyof WorkBlock]) => void;
  onOpenScreen: (screen: Screen) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [newlyClassifiedBlockIds, setNewlyClassifiedBlockIds] = useState<Set<string>>(
    () => new Set()
  );
  const [latestClassifiedBlockIds, setLatestClassifiedBlockIds] = useState<Set<string>>(
    () => new Set()
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const ledgerListRef = useRef<HTMLDivElement>(null);
  const classificationStartIdsRef = useRef<Set<string> | null>(null);
  const revealTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (classificationStatus === "classifying") {
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
        revealTimeoutRef.current = null;
      }
      if (classificationStartIdsRef.current === null) {
        classificationStartIdsRef.current = new Set(blocks.map((block) => block.work_block_id));
        setNewlyClassifiedBlockIds(new Set());
      }
      return;
    }

    const idsBeforeClassification = classificationStartIdsRef.current;
    if (idsBeforeClassification === null) return;
    classificationStartIdsRef.current = null;

    if (classificationStatus !== "idle") return;

    const createdIds = blocks
      .filter(
        (block) =>
          block.work_block_id.startsWith("ai-session-") &&
          !idsBeforeClassification.has(block.work_block_id)
      )
      .map((block) => block.work_block_id);
    if (createdIds.length === 0) return;

    setLatestClassifiedBlockIds(new Set(createdIds));
    setNewlyClassifiedBlockIds(new Set(createdIds));
    if (ledgerListRef.current) {
      ledgerListRef.current.scrollTo({ top: 0, behavior: scrollBehavior() });
    }
    revealTimeoutRef.current = window.setTimeout(() => {
      setNewlyClassifiedBlockIds(new Set());
      revealTimeoutRef.current = null;
    }, 1000 + createdIds.length * 80);
  }, [blocks, classificationStatus]);

  useEffect(
    () => () => {
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
      }
    },
    []
  );

  const classifiedSessionIds = useMemo(
    () => new Set(blocks.flatMap((block) => block.derived_from)),
    [blocks]
  );
  const unclassifiedSessionCount = useMemo(
    () =>
      activeWindowSessions.filter(
        (session) => !classifiedSessionIds.has(session.session_id) && session.sample_count >= 2
      ).length,
    [activeWindowSessions, classifiedSessionIds]
  );

  const visibleBlocks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matchingBlocks = q
      ? blocks.filter((b) =>
          b.project_name.toLowerCase().includes(q) ||
          (b.stakeholder_group ?? "").toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q) ||
          b.mode.toLowerCase().includes(q)
        )
      : blocks;

    if (latestClassifiedBlockIds.size === 0) return matchingBlocks;

    const latestBlocks: WorkBlock[] = [];
    const remainingBlocks: WorkBlock[] = [];
    matchingBlocks.forEach((block) => {
      if (latestClassifiedBlockIds.has(block.work_block_id)) {
        latestBlocks.push(block);
      } else {
        remainingBlocks.push(block);
      }
    });
    return [...latestBlocks, ...remainingBlocks];
  }, [blocks, latestClassifiedBlockIds, searchQuery]);
  const revealIndexById = useMemo(
    () =>
      new Map(
        visibleBlocks
          .filter((block) => newlyClassifiedBlockIds.has(block.work_block_id))
          .map((block, index) => [block.work_block_id, index])
      ),
    [newlyClassifiedBlockIds, visibleBlocks]
  );

  const current = useMemo(
    () =>
      blocks.length > 0
        ? blocks.reduce((best, b) =>
            (b.end_time || b.start_time) > (best.end_time || best.start_time) ? b : best
          )
        : undefined,
    [blocks]
  );
  return (
    <section className="screen ledger-screen">
      <div className="screen-header compact">
        <div>
          <p className="eyebrow">Activity ledger</p>
          <h1>Explainable inferred work blocks.</h1>
        </div>
        <div className="search-box">
          <Search size={17} aria-hidden />
          <input
            ref={searchInputRef}
            aria-label="Search work blocks"
            placeholder="Search project, stakeholder, category"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setSearchQuery(""); }}
          />
          {searchQuery && (
            <button
              type="button"
              className="search-box-clear"
              aria-label="Clear search"
              onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
            >
              <X size={15} aria-hidden />
            </button>
          )}
        </div>
      </div>
      {current && (
        <section className="current-block">
          <div>
            <p className="eyebrow">Current block</p>
            <h2>{current.project_name}</h2>
            <span>{compactCategory(current.category)} · {current.mode}</span>
          </div>
          <div className="pulse-meter" title="Share of a standard week's modeled capacity this block accounts for">
            <PieChart size={20} aria-hidden />
            <div className="pulse-meter-val">
              <strong>{pct(current.estimated_capacity_pct)}</strong>
              <span className="capacity-caption">of week</span>
              <span className="sr-only">Share of a standard week's modeled capacity this block accounts for</span>
            </div>
          </div>
        </section>
      )}
      <ActivityCapturePanel
        activeWindowSamples={activeWindowSamples}
        activeWindowSessions={activeWindowSessions}
        visualContextInsights={visualContextInsights}
        captureError={captureError}
        classificationStatus={classificationStatus}
        classificationError={classificationError}
        visualContextStatus={visualContextStatus}
        visualContextError={visualContextError}
        unclassifiedSessionCount={unclassifiedSessionCount}
        paused={paused}
        aiAvailable={aiAvailable}
        onClassifySessions={onClassifySessions}
      />
      <ActivityHeatmap sessions={activeWindowSessions} />
      {blocks.length === 0 ? (
        <EmptyState
          icon={Monitor}
          title="No work blocks yet."
          description="Weekform starts empty. Connect or import a calendar, or let active-window capture build local sessions, then use Classify sessions to draft reviewable work blocks."
        >
          {unclassifiedSessionCount > 0 ? (
            <button
              type="button"
              className="primary-action"
              disabled={classificationStatus === "classifying"}
              aria-busy={classificationStatus === "classifying"}
              onClick={onClassifySessions}
            >
              <span>
                {classificationStatus === "classifying"
                  ? "Classifying…"
                  : `Classify ${formatCount(unclassifiedSessionCount)} session${unclassifiedSessionCount === 1 ? "" : "s"}`}
              </span>
            </button>
          ) : (
            <button className="primary-action" type="button" onClick={() => onOpenScreen("setup")}>
              <Upload size={16} aria-hidden />
              <span>Import calendar in Settings</span>
            </button>
          )}
        </EmptyState>
      ) : visibleBlocks.length === 0 ? (
        <EmptyState
          icon={Monitor}
          title="No blocks match."
          description={`No work blocks match "${searchQuery}". Try a different project name, stakeholder, category, or mode.`}
        >
          <button
            type="button"
            className="secondary-action"
            onClick={() => setSearchQuery("")}
          >
            Clear search
          </button>
        </EmptyState>
      ) : (
        <div className="ledger-list" ref={ledgerListRef}>
          <h2 className="sr-only">Work blocks</h2>
          {visibleBlocks.map((block) => {
            const revealIndex = revealIndexById.get(block.work_block_id);
            const revealStyle = revealIndex === undefined
              ? undefined
              : ({ "--classification-index": revealIndex } as CSSProperties);

            return (
              <div
                className={`ledger-list-item${revealIndex === undefined ? "" : " is-newly-classified"}`}
                key={block.work_block_id}
                style={revealStyle}
              >
                <div className="ledger-list-item-inner">
                  <BlockCard
                    block={block}
                    revealIndex={revealIndex}
                    onConfirm={onConfirm}
                    onExclude={onExclude}
                    onRelabel={onRelabel}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
