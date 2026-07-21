import assert from "node:assert/strict";
import test from "node:test";

import {
  readWorkspaceModePreference,
  resolvePreferredWorkspaceRedirect,
  writeWorkspaceModePreference,
} from "./workspaceModePreference";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("the explicit workspace choice survives navigation within one browser session", () => {
  const storage = new MemoryStorage();

  writeWorkspaceModePreference(storage, "manager");
  assert.equal(readWorkspaceModePreference(storage), "manager");

  writeWorkspaceModePreference(storage, "individual");
  assert.equal(readWorkspaceModePreference(storage), "individual");
});

test("invalid stored values fail closed to the current workspace", () => {
  const storage = new MemoryStorage();
  storage.setItem("weekform:web-workspace-mode", "admin");

  assert.equal(readWorkspaceModePreference(storage), null);
  assert.equal(
    resolvePreferredWorkspaceRedirect({
      currentMode: "individual",
      preferredMode: null,
      teamAvailable: true,
      teamHref: "/teams/team-1?screen=agent",
    }),
    null,
  );
});

test("a remembered Manager workspace restores the same Week, Agent, or History route", () => {
  for (const screen of ["weekly", "agent", "ledger"]) {
    const teamHref = `/teams/team-1?screen=${screen}`;
    assert.equal(
      resolvePreferredWorkspaceRedirect({
        currentMode: "individual",
        preferredMode: "manager",
        teamAvailable: true,
        teamHref,
      }),
      teamHref,
    );
  }
});

test("preference restoration never escapes membership or loops between workspaces", () => {
  assert.equal(
    resolvePreferredWorkspaceRedirect({
      currentMode: "individual",
      preferredMode: "manager",
      teamAvailable: false,
      teamHref: "/manager-access?screen=weekly",
    }),
    null,
  );
  assert.equal(
    resolvePreferredWorkspaceRedirect({
      currentMode: "manager",
      preferredMode: "manager",
      teamAvailable: true,
      teamHref: "/teams/team-1?screen=weekly",
    }),
    null,
  );
});
