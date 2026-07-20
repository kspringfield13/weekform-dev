import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_DIRS = ["app", "components", "lib"];
const ALLOWED_PREFERENCE_STORAGE = new Set([
  "app/layout.tsx",
  "components/ThemeToggle.tsx",
  "components/WebWorkspaceIntro.tsx",
]);

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(absolute);
    if (!/\.(?:ts|tsx)$/.test(entry.name) || entry.name.endsWith(".test.ts")) return [];
    return [absolute];
  });
}

test("production web source has no browser workload persistence", () => {
  const forbidden = [
    /\bsessionStorage\b/,
    /\bindexedDB\b/i,
  ];
  const violations: string[] = [];

  for (const relativeDir of PRODUCTION_DIRS) {
    for (const file of productionSources(path.join(WEB_ROOT, relativeDir))) {
      const source = readFileSync(file, "utf8");
      const relativePath = path.relative(WEB_ROOT, file);
      if (/\blocalStorage\b/.test(source) && !ALLOWED_PREFERENCE_STORAGE.has(relativePath)) {
        violations.push(`${relativePath} uses localStorage outside the appearance and onboarding preferences`);
      }
      for (const pattern of forbidden) {
        if (pattern.test(source)) {
          violations.push(`${relativePath} matches ${pattern}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);

  const onboarding = readFileSync(
    path.join(WEB_ROOT, "components/WebWorkspaceIntro.tsx"),
    "utf8",
  );
  assert.match(onboarding, /localStorage\.getItem\(storageKey\)/);
  assert.match(onboarding, /localStorage\.setItem\(storageKey, "complete"\)/);
  assert.doesNotMatch(onboarding, /JSON\.stringify|payload|snapshot|replica/i);

  const layout = readFileSync(path.join(WEB_ROOT, "app/layout.tsx"), "utf8");
  const themeToggle = readFileSync(path.join(WEB_ROOT, "components/ThemeToggle.tsx"), "utf8");
  assert.match(layout, /storageKey = "weekform:web-theme"/);
  assert.match(layout, /localStorage\.getItem\(storageKey\)/);
  assert.match(themeToggle, /localStorage\.getItem\(WEB_THEME_STORAGE_KEY\)/);
  assert.match(themeToggle, /localStorage\.setItem\(WEB_THEME_STORAGE_KEY, targetTheme\)/);
  assert.doesNotMatch(layout + themeToggle, /JSON\.stringify/);
});

test("client components can use only the ephemeral Realtime client, never server workload modules", () => {
  const forbiddenClientImports = [
    /from\s+["']@\/lib\/(?:actions|profile|snapshots|teams)["']/,
  ];
  const violations: string[] = [];

  for (const relativeDir of PRODUCTION_DIRS) {
    for (const file of productionSources(path.join(WEB_ROOT, relativeDir))) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use client["'];/m.test(source)) continue;

      for (const pattern of forbiddenClientImports) {
        if (pattern.test(source)) {
          violations.push(`${path.relative(WEB_ROOT, file)} matches ${pattern}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
  const realtime = readFileSync(path.join(WEB_ROOT, "components/PersonalReplicaRealtime.tsx"), "utf8");
  assert.match(realtime, /@\/lib\/supabase\/browser/);
  assert.doesNotMatch(realtime, /localStorage|sessionStorage|indexedDB/i);
});

test("request-fresh coordinator is mounted on both authenticated workload surfaces", () => {
  for (const relativePath of ["app/dashboard/page.tsx", "app/teams/[teamId]/page.tsx"]) {
    const source = readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
    assert.match(source, /<RequestFreshnessRefresh\s*\/>/, `${relativePath} must mount refresh`);
    assert.match(source, /export const dynamic = "force-dynamic"/, `${relativePath} must opt out of caching`);
  }
});
