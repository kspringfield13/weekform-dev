import assert from "node:assert/strict";
import test from "node:test";

import {
  getCompactWebWindowFeatures,
  getCompactWebHandoffUrl,
  getCompactWebWindowPlacement,
  getCompactWebWindowUrl,
  getFullWebWindowUrl,
  getInitialWindowMode,
} from "./webWindowMode";

test("compact browser placement matches the 620 by 850 physical-pixel reference on a Retina display", () => {
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
    "popup=yes,width=310,height=425,left=1602,top=22"
  );
});

test("compact browser placement uses the active screen origin and native physical geometry at 1x", () => {
  const placement = getCompactWebWindowPlacement({
    screen: { availLeft: -1920, availTop: 0, availWidth: 1920, availHeight: 1080 },
    devicePixelRatio: 1,
  });

  assert.deepEqual(placement, {
    width: 620,
    height: 850,
    left: -636,
    top: 44,
  });
});

test("compact browser URL preserves the current route context and marks the auxiliary window", () => {
  assert.equal(
    getCompactWebWindowUrl("http://127.0.0.1:5173/?demo=1&screen=weekly#capacity"),
    "http://127.0.0.1:5173/?demo=1&screen=weekly&mode=compact&popup=1#capacity"
  );
});

test("browser handoff leaves one inert host and restores the requested full-app screen", () => {
  assert.equal(
    getCompactWebHandoffUrl("http://127.0.0.1:5173/?screen=weekly"),
    "http://127.0.0.1:5173/?screen=weekly&window=compact-host"
  );
  assert.equal(
    getCompactWebWindowUrl("http://127.0.0.1:5173/?screen=weekly&window=compact-host"),
    "http://127.0.0.1:5173/?screen=weekly&mode=compact&popup=1"
  );
  assert.equal(
    getFullWebWindowUrl(
      "http://127.0.0.1:5173/?screen=weekly&mode=compact&popup=1",
      "setup"
    ),
    "http://127.0.0.1:5173/?screen=setup"
  );
});

test("compact mode deep links initialize only in web or explicit demo runtimes", () => {
  assert.equal(
    getInitialWindowMode({ search: "?mode=compact&popup=1", isTauriRuntime: false }),
    "compact"
  );
  assert.equal(
    getInitialWindowMode({ search: "?mode=compact", isTauriRuntime: true }),
    "large"
  );
  assert.equal(
    getInitialWindowMode({ search: "?demo=1&mode=compact", isTauriRuntime: true }),
    "compact"
  );
});
