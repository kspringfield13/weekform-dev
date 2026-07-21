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
const personalCloudSource = readFileSync(
  new URL("../../desktop/src/hooks/usePersonalCloudSync.ts", import.meta.url),
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

test("Individual Today and Week queue a prompt-free authenticated Start Tracking action", () => {
  const startTrackingSource = readFileSync(
    new URL("../components/DesktopStartTrackingButton.tsx", import.meta.url),
    "utf8",
  );
  const actionsSource = readFileSync(
    new URL("../app/dashboard/personalActions.ts", import.meta.url),
    "utf8",
  );
  const stateSource = readFileSync(new URL("desktopActions.ts", import.meta.url), "utf8");
  const stylesSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(startTrackingSource, /weekform:\/\//);
  assert.doesNotMatch(startTrackingSource, /attemptAppOpen/);
  assert.match(individualShellSource, /active === "today" \|\| active === "week"/);
  assert.match(individualShellSource, /<DesktopStartTrackingButton/);
  assert.match(startTrackingSource, /queueDesktopStartTracking/);
  assert.match(startTrackingSource, /useActionState/);
  assert.match(individualShellSource, /Start Tracking/);
  assert.match(actionsSource, /request_desktop_start_tracking/);
  assert.match(actionsSource, /result === "no_device"[\s\S]*?redirect\("\/download"\)/);
  assert.match(actionsSource, /result === "already_tracking"[\s\S]*?status:\s*"already-tracking"/);
  assert.match(actionsSource, /confirmed a successful capture recently/);
  assert.doesNotMatch(actionsSource, /Tracking is already active/);
  assert.match(actionsSource, /result === "offline"[\s\S]*?status:\s*"unavailable"/);
  assert.match(stateSource, /"already-tracking"/);
  assert.match(stylesSource, /\.web-start-tracking-status\.is-already-tracking\s*\{[^}]*var\(--signal-green\)/s);
  assert.match(personalCloudSource, /fetchPendingDesktopActions/);
  assert.match(personalCloudSource, /acknowledgeDesktopAction/);
  assert.match(personalCloudSource, /registerWeekformDeviceV3/);
  assert.match(desktopAppSource, /invoke\("show_quick_view"\)/);
  assert.match(
    desktopAppSource,
    /const handleDesktopStartTracking[\s\S]{0,500}!requestCapturePaused\(false\)/,
  );
  assert.doesNotMatch(
    nativeSource,
    /WEB_HANDOFF_START_TRACKING|PendingWebHandoff|consume_pending_web_handoff|clear-capacity:web-handoff/,
  );
});

test("the borderless sidebar mark opens the matching current page through an allowlisted native handoff", () => {
  const handoffSource = readFileSync(new URL("desktopPageHandoff.ts", import.meta.url), "utf8");
  const stylesSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(individualShellSource, /desktopPageHandoffUrl\(activeRoute, workspaceMode\)/);
  assert.match(
    individualShellSource,
    /<MacAppLink[\s\S]*?attemptAppOpen[\s\S]*?openUrl=\{desktopHandoffUrl\}[\s\S]*?fallbackHref="\/download"[\s\S]*?aria-label="Open current page in Weekform Desktop"/,
  );
  assert.match(individualShellSource, /<WeekformMark className="web-open-desktop-mark"/);
  assert.match(handoffSource, /source=weekform\.dev&view=large&screen=/);
  assert.match(stylesSource, /\.web-open-desktop-mark\s*\{[^}]*width:\s*22px[^}]*height:\s*18px/s);
  assert.match(stylesSource, /\.web-open-desktop-button\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/s);
  assert.doesNotMatch(stylesSource, /\.web-open-desktop-button:hover\s*\{[^}]*border-color|\.web-open-desktop-button:hover\s*\{[^}]*background:/s);
});

test("the packaged app owns the deep links the sidebar handoff invokes", () => {
  assert.match(nativeSource, /fn web_handoff_screen/);
  assert.match(nativeSource, /consume_pending_web_navigation/);
  assert.match(nativeSource, /clear-capacity:web-navigation/);
  assert.match(desktopAppSource, /consume_pending_web_navigation/);
  assert.match(desktopAppSource, /clear-capacity:web-navigation/);
  assert.match(desktopAppSource, /shouldConsumePendingWebNavigation/);
  assert.match(desktopAppSource, /localPersistenceHydrationSettled/);
  assert.doesNotMatch(
    desktopAppSource,
    /listening\s*&&\s*screen\s*&&\s*screen in screenLabels/,
  );
  assert.match(
    desktopAppSource,
    /function applyNativeScreen\(screen: Screen\)[\s\S]{0,220}setManagerModeOpen\(false\)[\s\S]{0,120}setActive\(screen\)/,
  );
  assert.match(
    desktopAppSource,
    /if \(cloudAccount\.hydrated && !teamAvailable && active === "team"\) setActive\("daily"\)/,
  );
});
