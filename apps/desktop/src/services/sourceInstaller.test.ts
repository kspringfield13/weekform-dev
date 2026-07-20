import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const installer = readFileSync(
  new URL("../../../../scripts/install.command", import.meta.url),
  "utf8",
);
const sourceLauncher = readFileSync(
  new URL("../../../../start.sh", import.meta.url),
  "utf8",
);
const signaturePolicyPath = fileURLToPath(
  new URL("../../../../scripts/lib/source-signature.sh", import.meta.url),
);

function signaturePolicyStatus(details: string): number | null {
  return spawnSync(
    "bash",
    [
      "-c",
      'source "$1"; is_repairable_local_signature "$2"',
      "source-signature-test",
      signaturePolicyPath,
      details,
    ],
    { encoding: "utf8" },
  ).status;
}

test("source package launcher delegates to the reviewed installer from any working directory", () => {
  assert.match(sourceLauncher, /^#!\/usr\/bin\/env bash/m);
  assert.match(sourceLauncher, /set -euo pipefail/);
  assert.match(sourceLauncher, /SCRIPT_DIR=.*BASH_SOURCE/);
  assert.match(sourceLauncher, /exec bash "\$SCRIPT_DIR\/scripts\/install\.command"/);
});

test("source signature policy permits only an unidentified ad-hoc local bundle", () => {
  assert.equal(
    signaturePolicyStatus("Signature=adhoc\nTeamIdentifier=not set"),
    0,
  );
  assert.notEqual(
    signaturePolicyStatus(
      "Authority=Developer ID Application: Example (TEAM123)\nTeamIdentifier=TEAM123",
    ),
    0,
  );
  assert.notEqual(signaturePolicyStatus("TeamIdentifier=not set"), 0);
  assert.notEqual(
    signaturePolicyStatus("Signature=adhoc\nAuthority=Unexpected\nTeamIdentifier=not set"),
    0,
  );
});

test("source installer applies the fail-closed signature policy before repair", () => {
  assert.match(installer, /codesign --verify --deep --strict "\$APP_PATH"/);
  assert.match(
    installer,
    /source "\$SCRIPT_DIR\/lib\/source-signature\.sh"/,
  );
  assert.match(
    installer,
    /if ! codesign --verify --deep --strict "\$APP_PATH"[\s\S]*is_repairable_local_signature "\$APP_SIGNATURE"[\s\S]*codesign --force --deep --sign - "\$APP_PATH"/,
  );
  assert.match(
    installer,
    /codesign --verify --deep --strict "\$APP_PATH" \|\| die/,
  );
});

test("source installer removes only its temporary macOS app bundle after installation", () => {
  assert.match(
    installer,
    /EXPECTED_BUILD_APP="\$PROJECT_DIR\/apps\/desktop\/src-tauri\/target\/release\/bundle\/macos\/Weekform\.app"/,
  );
  assert.match(installer, /\[ "\$APP_PATH" = "\$EXPECTED_BUILD_APP" \]/);
  assert.match(installer, /rm -rf -- "\$APP_PATH"/);

  const installedAt = installer.indexOf('ok "Installed to $DEST"');
  const cleanedAt = installer.indexOf('rm -rf -- "$APP_PATH"');
  assert.ok(installedAt >= 0, "the install success boundary must remain explicit");
  assert.ok(cleanedAt > installedAt, "cleanup must run only after the Applications copy succeeds");
});

test("source installer explains that a cloned source checkout can be removed", () => {
  assert.match(installer, /temporary build copy was removed/i);
  assert.match(installer, /cloned source checkout can be moved to Trash/i);
});

test("source installer never bypasses Gatekeeper quarantine", () => {
  assert.doesNotMatch(installer, /xattr\s+-[dr]+\s+com\.apple\.quarantine/i);
  assert.doesNotMatch(installer, /right-click Weekform\.app and choose Open/i);
});
