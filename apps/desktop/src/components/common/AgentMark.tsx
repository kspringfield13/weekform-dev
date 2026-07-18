import type { SVGProps } from "react";

type AgentMarkProps = SVGProps<SVGSVGElement> & {
  size?: number;
  /** Undulates the bars — set while AI is actively working (thinking/generating). */
  animated?: boolean;
};

/**
 * Weekform's AI mark: one continuous signal wave — the WeekformMark
 * crest drawn as a line. Used wherever AI assistance is surfaced, in
 * place of the generic sparkle glyph. Drop-in lucide-compatible
 * (size/strokeWidth/currentColor).
 */
export function AgentMark({ size = 16, strokeWidth = 2, animated = false, className, ...rest }: AgentMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={`agent-mark${animated ? " agent-mark--animated" : ""}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <path d="M2.5 12c1.6-4.8 3.15-4.8 4.75 0s3.15 4.8 4.75 0 3.15-4.8 4.75 0 3.15 4.8 4.75 0" />
    </svg>
  );
}
