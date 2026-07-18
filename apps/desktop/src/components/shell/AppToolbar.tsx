import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Moon, Pause, Play, Sun, Minimize2 } from "lucide-react";
import { WeekformMark } from "../common/WeekformMark";

export function AppToolbar({
  paused,
  setPaused,
  windowMode,
  setWindowMode,
  theme,
  setTheme
}: {
  paused: boolean;
  setPaused: (value: boolean) => void;
  windowMode: "large" | "compact";
  setWindowMode: (value: "large" | "compact") => void;
  theme: "light" | "dark";
  setTheme: (value: "light" | "dark") => void;
}) {
  function startToolbarDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a, [role='button']")) {
      return;
    }

    void getCurrentWindow().startDragging();
  }

  return (
    <header className="app-toolbar" onPointerDown={startToolbarDrag}>
      {windowMode === "large" && (
        <div className="toolbar-sidebar-drag" aria-hidden="true" />
      )}

      {windowMode === "compact" && (
        <>
          <div className="toolbar-drag-region" />
          <strong className="compact-toolbar-name">
            <WeekformMark className="compact-toolbar-logo" />
            <span>Weekform</span>
          </strong>
          <div className="compact-toolbar-actions" onPointerDown={(event) => event.stopPropagation()}>
            <button
              aria-label={theme === "dark" ? "Use Light Theme" : "Use Dark Theme"}
              aria-pressed={theme === "dark"}
              type="button"
              title={theme === "dark" ? "Use Light Theme" : "Use Dark Theme"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={13} aria-hidden /> : <Moon size={13} aria-hidden />}
            </button>
            <button
              aria-label="Expand to large window"
              type="button"
              title="Expand to large window"
              onClick={() => setWindowMode("large")}
            >
              <Maximize2 size={13} aria-hidden />
            </button>
          </div>
        </>
      )}

      {windowMode === "large" && (
        <div className="toolbar-actions" onPointerDown={(event) => event.stopPropagation()}>
          <button
            aria-label={paused ? "Resume Tracking" : "Pause Tracking"}
            aria-pressed={paused}
            className={paused ? "chrome-button is-paused" : "chrome-button"}
            type="button"
            onClick={() => setPaused(!paused)}
            title={paused ? "Resume Tracking" : "Pause Tracking"}
          >
            {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
          </button>
          <button
            aria-label={theme === "dark" ? "Use Light Theme" : "Use Dark Theme"}
            aria-pressed={theme === "dark"}
            className="chrome-button theme-toggle"
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Use Light Theme" : "Use Dark Theme"}
          >
            {theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
          </button>
          <button
            aria-label="Use Compact Widget"
            className="chrome-button"
            type="button"
            onClick={() => setWindowMode("compact")}
            title="Use Compact Widget"
          >
            <Minimize2 size={15} aria-hidden />
          </button>
        </div>
      )}
    </header>
  );
}
