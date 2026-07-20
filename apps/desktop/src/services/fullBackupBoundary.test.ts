import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { FullBackup } from "../lib/dataExport";
import { prepareNativeFullBackup } from "../lib/dataExport";
import {
  AGENT_CHAT_STORAGE_KEY,
  AGENT_DRAFT_STORAGE_KEY,
  readAgentSessionStorage,
} from "./agentSessionStorage";

test("full backup reads only valid persisted Agent messages plus the draft", () => {
  const values = new Map<string, string>([
    [AGENT_CHAT_STORAGE_KEY, JSON.stringify([
      { id: "u1", role: "user", content: "What fits?", createdAt: "2026-07-20T12:00:00.000Z" },
      { id: "bad", role: "system", content: "hidden" },
      { id: "blank", role: "assistant", content: "   " },
    ])],
    [AGENT_DRAFT_STORAGE_KEY, "Compare my reactive load"],
  ]);
  const session = readAgentSessionStorage({ getItem: (key) => values.get(key) ?? null });
  assert.deepEqual(session, {
    messages: [{
      id: "u1",
      role: "user",
      content: "What fits?",
      createdAt: "2026-07-20T12:00:00.000Z",
    }],
    draft: "Compare my reactive load",
  });
});

test("native backup base never embeds the truncated recent-sample cache", () => {
  const backup = {
    activeWindowSamples: [{ window_title: "private customer title" }],
    blocks: [{ work_block_id: "block-1" }],
    agentSession: { messages: [], draft: "" },
  } as unknown as FullBackup;

  const nativeBase = prepareNativeFullBackup(backup);
  assert.equal("activeWindowSamples" in nativeBase, false);
  assert.deepEqual((nativeBase as { blocks: unknown[] }).blocks, [{ work_block_id: "block-1" }]);
  assert.deepEqual(nativeBase.agentSession, { messages: [], draft: "" });
});

test("desktop full backup delegates complete raw evidence to the streaming journal export", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const setup = readFileSync(
    new URL("../components/settings/SetupScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.match(app, /export_full_backup_with_journal/);
  assert.match(app, /prepareNativeFullBackup\(backup\)/);
  assert.match(app, /journal_record_count/);
  assert.match(setup, /const \[isExportingBackup, setIsExportingBackup\]/);
  assert.match(setup, /disabled=\{isExportingBackup\}/);
});
