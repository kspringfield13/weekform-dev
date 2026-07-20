import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/PersonalDataSourcesSettings.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../components/PersonalDataSourcesSettings.module.css", import.meta.url),
  "utf8",
);

test("Individual Web preserves the Desktop data-source hierarchy without browser controls", () => {
  assert.doesNotMatch(
    source,
    /from ["']lucide-react["']/,
    "Web data-source parity must not import a package apps/web does not own",
  );

  for (const sourceName of [
    "Active window activity",
    "Calendar",
    "Workplace chat",
    "Visual context",
  ]) {
    assert.match(source, new RegExp(`title: ["']${sourceName}["']`), `${sourceName} needs a distinct Desktop-parity row`);
  }

  assert.match(source, /DATA_SOURCES\.map\(\(source\) =>/);
  assert.match(source, /<h3>\{source\.title\}<\/h3>/);
  assert.match(source, /<strong>Raw source not shared<\/strong>/);
  assert.match(source, /className=\{styles\.localBadge\}>Mac only<\/span>/, "every mapped source row needs an explicit Mac-only status");
  assert.match(source, /Data sources are controlled locally/);
  assert.match(source, /href="\/download"[^>]*>Get Weekform for Mac<\/Link>/, "the download route needs download-accurate CTA copy");
  assert.doesNotMatch(source, /<input|<select|onClick=/, "Web must not expose fake local-source controls");
});

test("Individual Web data-source rows retain Desktop source-row scale", () => {
  assert.match(styles, /\.row\s*\{[^}]*min-height:\s*78px/s);
  assert.match(styles, /\.icon\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px/s);
  assert.match(styles, /\.copy h3\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*24px/s);
  assert.match(styles, /\.copy p\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*18px/s);
  assert.match(styles, /\.status\s*\{[^}]*text-align:\s*right/s);
  assert.match(styles, /\.status strong\s*\{[^}]*font-size:\s*12px/s);
});
