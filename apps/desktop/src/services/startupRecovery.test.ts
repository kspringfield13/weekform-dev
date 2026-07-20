import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
const boundarySource = readFileSync(
  new URL("../components/common/StartupErrorBoundary.tsx", import.meta.url),
  "utf8",
);
const tauriConfig = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as {
  app?: {
    security?: {
      csp?: string;
      freezePrototype?: boolean;
    };
  };
};

test("desktop root contains render failures instead of leaving a white webview", () => {
  assert.match(mainSource, /import \{ StartupErrorBoundary \}/);
  assert.match(mainSource, /<StartupErrorBoundary>[\s\S]*<\/StartupErrorBoundary>/);
  assert.match(boundarySource, /getDerivedStateFromError/);
  assert.match(boundarySource, /Weekform couldn.t finish opening/);
  assert.match(boundarySource, /Reload Weekform/);
  assert.match(boundarySource, /local data has not been reset/i);
  assert.doesNotMatch(boundarySource, /console\.(error|log)|error\.message|error\.stack/);
});

test("packaged startup leaves built-in prototypes writable for third-party modules", () => {
  assert.equal(tauriConfig.app?.security?.freezePrototype, false);
  assert.match(tauriConfig.app?.security?.csp ?? "", /default-src 'self'/);
});
