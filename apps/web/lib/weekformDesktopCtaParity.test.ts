import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

const productionRoots = [
  new URL("../app", import.meta.url).pathname,
  new URL("../components", import.meta.url).pathname,
  new URL(".", import.meta.url).pathname,
];
const componentSource = readFileSync(
  new URL("../components/MacAppLink.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

function productionSources(directory: string): Array<{ path: string; source: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    if (![".ts", ".tsx"].includes(extname(entry.name)) || entry.name.endsWith(".test.ts")) return [];
    return [{ path, source: readFileSync(path, "utf8") }];
  });
}

test("Mac acquisition CTAs share the Weekform mark and Weekform Desktop (Mac) label", () => {
  assert.match(componentSource, /export function WeekformDesktopLink/);
  assert.match(componentSource, /<WeekformMark className="weekform-desktop-cta-mark"\s*\/>/);
  assert.match(componentSource, /Weekform Desktop \(Mac\)/);
  assert.match(stylesSource, /\.weekform-desktop-cta-mark\s*\{/);
});

test("no Web page retains the legacy Get Weekform for Mac CTA", () => {
  const legacySources = productionRoots.flatMap(productionSources)
    .filter(({ source }) => source.includes("Get Weekform for Mac"))
    .map(({ path }) => path);

  assert.deepEqual(legacySources, []);
});
