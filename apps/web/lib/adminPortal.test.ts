import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_PORTAL_PREFERENCES_COOKIE,
  DEFAULT_ADMIN_PORTAL_PREFERENCES,
  checkSimulatorAdminAccess,
  getAdminPortalPreferencesCookieOptions,
  parseAdminPortalPreferences,
  serializeAdminPortalPreferences,
} from "./adminPortal";

test("admin appearance preferences round-trip through the compact cookie value", () => {
  const preferences = {
    theme: "light" as const,
    accent: "cobalt" as const,
    density: "compact" as const,
    ambientMotion: false,
  };

  assert.deepEqual(
    parseAdminPortalPreferences(serializeAdminPortalPreferences(preferences)),
    preferences,
  );
});

test("admin appearance preferences reject malformed or unrecognized cookie values", () => {
  assert.deepEqual(
    parseAdminPortalPreferences("v1.neon.red.cramped.maybe"),
    DEFAULT_ADMIN_PORTAL_PREFERENCES,
  );
  assert.deepEqual(
    parseAdminPortalPreferences("not-a-preference-cookie"),
    DEFAULT_ADMIN_PORTAL_PREFERENCES,
  );
  assert.deepEqual(
    parseAdminPortalPreferences(undefined),
    DEFAULT_ADMIN_PORTAL_PREFERENCES,
  );
});

test("admin appearance cookie is narrow, http-only, and optionally secure", () => {
  assert.equal(ADMIN_PORTAL_PREFERENCES_COOKIE, "weekform_admin_appearance");
  assert.deepEqual(getAdminPortalPreferencesCookieOptions(true), {
    httpOnly: true,
    maxAge: 31_536_000,
    path: "/admin",
    sameSite: "lax",
    secure: true,
  });
});

test("simulator admin access authorizes only an exact true RPC response", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    async rpc(name: string, args?: unknown) {
      calls.push({ name, args });
      return { data: true, error: null };
    },
  };

  assert.equal(await checkSimulatorAdminAccess(client), "authorized");
  assert.deepEqual(calls, [
    { name: "has_simulator_admin_access", args: undefined },
  ]);
});

test("simulator admin access denies a successful false RPC response", async () => {
  const client = {
    async rpc() {
      return { data: false, error: null };
    },
  };

  assert.equal(await checkSimulatorAdminAccess(client), "forbidden");
});

test("simulator admin access fails closed when the RPC is missing or malformed", async () => {
  const errorClient = {
    async rpc() {
      return { data: null, error: { message: "function not found" } };
    },
  };
  const malformedClient = {
    async rpc() {
      return { data: "true", error: null };
    },
  };
  const throwingClient = {
    async rpc(): Promise<never> {
      throw new Error("network unavailable");
    },
  };

  assert.equal(await checkSimulatorAdminAccess(errorClient), "unavailable");
  assert.equal(await checkSimulatorAdminAccess(malformedClient), "unavailable");
  assert.equal(await checkSimulatorAdminAccess(throwingClient), "unavailable");
});
