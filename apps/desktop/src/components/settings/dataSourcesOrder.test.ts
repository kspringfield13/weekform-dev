import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const setupSource = readFileSync(
  new URL("./SetupScreen.tsx", import.meta.url),
  "utf8",
);
const emailPanelUrl = new URL("./EmailSourcePanel.tsx", import.meta.url);
const emailPanelPath = fileURLToPath(emailPanelUrl);
const emailPanelSource = existsSync(emailPanelPath)
  ? readFileSync(emailPanelUrl, "utf8")
  : "";

test("native Data Sources places unavailable Email immediately before connectable Chat", () => {
  const emailPanel = setupSource.indexOf("<EmailSourcePanel");
  const chatPanel = setupSource.indexOf("<ChatSourcesPanel");

  assert.ok(emailPanel >= 0, "Email must be rendered in native Data Sources");
  assert.ok(chatPanel >= 0, "Chat must remain rendered in native Data Sources");
  assert.ok(emailPanel < chatPanel, "Email must appear immediately before Chat");
  assert.doesNotMatch(
    setupSource.slice(emailPanel + "<EmailSourcePanel".length, chatPanel),
    /<(?:section|[A-Z][A-Za-z]+Panel)\b/,
    "No source section may be inserted between Email and Chat",
  );
});

test("native Email row is accessible and cannot imply inbox connectivity", () => {
  assert.match(emailPanelSource, /aria-labelledby=["']email-source-title["']/);
  assert.match(emailPanelSource, /id=["']email-source-title["'][^>]*>Email</);
  assert.match(emailPanelSource, /does not connect to an email inbox today/i);
  assert.match(emailPanelSource, /no inbox access or message content import/i);
  assert.match(emailPanelSource, />Unavailable</);
  assert.doesNotMatch(emailPanelSource, /<button\b|onClick=|href=/);
});
