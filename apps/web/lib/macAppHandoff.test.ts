import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const launcherUrl = new URL("../components/MacAppLink.tsx", import.meta.url);
const tauriConfig = JSON.parse(
  readFileSync(new URL("../../desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as {
  plugins?: { "deep-link"?: { desktop?: { schemes?: string[] } } };
};
const cargoSource = readFileSync(
  new URL("../../desktop/src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);
const nativeSource = readFileSync(
  new URL("../../desktop/src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);
const macActivationSourceUrl = new URL(
  "../../desktop/src-tauri/src/macos_app_activation.m",
  import.meta.url,
);
const buildSource = readFileSync(
  new URL("../../desktop/src-tauri/build.rs", import.meta.url),
  "utf8",
);
const individualShellSource = readFileSync(
  new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const desktopAppSource = readFileSync(
  new URL("../../desktop/src/App.tsx", import.meta.url),
  "utf8",
);

test("download acquisition opens an installed Mac app before falling back to download", () => {
  assert.equal(existsSync(launcherUrl), true);
  const source = existsSync(launcherUrl) ? readFileSync(launcherUrl, "utf8") : "";

  assert.match(source, /export const WEEKFORM_OPEN_URL = "weekform:\/\/open/);
  assert.match(source, /openUrl\s*=\s*WEEKFORM_OPEN_URL/);
  assert.match(source, /!openUrl/);
  assert.match(source, /window\.addEventListener\("blur"/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /window\.location\.assign\(fallbackHref\)/);
  assert.match(source, /href=\{fallbackHref\}/);
  const fallbackDelay = source.match(
    /DOWNLOAD_FALLBACK_DELAY_MS\s*=\s*([\d_]+)/,
  );
  assert.ok(fallbackDelay, "the not-installed fallback delay must stay explicit");
  assert.ok(
    Number(fallbackDelay[1].replaceAll("_", "")) >= 10_000,
    "Chrome's first-open confirmation needs enough time before download fallback",
  );
});

test("the packaged Mac app owns the Weekform scheme and focuses one existing instance", () => {
  assert.deepEqual(
    tauriConfig.plugins?.["deep-link"]?.desktop?.schemes,
    ["weekform"],
  );
  assert.match(cargoSource, /tauri-plugin-deep-link\s*=\s*"2"/);
  assert.match(
    cargoSource,
    /tauri-plugin-single-instance\s*=\s*\{[^}]*version\s*=\s*"2"[^}]*features\s*=\s*\["deep-link"\]/s,
  );
  assert.match(nativeSource, /tauri_plugin_single_instance::init/);
  assert.match(nativeSource, /tauri_plugin_deep_link::init/);
  assert.match(nativeSource, /show_large_dashboard/);
  assert.match(
    nativeSource,
    /fn show_large_dashboard[\s\S]{0,400}ActivationPolicy::Regular/,
  );
  assert.match(
    nativeSource,
    /CloseRequested[\s\S]{0,300}ActivationPolicy::Accessory/,
  );
  assert.equal(existsSync(macActivationSourceUrl), true);
  const macActivationSource = existsSync(macActivationSourceUrl)
    ? readFileSync(macActivationSourceUrl, "utf8")
    : "";
  assert.match(macActivationSource, /activateWithOptions/);
  assert.match(macActivationSource, /currentApplication.+unhide/s);
  assert.match(macActivationSource, /\[NSApp activate\]/);
  assert.doesNotMatch(macActivationSource, /ActivateIgnoringOtherApps/);
  assert.match(buildSource, /macos_app_activation\.m/);
  assert.match(nativeSource, /weekform_activate_app/);
});

test("Individual Today and Week offer a desktop-gated Start Tracking handoff", () => {
  const launcherSource = readFileSync(launcherUrl, "utf8");

  assert.match(launcherSource, /openUrl/);
  assert.match(
    individualShellSource,
    /weekform:\/\/open\?source=weekform\.dev&action=start-tracking&view=compact/,
  );
  assert.match(individualShellSource, /active === "today" \|\| active === "week"/);
  assert.match(individualShellSource, /fallbackHref="\/download"/);
  assert.match(individualShellSource, /Start Tracking/);
  assert.match(nativeSource, /consume_pending_web_handoff/);
  assert.match(nativeSource, /show_quick_view/);
  assert.match(desktopAppSource, /resolveWebTrackingHandoff/);
  assert.match(desktopAppSource, /setActiveSettingsTab\("account"\)/);
  assert.match(desktopAppSource, /setPaused\(false\)/);
});
