import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surfaces = [
  {
    label: "Data Sources",
    component: "../components/PersonalDataSourcesSettings.tsx",
    styles: "../components/PersonalDataSourcesSettings.module.css",
  },
  {
    label: "Data Control",
    component: "../components/PersonalWebDataControl.tsx",
    styles: "../components/PersonalWebDataControl.module.css",
  },
  {
    label: "AI Assistance",
    component: "../components/PersonalAIAssistanceSettings.tsx",
    styles: "../components/PersonalAISettings.module.css",
  },
  {
    label: "AI Usage",
    component: "../components/PersonalAIUsageSettings.tsx",
    styles: "../components/PersonalAISettings.module.css",
  },
  {
    label: "Notifications",
    component: "../components/PersonalNotificationsSettings.tsx",
    styles: "../components/PersonalNotificationsSettings.module.css",
  },
] as const;

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Settings keeps the stable Desktop header and all six routed boundaries", () => {
  const shell = source("../components/IndividualHistorySettings.tsx");

  assert.match(
    shell,
    /const\s+isAccountSettings\s*=\s*tab\s*===\s*["']account["']/,
    "the header distinction should follow Desktop's account versus privacy grouping",
  );
  assert.match(shell, /isAccountSettings\s*\?\s*["']Account & sharing["']\s*:\s*["']Privacy and data sources["']/);
  assert.doesNotMatch(
    shell,
    /<h1[^>]*>\{selectedLabel\}<\/h1>/,
    "switching a tab should not replace Desktop's stable Settings page title",
  );

  for (const id of ["data-sources", "data-control", "ai-assistance", "ai-usage", "notifications", "account"]) {
    const property = id.includes("-") ? `["']${id}["']` : `(?:["']${id}["']|${id})`;
    assert.match(shell, new RegExp(`${property}\\s*:`), `${id} should remain in the six-tab allowlist`);
  }
  assert.match(shell, /SETTINGS_TABS\.map\(\(item\)\s*=>\s*\([\s\S]*?role="tabpanel"/);
  assert.match(shell, /item\.id\s*===\s*["']data-control["']\s*\?\s*dataControl/);
  assert.match(shell, /item\.id\s*===\s*["']account["'][\s\S]*?accountAndSharing/);
  assert.match(shell, /buildIndividualSettingsUrl/);
  assert.match(shell, /window\.addEventListener\(["']popstate["']/);
  assert.match(shell, /aria-selected=\{tab\s*===\s*item\.id\}/);
  assert.match(shell, /tabIndex=\{tab\s*===\s*item\.id\s*\?\s*0\s*:\s*-1\}/);
});

test("each informational Settings tab ends with a non-interactive ownership note", () => {
  const sharedControl = source("../components/PersonalSettingsLocalControl.tsx");
  assert.match(sharedControl, /export function SettingsBoundaryNote/);
  assert.doesNotMatch(sharedControl, /<Link\b|aria-disabled="true"|className="button/);

  for (const surface of surfaces) {
    const component = source(surface.component);
    assert.equal(
      Array.from(component.matchAll(/<SettingsBoundaryNote\b/g)).length,
      1,
      `${surface.label} should expose one ownership note after its rows`,
    );
    assert.match(
      component,
      /<SettingsBoundaryNote\b/,
      `${surface.label} should reserve one terminal boundary-note region`,
    );

    const rowsStart = component.indexOf(`className={styles.rows}`);
    const handoffStart = component.lastIndexOf(`<SettingsBoundaryNote`);
    assert.ok(rowsStart >= 0, `${surface.label} should retain its Desktop-shaped row list`);
    assert.ok(handoffStart > rowsStart, `${surface.label} handoff should follow the row list`);
    assert.doesNotMatch(
      component.slice(rowsStart, handoffStart),
      /<Link\b[^>]*href=["']\/download["']|<LocalSettingsControl\b/,
      `${surface.label} should not show acquisition links or disabled faux controls`,
    );
  }
});

test("Settings information rows retain Desktop icon, copy, and status geometry", () => {
  for (const surface of surfaces) {
    const styles = source(surface.styles);
    const rowRule = styles.match(/\.row\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    assert.match(
      rowRule,
      /grid-template-columns:\s*34px\s+minmax\([^)]*\)\s+minmax\([^)]*\)(?:\s+auto)?\s*;/,
      `${surface.label} should keep the icon, copy, and status silhouette, with an action column only where needed`,
    );
    assert.match(rowRule, /min-height:\s*80px\s*;/, `${surface.label} should use Desktop's exact 80px row height`);
    assert.match(rowRule, /padding:\s*12px\s+8px\s*;/, `${surface.label} should use Desktop's exact row inset`);
    assert.match(rowRule, /align-items:\s*center\s*;/);
    assert.match(styles, /\.icon\s*\{[\s\S]*?width:\s*34px;[\s\S]*?height:\s*34px;/);
    assert.match(styles, /\.copy p\s*\{[\s\S]*?font-size:\s*13px;[\s\S]*?line-height:\s*18px;/);
    assert.match(styles, /\.status\s*\{[\s\S]*?text-align:\s*right\s*;/);
    assert.match(styles, /\.status span[\s\S]*?font-size:\s*11px;/);
  }
});

test("Settings rows and boundary notes collapse without horizontal clipping", () => {
  const sharedStyles = source("../components/PersonalSettingsLocalControl.module.css");
  assert.match(
    sharedStyles,
    /\.handoff\s*\{[\s\S]*?grid-template-columns:\s*7px\s+minmax\(0,\s*1fr\)\s*;/,
    "the shared boundary note should keep a bounded marker and fluid copy column",
  );

  for (const surface of surfaces) {
    const styles = source(surface.styles);
    assert.match(
      styles,
      /@media\s*\(max-width:\s*(?:8\d\d|9[0-2]\d)px\)[\s\S]*?\.row\s*\{[\s\S]*?grid-template-columns:\s*34px\s+minmax\(0,\s*1fr\)\s+auto\s*;/,
      `${surface.label} should collapse the wide row before the minimum desktop viewport clips`,
    );
    assert.match(
      styles,
      /@media\s*\(max-width:\s*6[0-2]\dpx\)[\s\S]*?\.row\s*\{[\s\S]*?grid-template-columns:\s*34px\s+minmax\(0,\s*1fr\)\s*;/,
      `${surface.label} should use the Desktop icon/copy pair on the narrowest layout`,
    );
  }
});
