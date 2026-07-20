import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelSource = readFileSync(
  new URL("../components/settings/ModelPricingPanel.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function cssRule(selector: string) {
  const start = stylesSource.indexOf(`${selector} {`);
  const end = stylesSource.indexOf("}", start);

  assert.ok(start >= 0, `Expected CSS selector: ${selector}`);
  assert.ok(end > start, `Expected CSS rule to close: ${selector}`);
  return stylesSource.slice(start, end + 1);
}

test("model pricing body uses one inset container with a consistent spacing rhythm", () => {
  assert.match(
    panelSource,
    /<div className="model-pricing-content">[\s\S]*?<EmptyState[\s\S]*?className="model-pricing-empty"[\s\S]*?<details className="pricing-sources">[\s\S]*?<\/details>\s*<\/div>\s*<div className="model-pricing-footer">/,
  );

  const contentRule = cssRule(".model-pricing-content");
  assert.match(contentRule, /gap:\s*16px/);
  assert.match(contentRule, /padding:\s*18px 20px 20px/);

  const emptyActionsRule = cssRule(".model-pricing-empty .empty-state-actions");
  assert.match(emptyActionsRule, /display:\s*flex/);
  assert.match(emptyActionsRule, /grid-column:\s*3/);
});
