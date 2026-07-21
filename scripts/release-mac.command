#!/bin/zsh

# Produce and publish one immutable, Gatekeeper-trusted Weekform Mac release.
# This intentionally stops at the first missing proof. It never enables the
# website's official download from a merely signed or locally working build.

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_DIR="${SCRIPT_DIR:h}"
cd "$REPO_DIR"

readonly SIGNING_IDENTITY="Developer ID Application: Blerbz LLC (PC8SXU67D3)"
readonly EXPECTED_TEAM_ID="PC8SXU67D3"
readonly EXPECTED_BUNDLE_ID="com.clearcapacity.desktop"
readonly EXPECTED_SUPABASE_PROJECT="fytospjjbcksmppmvupy"
readonly EXPECTED_SUPABASE_ORIGIN="https://${EXPECTED_SUPABASE_PROJECT}.supabase.co"
readonly EXPECTED_VERCEL_PROJECT="weekform"
readonly ARTIFACT_FILENAME="Weekform_0.1.0_universal.dmg"
readonly APP_PATH="$REPO_DIR/apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/macos/Weekform.app"
readonly DMG_PATH="$REPO_DIR/apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/$ARTIFACT_FILENAME"
readonly RELEASE_BUCKET="${WEEKFORM_RELEASE_BUCKET:-weekform-releases}"
readonly NOTARY_PROFILE="${WEEKFORM_NOTARY_PROFILE:-weekform-notary}"

VERIFY_DIR=""
MOUNT_DIR=""
MOUNTED="false"

cleanup() {
  if [[ "$MOUNTED" == "true" && -n "$MOUNT_DIR" ]]; then
    hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  fi
  if [[ -n "$VERIFY_DIR" && -d "$VERIFY_DIR" ]]; then
    rm -rf -- "$VERIFY_DIR"
  fi
  if [[ -n "$MOUNT_DIR" && -d "$MOUNT_DIR" ]]; then
    rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

fail() {
  print -u2 -- "Mac release stopped: $*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' is unavailable."
}

set_production_env() {
  local name="$1"
  local value="$2"
  printf '%s' "$value" | npx vercel env add "$name" production --force --yes >/dev/null
}

[[ "$(uname -s)" == "Darwin" ]] || fail "this workflow must run on macOS."

for command_name in cargo codesign curl git hdiutil lipo node npm npx security shasum spctl xcrun; do
  require_command "$command_name"
done

[[ -f "$REPO_DIR/supabase/.temp/project-ref" ]] || fail "the Supabase project is not linked."
[[ "$(<"$REPO_DIR/supabase/.temp/project-ref")" == "$EXPECTED_SUPABASE_PROJECT" ]] \
  || fail "the linked Supabase project is not the Weekform production project."

[[ -f "$REPO_DIR/.vercel/project.json" ]] || fail "the Vercel project is not linked."
VERCEL_PROJECT="$(node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(value.projectName || "")' "$REPO_DIR/.vercel/project.json")"
[[ "$VERCEL_PROJECT" == "$EXPECTED_VERCEL_PROJECT" ]] \
  || fail "the linked Vercel project is not Weekform production."

if [[ -n "$(git status --porcelain)" && "${WEEKFORM_ALLOW_DIRTY_RELEASE:-0}" != "1" ]]; then
  fail "the worktree is not clean. Commit the intended release or set WEEKFORM_ALLOW_DIRTY_RELEASE=1 after reviewing every local change."
fi

security find-identity -v -p codesigning | grep -Fq "$SIGNING_IDENTITY" \
  || fail "the Developer ID Application identity is missing from Keychain."

# This is both an authentication preflight and a guarantee that the script
# cannot silently downgrade to an unnotarized package.
xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null \
  || fail "Keychain notarization profile '$NOTARY_PROFILE' is unavailable or invalid."

PRODUCTION_ENV_LIST="$(npx vercel env ls production 2>&1)"
for required_env in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  print -r -- "$PRODUCTION_ENV_LIST" | grep -Fq "$required_env" \
    || fail "required production environment variable '$required_env' is missing."
done

# The post-deploy proof signs in as a dedicated synthetic release account. Keep
# these operator-only credentials out of Vercel and fail before building if the
# local environment cannot perform the authenticated byte-for-byte smoke.
if ! node -e '
  const required = process.argv.slice(1);
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    process.stderr.write(`Missing local release-smoke environment: ${missing.join(", ")}\n`);
    process.exit(1);
  }
' NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY WEEKFORM_RELEASE_SMOKE_EMAIL WEEKFORM_RELEASE_SMOKE_PASSWORD VERCEL_AUTOMATION_BYPASS_SECRET; then
  fail "the authenticated production download smoke is not configured."
fi

# Application code and production RLS/RPC contracts are one release. Machine-
# readable equality catches both pending local migrations and remote-only drift.
if ! LINKED_MIGRATIONS="$(npx supabase migration list --linked --output-format json)"; then
  fail "the linked Supabase migration ledger could not be read."
fi
if ! print -r -- "$LINKED_MIGRATIONS" | node scripts/assert-linked-migrations.mjs; then
  fail "the linked Supabase schema does not match this release."
fi

# Run the canonical TypeScript, Web, Rust, integration, pgTAP, build, and audit
# gates before spending time on signing or creating release artifacts.
npm run verify:release

export APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
npm run desktop:release:mac

[[ -d "$APP_PATH" ]] || fail "the universal Weekform app was not produced."
[[ -f "$DMG_PATH" ]] || fail "the universal Weekform DMG was not produced."

codesign --verify --deep --strict --verbose=2 "$APP_PATH"
APP_SIGNATURE="$(codesign -d --verbose=4 "$APP_PATH" 2>&1)"
print -r -- "$APP_SIGNATURE" | grep -Fq "Authority=$SIGNING_IDENTITY" \
  || fail "the app does not carry the expected Developer ID authority."
print -r -- "$APP_SIGNATURE" | grep -Fq "TeamIdentifier=$EXPECTED_TEAM_ID" \
  || fail "the app Team ID does not match the release identity."
print -r -- "$APP_SIGNATURE" | grep -Eq 'flags=0x[0-9a-f]+\(runtime\)' \
  || fail "the app is not signed with hardened runtime."

APP_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Contents/Info.plist")"
[[ "$APP_BUNDLE_ID" == "$EXPECTED_BUNDLE_ID" ]] \
  || fail "the compatibility bundle identifier changed unexpectedly."
APP_URL_SCHEME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$APP_PATH/Contents/Info.plist")"
[[ "$APP_URL_SCHEME" == "weekform" ]] || fail "the packaged app does not own the weekform URL scheme."

APP_ARCHITECTURES="$(lipo -archs "$APP_PATH/Contents/MacOS/weekform")"
[[ " $APP_ARCHITECTURES " == *" arm64 "* ]] || fail "the app is missing its Apple silicon slice."
[[ " $APP_ARCHITECTURES " == *" x86_64 "* ]] || fail "the app is missing its Intel slice."

codesign --verify --strict --verbose=2 "$DMG_PATH"
hdiutil verify "$DMG_PATH"

VERIFY_DIR="$(mktemp -d /tmp/weekform-release-verify.XXXXXX)"
NOTARY_RESULT_FILE="$VERIFY_DIR/notary-result.json"
xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait --output-format json > "$NOTARY_RESULT_FILE"
NOTARY_STATUS="$(node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(value.status || "")' "$NOTARY_RESULT_FILE")"
[[ "$NOTARY_STATUS" == "Accepted" ]] || fail "Apple notarization did not return status Accepted."

xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG_PATH"
hdiutil verify "$DMG_PATH"

MOUNT_DIR="$(mktemp -d /tmp/weekform-release-mount.XXXXXX)"
hdiutil attach "$DMG_PATH" -readonly -nobrowse -mountpoint "$MOUNT_DIR" -quiet
MOUNTED="true"
readonly MOUNTED_APP_PATH="$MOUNT_DIR/Weekform.app"
[[ -d "$MOUNTED_APP_PATH" ]] || fail "the mounted DMG does not contain Weekform.app."
codesign --verify --deep --strict --verbose=2 "$MOUNTED_APP_PATH"
spctl --assess --type execute --verbose=2 "$MOUNTED_APP_PATH"
MOUNTED_ARCHITECTURES="$(lipo -archs "$MOUNTED_APP_PATH/Contents/MacOS/weekform")"
[[ "$MOUNTED_ARCHITECTURES" == "$APP_ARCHITECTURES" ]] \
  || fail "the mounted app architecture set does not match the verified build."
hdiutil detach "$MOUNT_DIR" -quiet
MOUNTED="false"
rmdir "$MOUNT_DIR"
MOUNT_DIR=""

# Stapling changes the DMG bytes, so the immutable path and checksum are
# calculated only after the final ticket and Gatekeeper checks have passed.
readonly ARTIFACT_SHA256="$(shasum -a 256 "$DMG_PATH" | awk '{print tolower($1)}')"
readonly VERIFIED_AT="$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')"
readonly ARTIFACT_PATH="releases/stable/${ARTIFACT_SHA256}/${ARTIFACT_FILENAME}"
readonly REMOTE_ARTIFACT_URI="ss:///${RELEASE_BUCKET}/${ARTIFACT_PATH}"

npx supabase storage cp "$DMG_PATH" "$REMOTE_ARTIFACT_URI" \
  --linked --experimental --yes \
  --content-type application/x-apple-diskimage \
  --cache-control 'private, max-age=0, no-store'

readonly REMOTE_COPY_PATH="$VERIFY_DIR/$ARTIFACT_FILENAME"
npx supabase storage cp "$REMOTE_ARTIFACT_URI" "$REMOTE_COPY_PATH" \
  --linked --experimental --yes
readonly REMOTE_ARTIFACT_SHA256="$(shasum -a 256 "$REMOTE_COPY_PATH" | awk '{print tolower($1)}')"
[[ "$REMOTE_ARTIFACT_SHA256" == "$ARTIFACT_SHA256" ]] \
  || fail "the private hosted bytes do not match the verified stapled DMG."

# Capture and validate the exact deployment currently serving the canonical
# domain before changing production environment values. It is the only allowed
# rollback target if the post-promotion canonical proof fails.
readonly PREVIOUS_DEPLOYMENT_FILE="$VERIFY_DIR/vercel-previous.json"
if ! npx vercel inspect https://weekform.dev --format json > "$PREVIOUS_DEPLOYMENT_FILE"; then
  fail "the current Weekform production deployment could not be inspected."
fi
if ! PREVIOUS_PRODUCTION_ID="$(node scripts/validate-vercel-deployment.mjs previous-id < "$PREVIOUS_DEPLOYMENT_FILE")"; then
  fail "the current Weekform production deployment could not be validated."
fi
readonly PREVIOUS_PRODUCTION_ID

# These attestations are written only after the hosted bytes match the exact
# notarized and stapled artifact. The website parser independently rechecks
# the content-addressed path and complete proof before enabling the action.
set_production_env WEEKFORM_ARTIFACT_BUCKET "$RELEASE_BUCKET"
set_production_env WEEKFORM_ARTIFACT_PATH "$ARTIFACT_PATH"
set_production_env WEEKFORM_ARTIFACT_DEVELOPER_ID_SIGNED true
set_production_env WEEKFORM_ARTIFACT_NOTARIZED true
set_production_env WEEKFORM_ARTIFACT_STAPLED true
set_production_env WEEKFORM_ARTIFACT_SHA256 "$ARTIFACT_SHA256"
set_production_env WEEKFORM_ARTIFACT_VERIFIED_AT "$VERIFIED_AT"

# Build against production configuration without assigning any domain. JSON
# metadata is validated twice: first from deploy, then from a fresh inspection.
readonly CANDIDATE_DEPLOYMENT_FILE="$VERIFY_DIR/vercel-candidate-deploy.json"
if ! npx vercel deploy --prod --skip-domain --format json --yes > "$CANDIDATE_DEPLOYMENT_FILE"; then
  fail "the production-target Web candidate did not deploy successfully."
fi
if ! CANDIDATE_ID="$(node scripts/validate-vercel-deployment.mjs candidate-id < "$CANDIDATE_DEPLOYMENT_FILE")"; then
  fail "the production-target Web candidate metadata was invalid."
fi
if ! CANDIDATE_URL="$(node scripts/validate-vercel-deployment.mjs candidate-url < "$CANDIDATE_DEPLOYMENT_FILE")"; then
  fail "the production-target Web candidate URL was invalid."
fi
readonly CANDIDATE_ID CANDIDATE_URL

readonly CANDIDATE_INSPECTION_FILE="$VERIFY_DIR/vercel-candidate-inspect.json"
if ! npx vercel inspect "$CANDIDATE_ID" --format json > "$CANDIDATE_INSPECTION_FILE"; then
  fail "the production-target Web candidate could not be inspected."
fi
if ! node scripts/validate-vercel-deployment.mjs \
  candidate-inspect "$CANDIDATE_ID" "$CANDIDATE_URL" < "$CANDIDATE_INSPECTION_FILE"; then
  fail "the inspected Web candidate did not match the validated deployment."
fi

# Authentication, signed-target validation, bounded byte streaming, and the
# exact notarized checksum must pass on the unaliased candidate first.
node apps/web/scripts/verify-production-download.mjs \
  "$ARTIFACT_SHA256" "$CANDIDATE_URL" candidate "$EXPECTED_SUPABASE_ORIGIN"

# Promotion is compare-before-swap at the operator boundary: refuse to replace
# a production deployment that changed while this candidate was being built
# and smoked, and never use the stale captured ID as that release's rollback.
readonly CURRENT_DEPLOYMENT_FILE="$VERIFY_DIR/vercel-current-before-promote.json"
if ! npx vercel inspect https://weekform.dev --format json > "$CURRENT_DEPLOYMENT_FILE"; then
  fail "the current Weekform production deployment could not be re-inspected before promotion."
fi
if ! node scripts/validate-vercel-deployment.mjs \
  current-match "$PREVIOUS_PRODUCTION_ID" < "$CURRENT_DEPLOYMENT_FILE"; then
  fail "Weekform production changed during this release; the candidate was not promoted."
fi

npx vercel promote "$CANDIDATE_ID" --yes

# Re-run the proof against the literal canonical origin. If either the public
# surface or authenticated bytes fail after promotion, restore the deployment
# captured above and stop the release even when rollback itself succeeds.
if ! curl --fail --silent --show-error --location --max-time 30 https://weekform.dev/ >/dev/null \
  || ! node apps/web/scripts/verify-production-download.mjs \
    "$ARTIFACT_SHA256" "https://weekform.dev" canonical "$EXPECTED_SUPABASE_ORIGIN"; then
  readonly FAILED_CANONICAL_DEPLOYMENT_FILE="$VERIFY_DIR/vercel-current-before-rollback.json"
  if ! npx vercel inspect https://weekform.dev --format json > "$FAILED_CANONICAL_DEPLOYMENT_FILE"; then
    fail "the canonical proof failed and production could not be inspected; automatic rollback was skipped."
  fi
  if ! node scripts/validate-vercel-deployment.mjs \
    current-match "$CANDIDATE_ID" < "$FAILED_CANONICAL_DEPLOYMENT_FILE"; then
    fail "the canonical proof failed but production no longer belongs to this candidate; automatic rollback was skipped."
  fi
  if ! npx vercel rollback "$PREVIOUS_PRODUCTION_ID" --yes; then
    fail "the canonical release proof failed and the previous deployment could not be restored automatically."
  fi
  fail "the canonical release proof failed after promotion; the previous deployment was restored."
fi

print -- "Weekform Mac release published successfully."
print -- "Artifact: $REMOTE_ARTIFACT_URI"
print -- "SHA-256: $ARTIFACT_SHA256"
print -- "Verified: $VERIFIED_AT"
