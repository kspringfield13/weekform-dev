import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const launcherUrl = new URL("../components/MacAppLink.tsx", import.meta.url);
const landingSource = readFileSync(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const downloadSource = readFileSync(
  new URL("../app/download/page.tsx", import.meta.url),
  "utf8",
);
const headerSource = readFileSync(
  new URL("../components/SiteHeader.tsx", import.meta.url),
  "utf8",
);
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

test("Mac acquisition links always navigate normally without attempting a custom-protocol launch", () => {
  assert.equal(existsSync(launcherUrl), true);
  const source = existsSync(launcherUrl) ? readFileSync(launcherUrl, "utf8") : "";

  assert.match(source, /export const WEEKFORM_OPEN_URL = "weekform:\/\/open/);
  assert.match(source, /openUrl\s*=\s*WEEKFORM_OPEN_URL/);
  assert.match(source, /attemptAppOpen\s*=\s*false/);
  assert.match(source, /!attemptAppOpen/);
  assert.match(source, /!openUrl/);
  assert.match(source, /window\.addEventListener\("blur"/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /window\.location\.assign\(fallbackHref\)/);
  assert.match(source, /href=\{fallbackHref\}/);
  const fallbackDelay = source.match(
    /DOWNLOAD_FALLBACK_DELAY_MS\s*=\s*([\d_]+)/,
  );
  const fallbackDelayValue = fallbackDelay?.[1];
  assert.ok(fallbackDelayValue, "the not-installed fallback delay must stay explicit");
  assert.ok(
    Number(fallbackDelayValue.replaceAll("_", "")) >= 10_000,
    "Chrome's first-open confirmation needs enough time before download fallback",
  );
  assert.doesNotMatch(landingSource, /attemptAppOpen=/);
  assert.doesNotMatch(downloadSource, /attemptAppOpen=/);
  assert.doesNotMatch(headerSource, /attemptAppOpen=/);
  assert.doesNotMatch(landingSource, /hasOwnRegisteredDesktop|desktopIdentified/);
  assert.doesNotMatch(downloadSource, /hasOwnRegisteredDesktop|desktopIdentified/);
  assert.doesNotMatch(headerSource, /"Open Mac App"/);
  assert.doesNotMatch(downloadSource, /"Open Weekform Desktop"/);
});

test("the trusted package replaces source-build instructions when the official DMG is available", () => {
  assert.match(
    downloadSource,
    /releasePresentation\.kind === "pending"\s*\?\s*\([\s\S]*id="source-install"[\s\S]*\)\s*:\s*null/,
  );
  assert.match(downloadSource, /href=\{releasePresentation\.action\.href\}/);
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

test("Individual Today and Week explicitly open the installed Desktop app to start tracking", () => {
  assert.match(individualShellSource, /MacAppLink/);
  assert.match(
    individualShellSource,
    /weekform:\/\/open\?source=weekform\.dev&action=start-tracking&view=compact/,
  );
  assert.match(individualShellSource, /active === "today" \|\| active === "week"/);
  assert.match(
    individualShellSource,
    /<MacAppLink[\s\S]*?attemptAppOpen[\s\S]*?openUrl=\{WEEKFORM_START_TRACKING_URL\}[\s\S]*?fallbackHref="\/download"/,
  );
  assert.match(individualShellSource, /Start Tracking/);
  assert.doesNotMatch(individualShellSource, /DesktopStartTrackingButton/);
  assert.match(nativeSource, /consume_pending_web_handoff/);
  assert.match(nativeSource, /show_quick_view/);
  assert.match(desktopAppSource, /resolveWebTrackingHandoff/);
  assert.match(desktopAppSource, /if \(!requestCapturePaused\(false\)\) return/);
});
