import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const introSource = readFileSync(
  new URL("../components/WebWorkspaceIntro.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("the authenticated dashboard exposes real workspace destinations", () => {
  for (const id of ["workspace-overview", "personal-workspace", "teams", "sharing"]) {
    assert.match(dashboardSource, new RegExp(`id=[\"{].*${id}`));
  }
  assert.doesNotMatch(dashboardSource, /href=["']#["']/);
  assert.match(dashboardSource, /href="\/manager-access"/);
});

test("the Web workspace mounts a user-scoped role-aware intro with replay", () => {
  assert.match(dashboardSource, /<WebWorkspaceIntro/);
  assert.match(dashboardSource, /userId=\{user\.id\}/);
  assert.match(dashboardSource, /hasManagerAccess=\{managedTeams\.length > 0\}/);
  assert.match(introSource, /Welcome to Weekform Web/);
  assert.match(introSource, /webOnboardingStorageKey\(userId\)/);
  assert.match(introSource, /localStorage\.setItem/);
  assert.match(introSource, /Replay intro/);
  assert.match(introSource, /role="dialog"/);
  assert.match(introSource, /aria-modal="true"/);
});

test("the Web dashboard has a crafted workspace shell and guided-tour treatment", () => {
  for (const className of [
    "workspace-shell",
    "workspace-hero",
    "workspace-nav",
    "web-intro",
    "web-intro-card",
    "web-intro-spotlight",
  ]) {
    assert.match(stylesSource, new RegExp(`\\.${className}`));
  }
});

test("the private workspace explains the hybrid Mac and Web approval model", () => {
  for (const phrase of [
    "Your Mac holds the full picture",
    "The Web gets only what you need to review",
    "Every change returns to your Mac",
    "Raw activity never comes here",
  ]) {
    assert.match(dashboardSource, new RegExp(phrase));
  }

  for (const className of [
    "hybrid-workspace",
    "hybrid-model",
    "hybrid-surface",
    "hybrid-return-rail",
    "hybrid-setup",
  ]) {
    assert.match(stylesSource, new RegExp(`\\.${className}`));
  }

  assert.match(dashboardSource, /aria-label="How the hybrid Weekform model works"/);
  assert.match(dashboardSource, /Open Weekform for Mac/);
  assert.match(dashboardSource, /Turn on Private Web workspace/);
  assert.doesNotMatch(dashboardSource, /Open the Mac setup/);
});
