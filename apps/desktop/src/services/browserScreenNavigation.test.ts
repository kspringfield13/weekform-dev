import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  browserScreenHistoryDecision,
  browserScreenFromSearch,
  browserUrlForScreen,
} from "./browserScreenNavigation";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("browser screen URLs preserve unrelated query state and fragments", () => {
  assert.equal(
    browserUrlForScreen("http://127.0.0.1:5173/?demo=1&settings=account#sharing", "agent"),
    "http://127.0.0.1:5173/?demo=1&settings=account&screen=agent#sharing",
  );
  assert.equal(browserScreenFromSearch("?demo=1&screen=forecast"), "forecast");
  assert.equal(browserScreenFromSearch("?demo=1&screen=not-a-screen"), null);
});

test("the browser runtime owns screen history while Tauri remains URL-independent", () => {
  assert.match(appSource, /browserScreenHistoryHydrated/);
  assert.match(appSource, /browserScreenHistoryReadyRef/);
  assert.match(appSource, /browserHistoryRestoringRef/);
  assert.match(appSource, /window\.history\.replaceState/);
  assert.match(appSource, /window\.history\.pushState/);
  assert.match(appSource, /window\.addEventListener\("popstate", handleBrowserScreenPopState\)/);
  assert.match(appSource, /if \(isTauriRuntime\) return;/);
});

test("async persistence hydration replaces the final screen without a phantom initial entry", async () => {
  const href = "http://127.0.0.1:5173/";
  const beforeHydration = browserScreenHistoryDecision({
    href,
    active: "weekly",
    hydrated: false,
    initialized: false,
    restoring: false,
  });
  assert.deepEqual(beforeHydration, { kind: "wait" });

  // Persistence resolves after the first render and selects Review from saved,
  // unverified work. The first URL write must replace with that hydrated truth.
  await Promise.resolve();
  const afterHydration = browserScreenHistoryDecision({
    href,
    active: "daily",
    hydrated: true,
    initialized: false,
    restoring: false,
  });
  assert.deepEqual(afterHydration, {
    kind: "replace",
    url: "http://127.0.0.1:5173/?screen=daily",
  });

  const laterNavigation = browserScreenHistoryDecision({
    href: afterHydration.url,
    active: "agent",
    hydrated: true,
    initialized: true,
    restoring: false,
  });
  assert.deepEqual(laterNavigation, {
    kind: "push",
    url: "http://127.0.0.1:5173/?screen=agent",
  });
});
