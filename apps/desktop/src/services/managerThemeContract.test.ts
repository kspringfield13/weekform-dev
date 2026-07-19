import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const managerRoot = readFileSync(
  new URL("../admin/AdminPortalApp.tsx", import.meta.url),
  "utf8",
);
const managerWorkspace = readFileSync(
  new URL("../admin/ManagerAccessWorkspace.tsx", import.meta.url),
  "utf8",
);
const managerStyles = readFileSync(
  new URL("../admin/span-simulator.css", import.meta.url),
  "utf8",
);

test("desktop Manager Access has no color-accent chooser", () => {
  assert.doesNotMatch(managerRoot, /ACCENT_OPTIONS|admin-settings-accent|data-admin-accent/);
  assert.doesNotMatch(managerWorkspace, /accent/i);
});

test("desktop Manager Mode uses no purple palette values", () => {
  assert.doesNotMatch(managerStyles, /#(?:9a8cff|a78bfa|7c3aed)|154,\s*140,\s*255|167,\s*139,\s*250/i);
});

test("desktop Manager Access renders with neutral colors only", () => {
  const managerTheme = managerStyles.slice(managerStyles.indexOf("/* Manager Access keeps"));
  const saturatedStatusColors = /#(?:4ade80|168c68|f59e0b|ef6b6b|f5b94f|ef8888|eeb452|ff8c8c)/i;

  assert.doesNotMatch(managerTheme, saturatedStatusColors);
});
