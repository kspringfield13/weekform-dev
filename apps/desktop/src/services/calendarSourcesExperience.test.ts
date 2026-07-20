import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function cssRule(selector: string) {
  const start = stylesSource.indexOf(`${selector} {`);
  const end = stylesSource.indexOf("}", start);

  assert.ok(start >= 0, `Expected CSS selector: ${selector}`);
  assert.ok(end > start, `Expected CSS rule to close: ${selector}`);
  return stylesSource.slice(start, end + 1);
}

test("calendar disconnect icon is centered within its square button", () => {
  const rule = cssRule(".calendar-provider-actions .icon-button");

  assert.match(rule, /display:\s*inline-grid/);
  assert.match(rule, /place-items:\s*center/);
  assert.match(rule, /padding:\s*0/);
});
