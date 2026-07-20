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

test("Individual Web preserves Desktop sources and marks unavailable Email without browser controls", () => {
  assert.doesNotMatch(
    source,
    /from ["']lucide-react["']/,
    "Web data-source parity must not import a package apps/web does not own",
  );

  for (const sourceName of [
    "Active window activity",
    "Calendar",
    "Email",
    "Chat",
    "Visual context",
  ]) {
    assert.match(source, new RegExp(`title: ["']${sourceName}["']`), `${sourceName} needs a distinct Desktop-parity row`);
  }

  assert.match(source, /DATA_SOURCES\.map\(\(source\) =>/);
  assert.match(source, /<h3>\{source\.title\}<\/h3>/);
  assert.match(source, /<strong>\{source\.statusTitle\}<\/strong>/);
  assert.match(source, /className=\{styles\.localBadge\}>\{source\.badge\}<\/span>/);
  assert.match(source, /Data sources are controlled locally/);
  assert.match(source, /href="\/download"[^>]*>Get Weekform for Mac<\/Link>/, "the download route needs download-accurate CTA copy");
  assert.doesNotMatch(source, /<input|<select|onClick=/, "Web must not expose fake local-source controls");
});

test("Individual Web places native-only Chat directly below the unavailable Email boundary", () => {
  assert.match(
    source,
    /title: ["']Email["'][\s\S]*?icon: ["']email["'],\s*},\s*{\s*title: ["']Chat["']/,
    "The unavailable Email boundary must be followed directly by Chat",
  );

  const chatStart = source.indexOf('title: "Chat"');
  const visualStart = source.indexOf('title: "Visual context"');
  assert.ok(chatStart >= 0 && visualStart > chatStart, "Chat needs a bounded source row before Visual context");
  const chatSource = source.slice(chatStart, visualStart);

  for (const provider of ["Slack", "Google Chat", "Webex"]) {
    assert.match(chatSource, new RegExp(provider), `${provider} must be named in the Chat handoff`);
  }

  assert.doesNotMatch(chatSource, /\b(?:Microsoft )?Teams\b/, "Teams is not one of Weekform's three Chat options");
  assert.match(chatSource, /Mac Settings/, "Web must direct Chat connection to native Mac Settings");
  assert.match(chatSource, /content-free attention evidence/, "Chat must describe the content-free attention model");
  assert.match(chatSource, /message-volume scor(?:e|es|ing)/, "Chat must reject message-volume productivity scoring");
  assert.match(source, /no source OAuth controls/, "Web must not imply that provider OAuth works in the browser");
  assert.match(source, /Neither Web nor Mac requests inbox access/);
  assert.match(source, /localDetail: ["']Not available["']/);
  assert.match(source, /statusTitle: ["']Unavailable["']/);
  assert.match(source, /badge: ["']Unavailable["']/);
  assert.doesNotMatch(source, /manage Email|Email source controls belong in Weekform for Mac/);
});

test("Individual Web data-source rows retain Desktop source-row scale", () => {
  assert.match(styles, /\.row\s*\{[^}]*min-height:\s*78px/s);
  assert.match(styles, /\.icon\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px/s);
  assert.match(styles, /\.copy h3\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*24px/s);
  assert.match(styles, /\.copy p\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*18px/s);
  assert.match(styles, /\.status\s*\{[^}]*text-align:\s*right/s);
  assert.match(styles, /\.status strong\s*\{[^}]*font-size:\s*12px/s);
});
