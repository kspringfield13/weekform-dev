import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ADMIN_PORTAL_PREFERENCES,
  DEFAULT_WEEKFORM_WEB_APP_URL,
  getAdminPortalPreferencesStorage,
  getAdminPortalSignInUrl,
  LOCAL_ADMIN_PORTAL_PREFERENCES_KEY,
  LOCAL_ADMIN_PORTAL_SESSION_KEY,
  readAdminPortalPreferences,
  readLocalAdminPortalSession,
  resetAdminPortalPreferences,
  writeAdminPortalPreferences,
  writeLocalAdminPortalSession,
  MAX_MANAGER_COMPARISONS,
  filterManagerMembers,
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

test("Admin Portal opens the production web sign-in and returns to the portal", () => {
  assert.equal(DEFAULT_WEEKFORM_WEB_APP_URL, "https://weekform.dev");
  assert.equal(
    getAdminPortalSignInUrl(),
    `${DEFAULT_WEEKFORM_WEB_APP_URL}/login?next=%2Fadmin`
  );
});

test("Admin Portal supports a configured staging web origin", () => {
  assert.equal(
    getAdminPortalSignInUrl(" https://staging.weekform.example/base/path/ "),
    "https://staging.weekform.example/login?next=%2Fadmin"
  );
});

test("Admin Portal uses the current local origin during development", () => {
  assert.equal(
    getAdminPortalSignInUrl("https://weekform.com", {
      isDevelopment: true,
      currentOrigin: "http://127.0.0.1:5174"
    }),
    "http://127.0.0.1:5174/admin"
  );
});

test("Admin Portal rejects non-web and malformed configured origins", () => {
  for (const unsafeOrigin of ["javascript:alert(1)", "file:///tmp/weekform", "not a url"]) {
    assert.equal(
      getAdminPortalSignInUrl(unsafeOrigin),
      `${DEFAULT_WEEKFORM_WEB_APP_URL}/login?next=%2Fadmin`
    );
  }
});

test("local Admin Portal authentication persists only in the current browser tab", () => {
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

test("local Admin Portal authentication fails closed when session storage is unavailable", () => {
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

test("Admin Portal preferences round-trip through local display storage", () => {
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

test("Admin Portal preferences recover from partial, malformed, and unsupported values", () => {
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

test("Admin Portal preferences fail safely when browser storage is unavailable", () => {
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
