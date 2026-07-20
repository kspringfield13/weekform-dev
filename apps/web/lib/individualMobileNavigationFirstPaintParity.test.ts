import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellSource = readFileSync(
  new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("narrow first paint keeps navigation closed until modal state explicitly opens it", () => {
  assert.match(
    shellSource,
    /className=\{`app web-individual-app[^`]*\$\{mobileNavigationOpen\s*\?\s*["'] mobile-navigation-open["']\s*:\s*["']["']\}`\}/,
    "the rendered shell must expose the same explicit open state that owns dialog, inert, and focus behavior",
  );
  assert.match(
    shellSource,
    /aria-expanded=\{viewportResolved\s*\?\s*\(isNarrowViewport\s*\?\s*mobileNavigationOpen\s*:\s*!sidebarCollapsed\)\s*:\s*undefined\}/,
    "the opener must not announce an SSR expansion state before the viewport mode is known",
  );
  assert.match(
    shellSource,
    /className=\{`app web-individual-app[^`]*\$\{viewportResolved\s*\?\s*["'] viewport-resolved["']\s*:\s*["']["']\}/,
    "the rendered shell must expose viewport readiness before a narrow opener is shown",
  );

  assert.match(
    globalStyles,
    /@media \(max-width: 820px\)[\s\S]*?\.web-individual-app:not\(\.mobile-navigation-open\)\s*>\s*\.sidebar\s*\{[^}]*visibility:\s*hidden[^}]*opacity:\s*0[^}]*pointer-events:\s*none[^}]*transform:\s*translateX\(-100%\)[^}]*\}/,
    "the narrow drawer must be visually closed and non-interactive on the server/first paint",
  );
  assert.match(
    globalStyles,
    /@media \(max-width: 820px\)[\s\S]*?\.web-individual-app\.mobile-navigation-open\s*>\s*\.sidebar\s*\{[^}]*visibility:\s*visible[^}]*opacity:\s*1[^}]*pointer-events:\s*auto[^}]*transform:\s*translateX\(0\)[^}]*\}/,
    "the explicit modal-open state must restore the complete drawer visual and interaction state",
  );
  assert.match(
    globalStyles,
    /@media \(max-width: 820px\)[\s\S]*?\.web-individual-app\.app::after\s*\{[^}]*opacity:\s*0[^}]*pointer-events:\s*none[^}]*\}/,
    "the narrow first-paint scrim must be visually absent and non-interactive",
  );
  assert.match(
    globalStyles,
    /@media \(max-width: 820px\)[\s\S]*?\.web-individual-app(?:\.app)?\.mobile-navigation-open(?:\.app)?::after\s*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto[^}]*\}/,
    "the narrow scrim must become visible and interactive only with explicit modal-open state",
  );
  assert.match(
    globalStyles,
    /@media \(max-width: 820px\)[\s\S]*?\.web-sidebar-dialog-close\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*\}/,
    "the narrow close control must preserve a touch-ready target",
  );
  assert.match(
    globalStyles,
    /@media \(max-width: 820px\)[\s\S]*?\.web-sidebar-toggle\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*\}/,
    "the narrow opener must preserve a touch-ready target",
  );
  assert.match(
    globalStyles,
    /@media \(max-width: 820px\)[\s\S]*?\.web-sidebar-toggle\s*\{[^}]*display:\s*none[^}]*\}[\s\S]*?\.web-individual-app\.viewport-resolved\s*>\s*\.web-sidebar-toggle\s*\{[^}]*display:\s*grid[^}]*\}[\s\S]*?\.web-individual-app\.mobile-navigation-open\s*>\s*\.web-sidebar-toggle\s*\{[^}]*display:\s*none[^}]*\}/,
    "the narrow opener must stay absent until its label, icon, and expanded state are resolved",
  );
});
