import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellSource = readFileSync(
  new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url),
  "utf8",
);

test("mobile navigation resolves Escape and both focus-trap boundaries", async () => {
  const { resolveMobileNavigationFocusAction } = await import("./mobileNavigationFocus");

  assert.equal(
    resolveMobileNavigationFocusAction({ key: "Escape", shiftKey: false, activeIndex: 2, itemCount: 5 }),
    "close",
  );
  assert.equal(
    resolveMobileNavigationFocusAction({ key: "Tab", shiftKey: false, activeIndex: 4, itemCount: 5 }),
    "first",
  );
  assert.equal(
    resolveMobileNavigationFocusAction({ key: "Tab", shiftKey: true, activeIndex: 0, itemCount: 5 }),
    "last",
  );
  assert.equal(
    resolveMobileNavigationFocusAction({ key: "Tab", shiftKey: false, activeIndex: 2, itemCount: 5 }),
    "none",
  );
  assert.equal(
    resolveMobileNavigationFocusAction({ key: "ArrowDown", shiftKey: false, activeIndex: 4, itemCount: 5 }),
    "none",
  );
  assert.equal(
    resolveMobileNavigationFocusAction({ key: "Tab", shiftKey: false, activeIndex: -1, itemCount: 5 }),
    "first",
  );
  assert.equal(
    resolveMobileNavigationFocusAction({ key: "Tab", shiftKey: true, activeIndex: -1, itemCount: 5 }),
    "last",
  );
  assert.equal(
    resolveMobileNavigationFocusAction({ key: "Tab", shiftKey: false, activeIndex: -1, itemCount: 0 }),
    "none",
  );
});

test("mobile navigation is a labelled modal with an owned focus lifecycle", () => {
  assert.match(shellSource, /const mobileNavigationOpen = isNarrowViewport && !sidebarCollapsed/);
  assert.match(shellSource, /role=\{mobileNavigationOpen \? "dialog" : undefined\}/);
  assert.match(shellSource, /aria-modal=\{mobileNavigationOpen \? true : undefined\}/);
  assert.match(shellSource, /aria-label=\{mobileNavigationOpen \? "Weekform navigation" : undefined\}/);
  assert.match(shellSource, /ref=\{mobileNavigationRef\}/);
  assert.match(shellSource, /mobileNavigationCloseRef\.current\?\.focus\(\)/);
  assert.match(shellSource, /sidebarOpenerRef\.current\?\.focus\(\)/);
  assert.match(shellSource, /resolveMobileNavigationFocusAction/);
  assert.equal(
    shellSource.match(/inert=\{mobileNavigationOpen \? true : undefined\}/g)?.length,
    2,
    "both the toolbar and main content must leave the modal interaction surface",
  );
  assert.equal(
    shellSource.match(/aria-hidden=\{mobileNavigationOpen \? true : undefined\}/g)?.length,
    2,
    "both background regions must leave the accessibility tree while the drawer is modal",
  );
  assert.match(shellSource, /onClick=\{closeMobileNavigation\}/);
  assert.match(shellSource, /onKeyDown=\{handleMobileNavigationKeyDown\}/);
  assert.match(shellSource, /pushWorkspaceRoute\(route\);\s*closeMobileNavigation\(\);/);
});

test("the shell exposes a tabpanel only when the active tab exists", () => {
  assert.match(
    shellSource,
    /const activeContextTabId = contextViews\.some\(\(view\) => view\.id === activeSubview\)/,
  );
  assert.match(shellSource, /role=\{activeContextTabId \? "tabpanel" : undefined\}/);
  assert.match(shellSource, /aria-labelledby=\{activeContextTabId\}/);
  assert.doesNotMatch(shellSource, /role="tabpanel"/);
});
