import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Individual Account & Sharing uses Desktop settings-row density instead of marketing cards", () => {
  const dashboard = source("../app/dashboard/page.tsx");
  const styles = source("../app/globals.css");
  const accountStart = dashboard.indexOf("accountAndSharing={(\n");
  const accountEnd = dashboard.indexOf("        )} />", accountStart);

  assert.ok(accountStart >= 0 && accountEnd > accountStart, "the Account & Sharing projection should remain inspectable");
  const accountSurface = dashboard.slice(accountStart, accountEnd);

  assert.match(
    accountSurface,
    /className=["'][^"']*settings-row[^"']*["']/,
    "Account & Sharing should present its account and team operations as compact Desktop-shaped settings rows",
  );
  assert.doesNotMatch(
    accountSurface,
    /className=["'][^"']*(?:card-grid|choice-card)[^"']*["']/,
    "Account & Sharing should not retain the public-site marketing card composition inside the Individual app",
  );
  assert.match(
    styles,
    /\.individual-account-sharing[^{]*\{[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*12px;/,
    "the Account & Sharing row stack should use Desktop's compact 12px rhythm",
  );
  assert.match(
    styles,
    /\.individual-account-sharing[^}]*\.settings-row\s*\{[\s\S]*?grid-template-columns:\s*34px\s+minmax\(0,\s*1fr\)\s+minmax\([^)]*\)\s+auto\s*;/,
    "wide Account & Sharing rows should retain Desktop's icon, copy, status, and control silhouette",
  );
  assert.match(
    styles,
    /\.individual-account-sharing\s+\.account-sharing-operation-row\s*\{[\s\S]*?grid-template-columns:\s*34px\s+minmax\(0,\s*1fr\)\s+minmax\([^)]*\)\s+auto\s*;/,
    "operation rows must not override the four-child Desktop grid with a colliding three-column layout",
  );
  assert.match(
    styles,
    /\.individual-account-sharing\s+\.workspace-section\s*\{[^}]*padding-top:\s*0\s*;/,
    "Shared Workload must not retain the public marketing section's 52px top gap",
  );
  assert.match(
    styles,
    /\.individual-account-sharing\s+\.workspace-section-heading\s+h2\s*\{[^}]*font-size:\s*14px\s*;/,
    "Shared Workload should use the compact Desktop row title scale",
  );
  assert.match(
    accountSurface,
    /<h2\s+id=["']teams-title["']>Teams<\/h2>/,
    "the always-rendered Teams heading must own the section label in success, empty, and error states",
  );
});
