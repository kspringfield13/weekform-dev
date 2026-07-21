"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { CapacitySignalMetrics, CapacitySignalScene } from "./capacitySignalScene";

type CapacitySignalGraphicProps = CapacitySignalMetrics;

function clampPct(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

/**
 * Web counterpart to the Mac Week capacity signal. The SVG remains visible
 * until the lazily loaded Three.js scene is ready, and remains the permanent
 * rendering when WebGL or the wide-screen visual slot is unavailable.
 */
export function CapacitySignalGraphic({ available, committed }: CapacitySignalGraphicProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CapacitySignalScene | null>(null);
  const metricsRef = useRef<CapacitySignalMetrics>({ available, committed });
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const gradientId = `capacity-signal-${useId().replace(/:/g, "")}`;
  const committedPct = clampPct(committed);
  const availablePct = Math.min(clampPct(available), 100 - committedPct);
  const availableEnd = committedPct + availablePct;
  metricsRef.current = { available, committed };

  useEffect(() => {
    let cancelled = false;
    let initializing = false;
    const visualQuery = window.matchMedia("(min-width: 971px)");

    async function initialize() {
      if (initializing || sceneRef.current || !visualQuery.matches) return;
      initializing = true;
      const host = hostRef.current;
      const canvas = canvasRef.current;
      if (!host || !canvas) return;

      try {
        const { createCapacitySignalScene } = await import("./capacitySignalScene");
        if (cancelled) return;
        sceneRef.current = createCapacitySignalScene({
          canvas,
          host,
          metrics: metricsRef.current,
          onReady: () => {
            if (!cancelled) setStatus("ready");
          },
          onUnavailable: () => {
            if (!cancelled) setStatus("fallback");
          },
        });
      } catch (error) {
        if (!cancelled) {
          console.warn("Capacity signal is using its static fallback.", error);
          setStatus("fallback");
        }
      }
    }

    function handleVisualQuery() {
      if (visualQuery.matches) void initialize();
    }

    visualQuery.addEventListener("change", handleVisualQuery);
    handleVisualQuery();
    return () => {
      cancelled = true;
      visualQuery.removeEventListener("change", handleVisualQuery);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setMetrics({ available, committed });
  }, [available, committed]);

  return (
    <div
      ref={hostRef}
      className={`capacity-signal-graphic is-${status}`}
      aria-hidden="true"
      data-renderer={status}
    >
      <svg
        className="capacity-signal-fallback"
        viewBox="0 0 340 176"
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" className="capacity-signal-stop-committed" />
            <stop offset={`${committedPct}%`} className="capacity-signal-stop-committed" />
            <stop offset={`${committedPct}%`} className="capacity-signal-stop-available" />
            <stop offset={`${availableEnd}%`} className="capacity-signal-stop-available" />
            <stop offset={`${availableEnd}%`} className="capacity-signal-stop-protected" />
            <stop offset="100%" className="capacity-signal-stop-protected" />
          </linearGradient>
        </defs>
        <g className="capacity-signal-grid">
          <path d="M26 38H318M20 76H324M16 114H328M26 152H318" />
          <path d="M58 20V158M116 16V162M174 14V164M232 16V162M290 20V158" />
        </g>
        <g className="capacity-signal-field">
          <path
            className="capacity-signal-field-glow"
            stroke={`url(#${gradientId})`}
            d="M20 102C45 78 67 124 94 101S143 72 169 99s51 32 78 2 51-24 73-4"
          />
          <path
            className="capacity-signal-field-line"
            stroke={`url(#${gradientId})`}
            d="M20 102C45 78 67 124 94 101S143 72 169 99s51 32 78 2 51-24 73-4"
          />
          <path
            className="capacity-signal-field-rail"
            d="M20 88C45 64 67 110 94 87s49-29 75-2 51 32 78 2 51-24 73-4"
          />
          <path
            className="capacity-signal-field-rail"
            d="M20 116c25-24 47 22 74-1s49-29 75-2 51 32 78 2 51-24 73-4"
          />
        </g>
        <g className="capacity-signal-nodes">
          {[32, 72, 112, 152, 192, 232, 272, 312].map((x, index) => (
            <circle key={x} cx={x} cy={index % 2 === 0 ? 94 : 104} r="2.4" />
          ))}
        </g>
      </svg>
      <canvas ref={canvasRef} className="capacity-signal-canvas" />
    </div>
  );
}
