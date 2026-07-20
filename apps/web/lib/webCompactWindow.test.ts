import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompactWebWindowUrl,
  buildFullWebWindowUrl,
  buildWebWindowHandoffUrl,
  getCompactWebWindowFeatures,
  getCompactWebWindowPlacement,
  resolveWebWindowSurface,
} from "./webCompactWindow";

test("compact Web geometry follows the Desktop widget on a Retina display", () => {
  const placement = getCompactWebWindowPlacement({
    screen: { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1055 },
    devicePixelRatio: 2,
  });

  assert.deepEqual(placement, {
    width: 310,
    height: 425,
    left: 1602,
    top: 22,
  });
  assert.equal(
    getCompactWebWindowFeatures(placement),
    "popup=yes,resizable=yes,scrollbars=no,width=310,height=425,left=1602,top=22",
  );
});

test("compact Web geometry preserves active-screen origin at 1x", () => {
  assert.deepEqual(
    getCompactWebWindowPlacement({
      screen: { availLeft: -1920, availTop: 0, availWidth: 1920, availHeight: 1080 },
      devicePixelRatio: 1,
    }),
    {
      width: 620,
      height: 850,
      left: -636,
      top: 44,
    },
  );
});

test("compact, handoff, and restored URLs preserve the current Web route", () => {
  const current = "https://weekform.dev/app?screen=forecast&settings_tab=ai-usage#trajectory";

  assert.equal(
    buildCompactWebWindowUrl(current),
    "https://weekform.dev/app?screen=forecast&settings_tab=ai-usage&mode=compact&popup=1#trajectory",
  );
  assert.equal(
    buildWebWindowHandoffUrl(current),
    "https://weekform.dev/app?screen=forecast&settings_tab=ai-usage&window=compact-host#trajectory",
  );
  assert.equal(
    buildFullWebWindowUrl(buildCompactWebWindowUrl(current), "daily"),
    "https://weekform.dev/app?screen=daily&settings_tab=ai-usage#trajectory",
  );
});

test("only an explicitly marked popup renders the compact Web surface", () => {
  assert.equal(resolveWebWindowSurface("?screen=weekly"), "full");
  assert.equal(resolveWebWindowSurface("?mode=compact"), "full");
  assert.equal(resolveWebWindowSurface("?mode=compact&popup=1"), "compact");
  assert.equal(resolveWebWindowSurface("?window=compact-host"), "handoff");
});
