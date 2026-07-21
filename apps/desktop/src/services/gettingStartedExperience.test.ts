import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modalSource = readFileSync(
  new URL("../components/onboarding/GettingStartedModal.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("onboarding names every step instead of repeating a generic modal title", () => {
  assert.match(modalSource, /aria-label="Setup progress"/);
  assert.match(modalSource, /aria-current=\{isActive \? "step" : undefined\}/);
  assert.match(modalSource, /currentStep\.title/);
  assert.doesNotMatch(modalSource, /You&rsquo;re Ready to Begin/);
});

test("privacy and tracking are explained as reviewable evidence under user control", () => {
  assert.match(modalSource, /Local by default/);
  assert.match(modalSource, /You decide what counts/);
  assert.match(modalSource, /Network use is explicit/);
  assert.match(modalSource, /does not collect keystrokes, file contents, microphone, or webcam input/);
  assert.match(modalSource, /Frontmost app \+ window title/);
  assert.match(modalSource, /Pause from the toolbar at any time/);
});

test("the welcome page explains and acknowledges Keychain access before startup can request it", () => {
  assert.match(modalSource, /onIntroAcknowledged: \(\) => void/);
  assert.match(modalSource, /Mac's Keychain guards the\s+key that encrypts your activity journal/);
  assert.match(modalSource, /Choose “Always Allow”/);
  assert.match(modalSource, /your password goes to\s+macOS, never to Weekform/);
  assert.match(modalSource, /if \(step === "intro"\) onIntroAcknowledged\(\)/);
  assert.match(appSource, /onIntroAcknowledged=\{acknowledgeKeychainAccess\}/);
});

test("first-run startup shows non-secret state before Keychain-backed hydration", () => {
  assert.match(appSource, /readPersistedState\(\{ hydrateAISecret: false \}\)/);
  assert.match(appSource, /const keychainAccessDeferred\s*=\s*firstRunWizardPending\s*&&\s*!keychainAccessAcknowledged/);
  assert.match(appSource, /if \(keychainAccessDeferred\) return;/);
  assert.match(
    appSource,
    /if \(isDemoMode \|\| !isTauriRuntime \|\| retentionDays === null \|\| keychainAccessDeferred\) return/,
  );
  assert.ok(
    appSource.indexOf('invoke("present_main_window")') <
      appSource.indexOf("const hydrateKeychainBackedStartup"),
    "the welcome window must be presented before Keychain-backed startup is defined or run",
  );
});

test("retention is a direct, accessible choice and distinguishes raw from reviewed data", () => {
  assert.match(modalSource, /<fieldset className="getting-started-retention"/);
  assert.match(modalSource, /type="radio"/);
  assert.match(modalSource, /Sessions and work blocks are kept until you exclude them or reset Weekform/);
});

test("AI recommends ChatGPT and keeps Platform API-key setup in a secondary disclosure", () => {
  assert.match(modalSource, /Recommended connection/);
  assert.match(modalSource, /Connect Codex/);
  assert.match(modalSource, /No Platform API key or separate\s+key setup/);
  assert.match(modalSource, /<details className="getting-started-api-disclosure">/);
  assert.match(modalSource, /Use a Platform API key instead/);
  assert.match(modalSource, /Advanced setup/);
  assert.match(modalSource, /You can continue without AI and connect later in Settings/);
  assert.ok(
    modalSource.indexOf("Recommended connection") <
      modalSource.indexOf('className="getting-started-api-disclosure"'),
    "Expected the recommended ChatGPT connection before the API-key disclosure",
  );
  assert.ok(
    modalSource.indexOf('className="getting-started-api-disclosure"') <
      modalSource.indexOf('id={`${baseId}-api-key`}'),
    "Expected the API-key input to live inside the collapsed disclosure",
  );
  assert.match(stylesSource, /\.getting-started-codex-card\s*\{/);
  assert.match(stylesSource, /\.getting-started-api-disclosure\s*>\s*summary\s*\{/);
});

test("the setup sheet has a labeled rail, narrow-window fallback, and reduced-motion path", () => {
  assert.match(stylesSource, /\.getting-started-card\s*\{[\s\S]*grid-template-columns:/);
  assert.match(stylesSource, /\.getting-started-rail\s*\{/);
  assert.match(stylesSource, /@media \(max-width: 720px\)[\s\S]*\.getting-started-rail/);
  assert.match(
    stylesSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.getting-started-step-marker/,
  );
});

test("the final step offers a synthetic week preview without replacing the Settings path", () => {
  assert.match(modalSource, /onOpenDemo: \(\) => void/);
  assert.match(modalSource, /Preview a full synthetic week/);
  assert.match(modalSource, /View simulated week/);
  assert.match(modalSource, /does not load or change your own data/);
  assert.match(modalSource, /Open Settings/);
  assert.match(stylesSource, /\.getting-started-demo-card\s*\{/);
  assert.match(appSource, /onOpenDemo=\{openDemoSimulation\}/);
  assert.match(appSource, /appPersistence\s*\.flushLatest\(\)/);
  assert.match(appSource, /window\.location\.assign\(demoExit\.href\)/);
});
