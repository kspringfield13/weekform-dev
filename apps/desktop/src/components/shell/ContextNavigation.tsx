import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { MAIN_TABPANEL_ID, primarySectionForScreen, sectionLabels, sectionViews, tabId } from "../../lib/ui";
import type { Screen } from "../../lib/types";

export function ContextNavigation({
  active,
  setActive,
  showFlaggedTab
}: {
  active: Screen;
  setActive: (screen: Screen) => void;
  showFlaggedTab: boolean;
}) {
  const section = primarySectionForScreen(active);
  // Keep the tab visible while the user is ON the flagged screen so the nav
  // never highlights nothing, even if the queue empties out from under them.
  const views = sectionViews(section, { includeFlagged: showFlaggedTab || active === "sensitive" });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (views.length === 0) {
    return null;
  }

  // Move selection AND focus together — the WAI-ARIA tabs pattern keeps a single
  // Tab stop (roving tabIndex), so arrow keys must both activate and focus the tab.
  const focusTab = (index: number) => {
    const view = views[index];
    if (!view) {
      return;
    }
    setActive(view.id);
    tabRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = (index - 1 + views.length) % views.length;
        break;
      case "ArrowRight":
        nextIndex = (index + 1) % views.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = views.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusTab(nextIndex);
  };

  const sectionLabel = section ? sectionLabels[section] ?? section : "";

  return (
    <nav className="context-navigation" aria-label={`${sectionLabel} views`} role="tablist">
      {views.map((view, index) => (
        <button
          className={active === view.id ? "is-active" : ""}
          key={view.id}
          id={tabId(view.id)}
          type="button"
          role="tab"
          ref={(el) => {
            tabRefs.current[index] = el;
          }}
          onClick={() => setActive(view.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          aria-selected={active === view.id}
          aria-controls={MAIN_TABPANEL_ID}
          tabIndex={active === view.id ? 0 : -1}
        >
          {view.label}
        </button>
      ))}
    </nav>
  );
}
