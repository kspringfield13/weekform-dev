import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const settingsSource = readFileSync(
  new URL("../components/IndividualHistorySettings.tsx", import.meta.url),
  "utf8",
);
const notificationsUrl = new URL(
  "../components/PersonalNotificationsSettings.tsx",
  import.meta.url,
);
const notificationsStylesUrl = new URL(
  "../components/PersonalNotificationsSettings.module.css",
  import.meta.url,
);

function notificationsSource(): string {
  return existsSync(notificationsUrl)
    ? readFileSync(notificationsUrl, "utf8")
    : "";
}

test("Settings Notifications mounts a dedicated Desktop-shaped Web panel", () => {
  assert.equal(
    existsSync(notificationsUrl),
    true,
    "Notifications needs a dedicated parity component instead of a generic Mac boundary paragraph",
  );
  assert.match(settingsSource, /import \{ PersonalNotificationsSettings \}/);
  assert.match(
    settingsSource,
    /item\.id === "notifications" \? <PersonalNotificationsSettings \/>/,
  );
});

test("Notifications preserves Desktop alert hierarchy and truthful delivery status", () => {
  const source = notificationsSource();

  for (const landmark of [
    "Notifications",
    "Proactive alerts",
    "Capacity guardrail",
    "End-of-day review nudge",
    "Heavy-day-ahead warning",
    "Fragmentation nudge",
    "Weekly summary ready",
  ]) {
    assert.match(source, new RegExp(landmark));
  }

  assert.match(source, /capped at 4 per day/i);
  assert.match(source, /never window titles or app names/i);
  assert.match(source, /Mac only/);
  assert.match(source, /Get Weekform for Mac/);
  assert.doesNotMatch(source, /Open on Mac/);
  assert.match(source, /aria-labelledby=/);
});

test("Web Notifications does not invent browser-owned alert state", () => {
  const source = notificationsSource();

  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|indexedDB|Notification\.requestPermission|navigator\.serviceWorker|fetch\(|createClient\(/,
  );
  assert.doesNotMatch(source, /aria-pressed|<select|<input/);
});

test("Notifications keeps the Desktop row grid responsive on Web", () => {
  assert.equal(
    existsSync(notificationsStylesUrl),
    true,
    "Notifications parity needs a scoped stylesheet",
  );
  const source = existsSync(notificationsStylesUrl)
    ? readFileSync(notificationsStylesUrl, "utf8")
    : "";

  assert.match(source, /grid-template-columns:\s*34px minmax\(220px, 1fr\) minmax\(130px, 0\.36fr\) auto/);
  assert.match(source, /@media \(max-width: 920px\)[\s\S]*grid-template-columns:\s*34px minmax\(0, 1fr\) auto/);
  assert.match(source, /@media \(max-width: 620px\)[\s\S]*grid-template-columns:\s*34px minmax\(0, 1fr\)/);
});
