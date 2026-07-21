import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  WEB_THEME_STORAGE_KEY,
  nextWebTheme,
  resolveWebTheme,
} from "./webTheme";

const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../components/SiteHeader.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url), "utf8");
const toggle = readFileSync(new URL("../components/ThemeToggle.tsx", import.meta.url), "utf8");

test("the Web theme follows a saved choice and otherwise defaults to dark", () => {
  assert.equal(resolveWebTheme("dark"), "dark");
  assert.equal(resolveWebTheme("light"), "light");
  assert.equal(resolveWebTheme("unknown"), "dark");
  assert.equal(resolveWebTheme(null), "dark");
  assert.equal(nextWebTheme("light"), "dark");
  assert.equal(nextWebTheme("dark"), "light");
});

test("the root layout starts dark and applies a saved override before the page paints", () => {
  assert.equal(WEB_THEME_STORAGE_KEY, "weekform:web-theme");
  assert.match(layout, /<html[^>]*data-theme="dark"/);
  assert.match(layout, /<head>[\s\S]*dangerouslySetInnerHTML/);
  assert.match(layout, /nonce=\{nonce\}/);
  assert.match(
    layout,
    /<script[^>]*nonce=\{nonce\}[^>]*suppressHydrationWarning/,
    "the browser-hidden nonce needs a script-local hydration boundary",
  );
  assert.match(layout, /headers\(\)/);
  assert.match(layout, /weekform:web-theme/);
  assert.match(layout, /<html[^>]*data-scroll-behavior="smooth"/);
  assert.doesNotMatch(layout + toggle, /prefers-color-scheme/);
  assert.match(layout, /suppressHydrationWarning/);
});

test("public and authenticated Web chrome both expose the shared theme toggle", () => {
  assert.match(header, /<ThemeToggle/);
  assert.match(workspace, /<ThemeToggle/);
});

test("the site header places the theme toggle after the account action", () => {
  const signOutPosition = header.indexOf("Sign out");
  const themeTogglePosition = header.indexOf(
    '<ThemeToggle className="site-theme-toggle" />',
  );

  assert.ok(signOutPosition >= 0, "the signed-in header must expose Sign out");
  assert.ok(themeTogglePosition >= 0, "the site header must expose the theme toggle");
  assert.ok(
    themeTogglePosition > signOutPosition,
    "the theme toggle must be the rightmost signed-in control, after Sign out",
  );
});

test("the authenticated Web header presents theme as its only display control", () => {
  assert.match(toggle, /showLabel\s*=\s*false/);
  assert.match(toggle, /theme-toggle-label/);
  assert.match(
    workspace,
    /className="web-toolbar-display-controls"[\s\S]*role="group"[\s\S]*aria-label="Display controls"/,
  );
  assert.match(workspace, /<ThemeToggle[^>]*showLabel/);
  assert.doesNotMatch(workspace, /<span>Compact<\/span>|Open compact Web window/);
  assert.match(globals, /\.web-toolbar-display-controls\s*\{/);
});

test("explicit theme selectors cover the public and authenticated surfaces", () => {
  assert.match(globals, /:root\[data-theme="dark"\]\s*\{/);
  assert.match(globals, /:root\[data-theme="dark"\]\s+\.web-individual-app\.app\s*\{/);
  assert.doesNotMatch(globals, /\.web-compact-shell/);
  assert.doesNotMatch(
    globals,
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{/,
    "an OS media query must not override an explicit light selection",
  );
});
