import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const scriptUrl = new URL("../../../../scripts/release-mac.command", import.meta.url);
const smokeUrl = new URL("../../../web/scripts/verify-production-download.mjs", import.meta.url);

test("the Mac publisher fails closed through notarization, stapling, hosted-byte verification, and deployment", () => {
  assert.equal(existsSync(scriptUrl), true);
  const source = existsSync(scriptUrl) ? readFileSync(scriptUrl, "utf8") : "";

  assert.match(source, /Developer ID Application: Blerbz LLC \(PC8SXU67D3\)/);
  assert.match(source, /npm run verify:release/);
  assert.match(source, /supabase migration list --linked --output-format json/);
  assert.match(source, /assert-linked-migrations\.mjs/);
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
  assert.match(source, /vercel inspect https:\/\/weekform\.dev --format json/);
  assert.match(source, /vercel deploy --prod --skip-domain --format json --yes/);
  assert.match(source, /validate-vercel-deployment\.mjs/);
  assert.match(source, /vercel promote.+--yes/);
  assert.match(source, /vercel rollback.+PREVIOUS_PRODUCTION_ID.+--yes/);
  assert.match(source, /verify-production-download\.mjs[\s\S]+ARTIFACT_SHA256/);
  assert.match(source, /WEEKFORM_RELEASE_SMOKE_EMAIL/);
  assert.match(source, /WEEKFORM_RELEASE_SMOKE_PASSWORD/);
  assert.match(source, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(
    source,
    /EXPECTED_SUPABASE_ORIGIN="https:\/\/\$\{EXPECTED_SUPABASE_PROJECT\}\.supabase\.co"/,
  );

  const verifyAt = source.indexOf("npm run verify:release");
  const migrationAt = source.indexOf("supabase migration list --linked --output-format json");
  const buildAt = source.indexOf("npm run desktop:release:mac");
  const inspectPreviousAt = source.indexOf("vercel inspect https://weekform.dev --format json");
  const proofEnvAt = source.indexOf("set_production_env WEEKFORM_ARTIFACT_BUCKET");
  const deployAt = source.indexOf("vercel deploy --prod --skip-domain --format json --yes");
  const candidateSmokeAt = source.indexOf('"$ARTIFACT_SHA256" "$CANDIDATE_URL" candidate');
  const promoteAt = source.indexOf("vercel promote");
  const productionInspections = [
    ...source.matchAll(/vercel inspect https:\/\/weekform\.dev --format json/g),
  ];
  const currentIdentityAt = source.indexOf('current-match "$PREVIOUS_PRODUCTION_ID"');
  const canonicalSmokeAt = source.indexOf('"$ARTIFACT_SHA256" "https://weekform.dev" canonical');
  const rollbackIdentityAt = source.indexOf('current-match "$CANDIDATE_ID"');
  const rollbackAt = source.indexOf('vercel rollback "$PREVIOUS_PRODUCTION_ID" --yes');
  assert.ok(verifyAt >= 0 && verifyAt < buildAt, "the full release gate must pass before packaging");
  assert.ok(migrationAt >= 0 && migrationAt < buildAt, "production schema parity must be proved before packaging");
  assert.ok(
    inspectPreviousAt >= 0 && inspectPreviousAt < proofEnvAt,
    "the rollback target must be inspected before release proofs change",
  );
  assert.ok(
    proofEnvAt < deployAt && deployAt < candidateSmokeAt && candidateSmokeAt < promoteAt,
    "a production-target candidate must pass authenticated byte proof before promotion",
  );
  assert.equal(productionInspections.length, 3);
  const reinspectionAt = productionInspections[1]?.index ?? -1;
  assert.ok(
    candidateSmokeAt < reinspectionAt && reinspectionAt < currentIdentityAt && currentIdentityAt < promoteAt,
    "canonical production identity must be unchanged immediately before promotion",
  );
  const failureInspectionAt = productionInspections[2]?.index ?? -1;
  assert.ok(
    canonicalSmokeAt < failureInspectionAt &&
      failureInspectionAt < rollbackIdentityAt &&
      rollbackIdentityAt < rollbackAt,
    "rollback must only run while the failed candidate still owns the canonical domain",
  );
  assert.ok(
    promoteAt < canonicalSmokeAt && canonicalSmokeAt < rollbackAt,
    "the exact canonical origin must be smoked after promotion with compensating rollback",
  );

  const smokeSource = existsSync(smokeUrl) ? readFileSync(smokeUrl, "utf8") : "";
  assert.doesNotMatch(smokeSource, /WEEKFORM_RELEASE_BASE_URL/);
});
