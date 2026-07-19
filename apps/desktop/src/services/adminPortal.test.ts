import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WEEKFORM_WEB_APP_URL,
  getAdminPortalSignInUrl
} from "./adminPortal";

test("Admin Portal opens the production web sign-in and returns to the dashboard", () => {
  assert.equal(
    getAdminPortalSignInUrl(),
    `${DEFAULT_WEEKFORM_WEB_APP_URL}/login?next=%2Fdashboard`
  );
});

test("Admin Portal supports a configured staging web origin", () => {
  assert.equal(
    getAdminPortalSignInUrl(" https://staging.weekform.example/base/path/ "),
    "https://staging.weekform.example/login?next=%2Fdashboard"
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
      `${DEFAULT_WEEKFORM_WEB_APP_URL}/login?next=%2Fdashboard`
    );
  }
});
