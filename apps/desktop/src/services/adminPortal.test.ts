import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ADMIN_PORTAL_PREFERENCES,
  DEFAULT_WEEKFORM_WEB_APP_URL,
  getAdminPortalPreferencesStorage,
  getManagerAccessSignInUrl,
  getManagerModeMemberships,
  LOCAL_ADMIN_PORTAL_PREFERENCES_KEY,
  LOCAL_ADMIN_PORTAL_SESSION_KEY,
  readAdminPortalPreferences,
  readLocalAdminPortalSession,
  resolveSettingsTab,
  resetAdminPortalPreferences,
  writeAdminPortalPreferences,
  writeLocalAdminPortalSession,
  MAX_MANAGER_COMPARISONS,
  createInitialManagerWorkspaceState,
  filterManagerMembers,
  getIndividualWorkspaceUrl,
  getWeekformWebAppUrl,
  managerWorkspaceReducer,
  openWeekformWebApp,
  toggleManagerComparison,
} from "./adminPortal";

const managerMembers = [
  { id: "maya", name: "Maya Chen", team: "Insights", category: "Analysis", risk: "watch" as const },
  { id: "owen", name: "Owen Brooks", team: "Platform", category: "Delivery", risk: "stable" as const },
  { id: "ines", name: "Ines Duarte", team: "Insights", category: "Research", risk: "attention" as const },
];

test("Manager Access compares at most six individual contributors", () => {
  const selected = ["a", "b", "c", "d", "e", "f"];
  assert.equal(MAX_MANAGER_COMPARISONS, 6);
  assert.deepEqual(toggleManagerComparison(selected, "g"), selected);
});

test("Manager Access comparison toggles members without disturbing selection order", () => {
  assert.deepEqual(toggleManagerComparison(["maya", "owen"], "ines"), ["maya", "owen", "ines"]);
  assert.deepEqual(toggleManagerComparison(["maya", "owen", "ines"], "owen"), ["maya", "ines"]);
});

test("Manager Access filters the roster by query, team, category, and risk", () => {
  assert.deepEqual(
    filterManagerMembers(managerMembers, {
      query: "ines",
      team: "all",
      category: "all",
      risk: "all",
    }).map((member) => member.id),
    ["ines"],
  );
  assert.deepEqual(
    filterManagerMembers(managerMembers, {
      query: "",
      team: "Insights",
      category: "Analysis",
      risk: "watch",
    }).map((member) => member.id),
    ["maya"],
  );
});

test("Manager Access opens briefings and answers prompts from synthetic approved evidence", () => {
  const initial = createInitialManagerWorkspaceState();
  const briefing = managerWorkspaceReducer(initial, { type: "open-briefing" });
  assert.equal(briefing.page, "agent");
  assert.equal(briefing.mode, "manager");

  const answered = managerWorkspaceReducer(briefing, {
    type: "ask-agent",
    prompt: "What can this team absorb next week?",
  });
  assert.equal(answered.agentPrompt, "What can this team absorb next week?");
  assert.match(answered.agentAnswer ?? "", /approved snapshots/i);
  assert.match(answered.agentAnswer ?? "", /small commitment/i);
});

test("Manager Access keeps coordination actions approval-gated and records the approved outcome", () => {
  const initial = createInitialManagerWorkspaceState();
  const staged = managerWorkspaceReducer(initial, {
    type: "stage-action",
    action: "Protect Thursday focus block",
  });

  assert.equal(staged.page, "agent");
  assert.equal(staged.pendingAction, "Protect Thursday focus block");
  assert.deepEqual(staged.activity, initial.activity);

  const approved = managerWorkspaceReducer(staged, { type: "approve-action" });
  assert.equal(approved.pendingAction, null);
  assert.equal(approved.page, "history");
  assert.equal(approved.activity[0]?.detail, "Protect Thursday focus block");
  assert.equal(approved.activity[0]?.status, "Approved");
});

test("Manager Access can cancel a proposed action without changing coordination history", () => {
  const initial = createInitialManagerWorkspaceState();
  const staged = managerWorkspaceReducer(initial, {
    type: "stage-action",
    action: "Re-sequence launch support",
  });
  const canceled = managerWorkspaceReducer(staged, { type: "cancel-action" });

  assert.equal(canceled.pendingAction, null);
  assert.deepEqual(canceled.activity, initial.activity);
});

test("Manager Access builds working links to the personal workspace and production web app", () => {
  assert.equal(
    getIndividualWorkspaceUrl("account", "http://127.0.0.1:5174"),
    "http://127.0.0.1:5174/?demo=1&screen=setup&settings=account",
  );
  assert.equal(
    getWeekformWebAppUrl("/dashboard", "https://staging.weekform.example/base"),
    "https://staging.weekform.example/dashboard",
  );
  assert.equal(
    getWeekformWebAppUrl("/dashboard", "javascript:alert(1)"),
    `${DEFAULT_WEEKFORM_WEB_APP_URL}/dashboard`,
  );
  assert.equal(
    getWeekformWebAppUrl("//outside.example/dashboard"),
    `${DEFAULT_WEEKFORM_WEB_APP_URL}/`,
  );
});

test("personal workspace links accept only known settings tabs", () => {
  assert.equal(resolveSettingsTab("account"), "account");
  assert.equal(resolveSettingsTab("ai-assistance"), "ai-assistance");
  assert.equal(resolveSettingsTab("unknown"), null);
  assert.equal(resolveSettingsTab(null), null);
});

test("Manager Access opens the production web sign-in and returns to the web app surface", () => {
  assert.equal(DEFAULT_WEEKFORM_WEB_APP_URL, "https://weekform.dev");
  assert.equal(
    getManagerAccessSignInUrl(),
    `${DEFAULT_WEEKFORM_WEB_APP_URL}/login?next=%2Fmanager-access`
  );
});

test("desktop Account & Sharing opens the canonical Weekform Web app", () => {
  assert.equal(
    getWeekformWebAppUrl("/app"),
    "https://weekform.dev/app"
  );
});

test("browser demo detaches the Web app window before navigating it", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let openedInitialUrl: string | null = null;
  let navigatedTo: string | null = null;
  const popup = {
    opener: {} as object | null,
    location: {
      replace(url: string) {
        navigatedTo = url;
      }
    }
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      open(url: string) {
        openedInitialUrl = url;
        return popup;
      }
    }
  });

  try {
    await openWeekformWebApp();
    assert.equal(openedInitialUrl, "");
    assert.equal(popup.opener, null);
    assert.equal(navigatedTo, "https://weekform.dev/app");
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("Manager Access supports a configured staging web origin", () => {
  assert.equal(
    getManagerAccessSignInUrl(" https://staging.weekform.example/base/path/ "),
    "https://staging.weekform.example/login?next=%2Fmanager-access"
  );
});

test("Manager Access uses the current local origin during development", () => {
  assert.equal(
    getManagerAccessSignInUrl("https://weekform.dev", {
      isDevelopment: true,
      currentOrigin: "http://127.0.0.1:5174"
    }),
    "http://127.0.0.1:5174/manager-access"
  );
});

test("Manager Access rejects non-web and malformed configured origins", () => {
  for (const unsafeOrigin of ["javascript:alert(1)", "file:///tmp/weekform", "not a url"]) {
    assert.equal(
      getManagerAccessSignInUrl(unsafeOrigin),
      `${DEFAULT_WEEKFORM_WEB_APP_URL}/login?next=%2Fmanager-access`
    );
  }
});

test("desktop Manager Mode is available only from authenticated owner or manager memberships", () => {
  const memberships = [
    { teamId: "member-team", teamName: "Member team", role: "member" as const, sharePolicy: null },
    { teamId: "managed-team", teamName: "Managed team", role: "manager" as const, sharePolicy: null },
    { teamId: "owned-team", teamName: "Owned team", role: "owner" as const, sharePolicy: null },
  ];

  assert.deepEqual(
    getManagerModeMemberships(memberships).map(({ teamId }) => teamId),
    ["managed-team", "owned-team"],
  );
  assert.deepEqual(getManagerModeMemberships(memberships.slice(0, 1)), []);
});

test("local Manager Access authentication persists only in the current browser tab", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    }
  };

  assert.equal(readLocalAdminPortalSession(storage), false);
  assert.equal(writeLocalAdminPortalSession(storage, true), true);
  assert.equal(values.has(LOCAL_ADMIN_PORTAL_SESSION_KEY), true);
  assert.equal(readLocalAdminPortalSession(storage), true);
  assert.equal(writeLocalAdminPortalSession(storage, false), true);
  assert.equal(readLocalAdminPortalSession(storage), false);
});

test("local Manager Access authentication fails closed when session storage is unavailable", () => {
  const blockedStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    }
  };

  assert.equal(readLocalAdminPortalSession(blockedStorage), false);
  assert.equal(writeLocalAdminPortalSession(blockedStorage, true), false);
  assert.equal(writeLocalAdminPortalSession(blockedStorage, false), false);
});

test("Manager Access preferences round-trip through local display storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    }
  };
  const preferences = {
    theme: "light" as const,
    accent: "cobalt" as const,
    density: "compact" as const,
    ambientMotion: false
  };

  assert.equal(writeAdminPortalPreferences(storage, preferences), true);
  assert.deepEqual(readAdminPortalPreferences(storage), preferences);
  assert.equal(values.has(LOCAL_ADMIN_PORTAL_PREFERENCES_KEY), true);
  assert.equal(resetAdminPortalPreferences(storage), true);
  assert.deepEqual(readAdminPortalPreferences(storage), DEFAULT_ADMIN_PORTAL_PREFERENCES);
});

test("Manager Access preferences recover from partial, malformed, and unsupported values", () => {
  const storedValues = [
    JSON.stringify({ theme: "light", accent: "unknown", density: "compact" }),
    "not-json",
    JSON.stringify(null)
  ];

  for (const value of storedValues) {
    const storage = {
      getItem() {
        return value;
      },
      setItem() {},
      removeItem() {}
    };

    const preferences = readAdminPortalPreferences(storage);
    assert.equal(preferences.theme, value.startsWith("{") ? "light" : DEFAULT_ADMIN_PORTAL_PREFERENCES.theme);
    assert.equal(preferences.accent, DEFAULT_ADMIN_PORTAL_PREFERENCES.accent);
    assert.equal(preferences.density, value.startsWith("{") ? "compact" : DEFAULT_ADMIN_PORTAL_PREFERENCES.density);
    assert.equal(preferences.ambientMotion, DEFAULT_ADMIN_PORTAL_PREFERENCES.ambientMotion);
  }
});

test("Manager Access preferences fail safely when browser storage is unavailable", () => {
  const blockedStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    }
  };

  assert.deepEqual(readAdminPortalPreferences(blockedStorage), DEFAULT_ADMIN_PORTAL_PREFERENCES);
  assert.equal(writeAdminPortalPreferences(blockedStorage, DEFAULT_ADMIN_PORTAL_PREFERENCES), false);
  assert.equal(getAdminPortalPreferencesStorage(undefined), null);
});
