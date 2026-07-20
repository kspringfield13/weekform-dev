import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesSource.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1] ?? "";
}

test("the authenticated Individual shell uses the current Desktop light token contract", () => {
  const app = rule(".web-individual-app.app");

  assert.match(app, /color-scheme:\s*light\s*;/);
  assert.match(app, /--background:\s*#ffffff\s*;/);
  assert.match(app, /--background-subtle:\s*#fafafa\s*;/);
  assert.match(app, /--border:\s*#00000014\s*;/);
  assert.match(app, /--text:\s*#171717\s*;/);
  assert.match(app, /--radius:\s*6px\s*;/);
  assert.match(app, /grid-template-columns:\s*224px\s+minmax\(0,\s*1fr\)\s*;/);
  assert.doesNotMatch(app, /color-scheme:\s*dark|--background:\s*#111210|236px/);
});

test("the authenticated sidebar matches the current Desktop hierarchy and geometry", () => {
  const sidebar = rule(".web-individual-app > .sidebar");
  const brand = rule(".web-individual-app .brand");
  const navItem = rule(".web-individual-app .nav-item");

  assert.match(sidebar, /gap:\s*16px\s*;/);
  assert.match(sidebar, /padding:\s*20px\s+12px\s+12px\s*;/);
  assert.match(sidebar, /background:\s*var\(--background-subtle\)\s*;/);
  assert.match(brand, /flex-direction:\s*column\s*;/);
  assert.match(brand, /min-height:\s*82px\s*;/);
  assert.match(navItem, /min-height:\s*48px\s*;/);
  assert.match(navItem, /border-radius:\s*var\(--radius\)\s*;/);
});

test("collapsing the sidebar also collapses the toolbar sidebar column", () => {
  const toolbar = rule(".web-individual-app.sidebar-collapsed .web-app-toolbar");

  assert.match(
    toolbar,
    /grid-template-columns:\s*0\s+minmax\(180px,\s*1fr\)\s+auto\s*;/,
  );
});

test("context tabs and page content use the current Desktop strip and content frame", () => {
  const contextFrame = rule(".web-individual-app .page-context-navigation");
  const contextTabs = rule(".web-individual-app .context-navigation");
  const contextButton = rule(".web-individual-app .context-navigation button");
  const screen = rule(".web-desktop-screen");

  assert.match(contextFrame, /padding:\s*16px\s+16px\s+0\s*;/);
  assert.doesNotMatch(contextFrame, /min-height:\s*52px|position:\s*sticky/);
  assert.match(contextTabs, /min-height:\s*32px\s*;/);
  assert.match(contextTabs, /border-radius:\s*10px\s*;/);
  assert.match(contextTabs, /background:\s*var\(--surface-muted\)\s*;/);
  assert.match(contextButton, /min-height:\s*26px\s*;/);
  assert.match(contextButton, /font-size:\s*12px\s*;/);
  assert.match(screen, /width:\s*min\(100%,\s*1200px\)\s*;/);
  assert.match(screen, /margin:\s*0\s+auto\s*;/);
  assert.match(screen, /padding:\s*24px\s+32px\s+32px\s*;/);
});

test("the compact Web surface owns the viewport and keeps controls touch-ready", () => {
  const compactShell = rule(".web-compact-shell");

  assert.match(compactShell, /height:\s*100dvh\s*;/);
  assert.match(compactShell, /overflow:\s*hidden\s*;/);
  assert.match(
    stylesSource,
    /\.web-compact-action\s*\{[^}]*min-height:\s*40px\s*;[^}]*cursor:\s*pointer\s*;/,
  );
});

test("the full Web shell becomes a single-column overlay layout before it can squeeze", () => {
  assert.match(
    stylesSource,
    /@media\s*\(max-width:\s*820px\)[\s\S]*?\.web-individual-app\.app\s*\{[^}]*grid-template-columns:\s*0\s+minmax\(0,\s*1fr\)/,
  );
  assert.match(
    stylesSource,
    /@media\s*\(max-width:\s*820px\)[\s\S]*?\.web-individual-app\s*>\s*\.sidebar\s*\{[^}]*position:\s*fixed/,
  );
  assert.match(
    stylesSource,
    /@media\s*\(max-width:\s*820px\)[\s\S]*?\.web-sidebar-toggle\s*\{[^}]*display:\s*grid/,
    "the overlay navigation must retain a visible keyboard-accessible open control below the older 760px rail breakpoint",
  );
});
