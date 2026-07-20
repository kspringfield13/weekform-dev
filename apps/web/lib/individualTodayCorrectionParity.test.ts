import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopBlockSource = readFileSync(
  new URL("../../desktop/src/components/ledger/BlockCard.tsx", import.meta.url),
  "utf8",
);
const webTodaySource = readFileSync(
  new URL("../components/PersonalTodayScreen.tsx", import.meta.url),
  "utf8",
);
const webActionsSource = readFileSync(
  new URL("../app/dashboard/personalActions.ts", import.meta.url),
  "utf8",
);
const reviewContractSource = readFileSync(
  new URL("./personalReplica.ts", import.meta.url),
  "utf8",
);

test("Today correction contract already accepts Desktop's three classification fields", () => {
  assert.match(reviewContractSource, /\["category",\s*"mode",\s*"plannedStatus",\s*"blockerFlag"\]/);
  for (const label of ["Work category", "Planned status", "Work mode"]) {
    assert.match(desktopBlockSource, new RegExp(`>${label}<`));
  }
});

test("Individual Web Today exposes all Desktop classification correction fields", () => {
  assert.match(webTodaySource, /name=["']category["']/);
  assert.match(
    webTodaySource,
    /name=["']planned_status["'][\s\S]*?defaultValue=\{block\.plannedStatus\}/,
    "Web Today must let an Individual correct Planned status, not merely display it",
  );
  assert.match(
    webTodaySource,
    /name=["']mode["'][\s\S]*?defaultValue=\{block\.mode\}/,
    "Web Today must let an Individual correct Work mode, not merely display it",
  );
});

test("Today server action forwards all submitted corrections through the validated patch", () => {
  const relabelPatch = /const patch = action === "relabel"([\s\S]*?): undefined;/.exec(webActionsSource)?.[1] ?? "";

  assert.match(relabelPatch, /category:\s*text\(formData,\s*"category"\)/);
  assert.match(
    relabelPatch,
    /plannedStatus:\s*text\(formData,\s*"planned_status"\)/,
    "the accepted plannedStatus field must not be dropped before reviewCommandInput validates the request",
  );
  assert.match(
    relabelPatch,
    /mode:\s*text\(formData,\s*"mode"\)/,
    "the accepted mode field must not be dropped before reviewCommandInput validates the request",
  );
  assert.match(webActionsSource, /p_patch:\s*input\.patch/);
});
