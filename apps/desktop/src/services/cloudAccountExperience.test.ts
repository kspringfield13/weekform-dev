import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelSource = readFileSync(
  new URL("../components/settings/CloudAccountPanel.tsx", import.meta.url),
  "utf8"
);
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("Account & Sharing offers Google and GitHub before a collapsed password form", () => {
  const google = panelSource.indexOf("Sign in with Google");
  const github = panelSource.indexOf("Sign in with GitHub");
  const passwordDisclosure = panelSource.indexOf('className="cloud-password-disclosure"');

  assert.ok(google >= 0, "Google sign-in should be visible");
  assert.ok(github > google, "GitHub sign-in should follow Google");
  assert.ok(passwordDisclosure > github, "email/password should be a lower-priority disclosure");
  assert.match(panelSource, /<details className="cloud-password-disclosure">/);
  assert.match(panelSource, /Sign in with email and password/);
});

test("Account & Sharing uses the Weekform Web name and a dedicated auth card", () => {
  assert.doesNotMatch(panelSource, /Weekform Cloud/);
  assert.match(panelSource, /Weekform Web/);
  assert.match(panelSource, /className="cloud-auth-card"/);
  assert.match(stylesSource, /\.cloud-auth-card/);
  assert.match(stylesSource, /\.cloud-oauth-options/);
  assert.match(stylesSource, /\.cloud-password-disclosure/);
});

test("Account & Sharing places an Open Web App control beside the Weekform Web heading", () => {
  const headingStart = panelSource.indexOf("function AccountSharingHeading()");
  const headingEnd = panelSource.indexOf("function ManagerAccessSettingsRow()");
  const headingSource = panelSource.slice(headingStart, headingEnd);

  assert.match(headingSource, /className="account-sharing-title-row"/);
  assert.match(headingSource, /<h2>Weekform Web<\/h2>/);
  assert.match(headingSource, /<span>Open Web App<\/span>/);
  assert.match(headingSource, /openWeekformWebApp\(\)/);
  assert.match(stylesSource, /\.account-sharing-title-row/);
});
