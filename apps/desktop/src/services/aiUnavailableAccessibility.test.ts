import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AIConnectionNotice } from "../components/common/AIConnectionNotice";

const agentSource = readFileSync(
  new URL("../components/agent/AgentScreen.tsx", import.meta.url),
  "utf8",
);
const activitySource = readFileSync(
  new URL("../components/ledger/ActivityCapturePanel.tsx", import.meta.url),
  "utf8",
);
const ledgerSource = readFileSync(
  new URL("../components/ledger/LedgerScreen.tsx", import.meta.url),
  "utf8",
);
const routerSource = readFileSync(
  new URL("../components/shell/ScreenRouter.tsx", import.meta.url),
  "utf8",
);

test("the shared AI connection notice gives every unavailable surface a visible Settings path", () => {
  const markup = renderToStaticMarkup(createElement(AIConnectionNotice, {
    id: "ai-help",
    onOpenSettings: () => undefined,
  }));

  assert.match(markup, /id="ai-help"/);
  assert.match(markup, /role="note"/);
  assert.match(markup, /AI connection needed/);
  assert.match(markup, /Open AI Assistance/);
});

test("Agent explains unavailable AI without leaving an enabled dead-end composer", () => {
  assert.match(agentSource, /onOpenAISettings:\s*\(\) => void/);
  assert.match(agentSource, /<AIConnectionNotice[\s\S]*?id="agent-ai-unavailable"/);
  assert.match(agentSource, /const aiActionsDisabled = !aiAvailable \|\| isResettingLocalData/);
  assert.match(agentSource, /disabled=\{isSending \|\| aiActionsDisabled\}/);
  assert.match(agentSource, /aria-describedby=\{!aiAvailable \? "agent-ai-unavailable" : undefined\}/);
  const retryStart = agentSource.indexOf('className="agent-retry-button"');
  const retryButton = agentSource.slice(retryStart, agentSource.indexOf("</button>", retryStart));
  assert.match(retryButton, /disabled=\{isSending \|\| aiActionsDisabled\}/);
  assert.match(retryButton, /aria-describedby=\{!aiAvailable \? "agent-ai-unavailable" : undefined\}/);
  assert.match(routerSource, /onOpenAISettings=\{\(\) => openSettingsTab\("ai-assistance"\)\}/);
});

test("Classify sessions keeps its action name and points to the visible AI explanation", () => {
  assert.doesNotMatch(activitySource, /aria-label=\{classifyDisabledReason\}/);
  assert.match(activitySource, /aria-describedby=\{!aiAvailable \? "classification-ai-unavailable" : undefined\}/);
  assert.match(activitySource, /<AIConnectionNotice[\s\S]*?id="classification-ai-unavailable"/);
  assert.match(activitySource, /onRetry=\{aiAvailable \? onClassifySessions : undefined\}/);
  assert.match(ledgerSource, /disabled=\{classificationStatus === "classifying" \|\| !aiAvailable\}/);
  assert.match(ledgerSource, /onOpenAISettings:\s*\(\) => void/);
  assert.match(routerSource, /onOpenAISettings=\{\(\) => openSettingsTab\("ai-assistance"\)\}/);
});
