import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const installer = readFileSync(
  new URL("../../../../scripts/install.command", import.meta.url),
  "utf8",
);

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

test("source installer explains that the extracted source folder can be removed", () => {
  assert.match(installer, /temporary build copy was removed/i);
  assert.match(installer, /extracted source folder can be moved to Trash/i);
});
