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

test("Individual Web explains implemented evidence sources without presenting Email as a control", () => {
  assert.doesNotMatch(
    source,
    /from ["']lucide-react["']/,
    "Web data-source parity must not import a package apps/web does not own",
  );

  for (const sourceName of [
    "Active window activity",
    "Calendar",
    "Chat",
    "Visual context",
  ]) {
    assert.match(source, new RegExp(`title: ["']${sourceName}["']`), `${sourceName} needs a distinct Desktop-parity row`);
  }

  assert.match(source, /DATA_SOURCES\.map\(\(source\) =>/);
  assert.match(source, /<h3>\{source\.title\}<\/h3>/);
  assert.match(source, /<strong>\{source\.statusTitle\}<\/strong>/);
  assert.match(source, /Web receives a derived weekly replica, not source records/);
  assert.match(source, /<SettingsBoundaryNote/);
  assert.doesNotMatch(source, /LocalSettingsControl|LocalSettingsHandoff|Get Weekform for Mac/);
  assert.doesNotMatch(source, /title: ["']Email["']/);
  assert.doesNotMatch(source, /<input|<select|onClick=/, "Web must not expose fake local-source controls");
});

test("Individual Web describes Chat and the non-collection of email content accurately", () => {
  assert.match(
    source,
    /title: ["']Calendar["'][\s\S]*?icon: ["']calendar["'],\s*},\s*{\s*title: ["']Chat["']/,
    "Chat should follow the implemented Calendar source",
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
  assert.match(source, /Email message content is not collected/);
  assert.match(source, /does not request inbox access or import email bodies, attachments, or message content/);
  assert.doesNotMatch(source, /localDetail: ["']Not available["']|statusTitle: ["']Unavailable["']/);
});

test("Individual Web data-source rows retain Desktop source-row scale", () => {
  assert.match(styles, /\.row\s*\{[^}]*min-height:\s*80px/s);
  assert.match(styles, /\.icon\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px/s);
  assert.match(styles, /\.copy h3\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*24px/s);
  assert.match(styles, /\.copy p\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*18px/s);
  assert.match(styles, /\.status\s*\{[^}]*text-align:\s*right/s);
  assert.match(styles, /\.status strong\s*\{[^}]*font-size:\s*12px/s);
  assert.match(styles, /\.status span\s*\{[^}]*font-size:\s*11px/s);
});
