import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INDIVIDUAL_TOOLBAR_SLOGANS,
  README_TOOLBAR_SLOGANS,
  nextToolbarSloganIndex,
} from "./toolbarSlogans";

const readmeSource = readFileSync(
  new URL("../../../README.md", import.meta.url),
  "utf8",
);

test("the Individual toolbar rotates through the current line and concise README messages", () => {
  assert.deepEqual(INDIVIDUAL_TOOLBAR_SLOGANS, [
    "Your week, ready to take shape",
    "Know what fits before you commit.",
    "The moment before you say yes",
    "Can you take this on next week?",
  ]);
});

test("every added toolbar slogan stays grounded in the public product story", () => {
  for (const slogan of README_TOOLBAR_SLOGANS) {
    assert.ok(readmeSource.includes(slogan), `README is missing toolbar slogan: ${slogan}`);
  }
});

test("toolbar slogan rotation advances deterministically and wraps", () => {
  assert.equal(nextToolbarSloganIndex(0), 1);
  assert.equal(nextToolbarSloganIndex(1), 2);
  assert.equal(nextToolbarSloganIndex(2), 3);
  assert.equal(nextToolbarSloganIndex(3), 0);
});
