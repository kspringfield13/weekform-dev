import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const websiteSources = [
  "../app/globals.css",
  "../app/page.tsx",
  "../app/manager-access/page.tsx",
  "../components/SiteHeader.tsx",
].map((path) => ({
  path,
  source: readFileSync(new URL(path, import.meta.url), "utf8"),
}));

function hueForRgb(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };

  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r
    ? 60 * (((g - b) / delta) % 6)
    : max === g
      ? 60 * ((b - r) / delta + 2)
      : 60 * ((r - g) / delta + 4);

  return { hue: hue < 0 ? hue + 360 : hue, saturation };
}

function explicitPurpleColors(source: string) {
  const colors: string[] = [];
  const hexMatches = source.matchAll(/#([\da-f]{6})(?:[\da-f]{2})?\b/gi);
  for (const match of hexMatches) {
    const value = match[1]!;
    const { hue, saturation } = hueForRgb(
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    );
    if (hue >= 245 && hue <= 315 && saturation >= 0.12) colors.push(match[0]);
  }

  const rgbMatches = source.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi);
  for (const match of rgbMatches) {
    const { hue, saturation } = hueForRgb(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
    if (hue >= 245 && hue <= 315 && saturation >= 0.12) colors.push(match[0]);
  }

  return [...new Set(colors)];
}

function explicitSaturatedColors(source: string) {
  const colors: string[] = [];
  const hexMatches = source.matchAll(/#([\da-f]{6})(?:[\da-f]{2})?\b/gi);
  for (const match of hexMatches) {
    const value = match[1]!;
    if (hueForRgb(
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ).saturation >= 0.25) colors.push(match[0]);
  }

  const rgbMatches = source.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi);
  for (const match of rgbMatches) {
    if (hueForRgb(Number(match[1]), Number(match[2]), Number(match[3])).saturation >= 0.25) {
      colors.push(match[0]);
    }
  }

  return [...new Set(colors)];
}

test("the public website contains no purple palette tokens or explicit purple colors", () => {
  for (const { path, source } of websiteSources) {
    assert.doesNotMatch(source, /(?:purple|violet|lavender)/i, `${path} names a purple palette token`);
    assert.deepEqual(explicitPurpleColors(source), [], `${path} contains an explicit purple color`);
  }
});

test("Manager Access is part of the monochrome Weekform web shell", () => {
  const source = websiteSources.find(({ path }) => path.endsWith("manager-access/page.tsx"))?.source ?? "";

  assert.match(source, /<SiteHeader \/>/);
  assert.match(source, /<SiteFooter \/>/);
  assert.doesNotMatch(source, /AdminPortal|admin portal|data-accent|ACCENT_OPTIONS/i);
  assert.deepEqual(explicitSaturatedColors(source), [], "Manager Access contains a saturated color");
});
