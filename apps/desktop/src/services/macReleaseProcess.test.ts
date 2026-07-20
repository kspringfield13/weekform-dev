import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const scriptUrl = new URL("../../../../scripts/release-mac.command", import.meta.url);

test("the Mac publisher fails closed through notarization, stapling, hosted-byte verification, and deployment", () => {
  assert.equal(existsSync(scriptUrl), true);
  const source = existsSync(scriptUrl) ? readFileSync(scriptUrl, "utf8") : "";

  assert.match(source, /Developer ID Application: Blerbz LLC \(PC8SXU67D3\)/);
  assert.match(source, /notarytool history.+--keychain-profile/);
  assert.match(source, /notarytool submit.+--wait/);
  assert.match(source, /status.+Accepted/s);
  assert.match(source, /stapler staple/);
  assert.match(source, /stapler validate/);
  assert.match(source, /spctl.+context:primary-signature/);
  assert.match(source, /spctl.+type execute/);
  assert.match(source, /lipo -archs/);
  assert.match(source, /releases\/stable\/\$\{ARTIFACT_SHA256\}/);
  assert.match(source, /supabase storage cp/);
  assert.match(source, /REMOTE_ARTIFACT_SHA256/);
  assert.match(source, /WEEKFORM_ARTIFACT_DEVELOPER_ID_SIGNED/);
  assert.match(source, /WEEKFORM_ARTIFACT_NOTARIZED/);
  assert.match(source, /WEEKFORM_ARTIFACT_STAPLED/);
  assert.match(source, /vercel deploy --prod --yes/);
});
