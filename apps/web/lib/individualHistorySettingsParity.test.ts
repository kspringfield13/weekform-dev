import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const componentUrl = new URL(
  "../components/IndividualHistorySettings.tsx",
  import.meta.url,
);

test("Individual History preserves the desktop Activity and Audit destinations", () => {
  assert.equal(existsSync(componentUrl), true);
  const source = existsSync(componentUrl) ? readFileSync(componentUrl, "utf8") : "";

  assert.match(source, /Activity ledger/);
  assert.match(source, /Audit log/);
  assert.match(source, /Explainable review-safe work blocks/);
  assert.match(source, /Review-safe sync receipts/);
});

test("Web Settings mirrors desktop sections without exposing local-only controls", () => {
  const source = existsSync(componentUrl) ? readFileSync(componentUrl, "utf8") : "";

  for (const section of [
    "Data Sources",
    "Data Control",
    "AI Assistance",
    "AI Usage",
    "Notifications",
    "Account & Sharing",
  ]) {
    assert.match(source, new RegExp(section.replace("&", "&(?:amp;)?")));
  }

  assert.match(source, /Raw activity stays on your Mac/);
  assert.match(source, /Get Weekform for Mac/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /aria-controls=/);
  assert.match(source, /tabIndex=/);
  assert.match(source, /onKeyDown=/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|createClient\(/);
});

test("Individual Settings Mac handoffs use the installed-app launcher", () => {
  const source = existsSync(componentUrl) ? readFileSync(componentUrl, "utf8") : "";
  const downloadLabels = Array.from(
    source.matchAll(/<MacAppLink\b[^>]*>([\s\S]*?)<\/MacAppLink>/g),
    (match) => (match[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );

  assert.ok(downloadLabels.length > 0, "Settings must retain a visible Mac acquisition path");
  assert.deepEqual(
    downloadLabels,
    downloadLabels.map(() => "Get Weekform for Mac"),
    "every settings handoff should open an installed app before falling back to acquisition",
  );
});
