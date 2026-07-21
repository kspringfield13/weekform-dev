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

test("team sharing is one approval-first surface with advanced rules and exact data disclosed", () => {
  assert.match(panelSource, /Sharing with \{selectedTeam\.teamName\}/);
  assert.match(panelSource, /Approve and start sharing/);
  assert.match(panelSource, /Adjust sharing rules/);
  assert.match(panelSource, /View exact data/);
  assert.doesNotMatch(panelSource, /<h3>Hourly auto-sync<\/h3>/);
  assert.doesNotMatch(panelSource, /<h3>Review and sync<\/h3>/);
});

const accountHookSource = readFileSync(
  new URL("../hooks/useCloudAccount.ts", import.meta.url),
  "utf8"
);

test("a pending browser sign-in can be cancelled instead of holding the panel for the full timeout", () => {
  assert.match(panelSource, /cancelCloudOAuthSignIn/);
  assert.match(panelSource, /className="cloud-oauth-waiting"/);
  assert.match(stylesSource, /\.cloud-oauth-waiting/);
  // A cancel the user chose must not surface as an auth error banner.
  assert.match(accountHookSource, /CLOUD_OAUTH_CANCELLED_MESSAGE/);
});

test("a transient refresh failure keeps the session instead of signing the user out", () => {
  // Only a definitive invalid-refresh-token rejection may clear the session;
  // offline/5xx at hourly token expiry must leave it intact so sync self-heals.
  assert.match(accountHookSource, /isTerminalRefreshFailure\(result\.status\)/);
  const refreshBlock = accountHookSource.slice(
    accountHookSource.indexOf("const refreshAttempt"),
    accountHookSource.indexOf("refreshInFlight.current = refreshAttempt")
  );
  assert.match(refreshBlock, /if \(!isTerminalRefreshFailure\(result\.status\)\)/);
});

test("a session that cannot be persisted to the Keychain surfaces a warning instead of failing silently", () => {
  assert.match(accountHookSource, /SESSION_PERSISTENCE_ERROR/);
  assert.match(accountHookSource, /if \(envelope\.session\) setAuthError\(SESSION_PERSISTENCE_ERROR\)/);
});
