// Focused tests for the pure /download helpers (no Supabase, no network).
// Run: npx tsx --test apps/web/lib/download.test.ts  (root: npm run test:web)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

import {
  RELEASE_INFO,
  formatTtl,
  getReleasePresentation,
  isArtifactConfigured,
  parseArtifactConfig,
} from "./download";

const FULL_ENV = {
  WEEKFORM_ARTIFACT_BUCKET: "weekform-releases",
  WEEKFORM_ARTIFACT_PATH: `releases/stable/${"a".repeat(64)}/Weekform_0.1.0_universal.dmg`,
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  WEEKFORM_ARTIFACT_DEVELOPER_ID_SIGNED: "true",
  WEEKFORM_ARTIFACT_NOTARIZED: "true",
  WEEKFORM_ARTIFACT_STAPLED: "true",
  WEEKFORM_ARTIFACT_SHA256: "a".repeat(64),
  WEEKFORM_ARTIFACT_VERIFIED_AT: "2026-07-20T16:00:00.000Z",
};

const HOSTING_ONLY_ENV = {
  WEEKFORM_ARTIFACT_BUCKET: FULL_ENV.WEEKFORM_ARTIFACT_BUCKET,
  WEEKFORM_ARTIFACT_PATH: FULL_ENV.WEEKFORM_ARTIFACT_PATH,
  NEXT_PUBLIC_SUPABASE_URL: FULL_ENV.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: FULL_ENV.SUPABASE_SERVICE_ROLE_KEY,
};

test("parseArtifactConfig returns null when unconfigured (documented fallback)", () => {
  assert.equal(parseArtifactConfig({}), null);
});

test("private artifact hosting alone cannot publish an unverified Mac release", () => {
  assert.equal(parseArtifactConfig(HOSTING_ONLY_ENV), null);
});

test("parseArtifactConfig returns null when any single var is missing", () => {
  for (const key of Object.keys(FULL_ENV)) {
    const env = { ...FULL_ENV, [key]: undefined };
    assert.equal(
      parseArtifactConfig(env),
      null,
      `expected null when ${key} is missing`,
    );
  }
});

test("parseArtifactConfig returns null for blank/whitespace-only values", () => {
  const env = { ...FULL_ENV, WEEKFORM_ARTIFACT_BUCKET: "   " };
  assert.equal(parseArtifactConfig(env), null);
});

test("parseArtifactConfig returns a full config with the default TTL", () => {
  const config = parseArtifactConfig(FULL_ENV);
  assert.ok(config, "expected a parsed config");
  assert.equal(config.bucket, "weekform-releases");
  assert.equal(config.path, `releases/stable/${"a".repeat(64)}/Weekform_0.1.0_universal.dmg`);
  assert.equal(config.supabaseUrl, "https://example.supabase.co");
  assert.equal(config.serviceRoleKey, "service-role-secret");
  assert.equal(config.signedUrlTtlSeconds, 300);
  assert.deepEqual(config.releaseProof, {
    developerIdSigned: true,
    notarized: true,
    stapled: true,
    sha256: "a".repeat(64),
    verifiedAt: "2026-07-20T16:00:00.000Z",
  });
});

test("release proof fails closed for false attestations or malformed metadata", () => {
  for (const env of [
    { ...FULL_ENV, WEEKFORM_ARTIFACT_DEVELOPER_ID_SIGNED: "false" },
    { ...FULL_ENV, WEEKFORM_ARTIFACT_NOTARIZED: "false" },
    { ...FULL_ENV, WEEKFORM_ARTIFACT_STAPLED: "false" },
    { ...FULL_ENV, WEEKFORM_ARTIFACT_SHA256: "not-a-checksum" },
    { ...FULL_ENV, WEEKFORM_ARTIFACT_VERIFIED_AT: "not-a-date" },
    { ...FULL_ENV, WEEKFORM_ARTIFACT_VERIFIED_AT: "July 20, 2026" },
    { ...FULL_ENV, WEEKFORM_ARTIFACT_PATH: "releases/Weekform_0.0.9_universal.dmg" },
  ]) {
    assert.equal(parseArtifactConfig(env), null);
  }
});

test("official artifacts use an immutable checksum-addressed storage path", () => {
  assert.equal(parseArtifactConfig({
    ...FULL_ENV,
    WEEKFORM_ARTIFACT_PATH: "releases/Weekform_0.1.0_universal.dmg",
  }), null);
  assert.ok(parseArtifactConfig({
    ...FULL_ENV,
    WEEKFORM_ARTIFACT_PATH: `releases/stable/${"a".repeat(64)}/${RELEASE_INFO.artifactFilename}`,
  }));
});

test("parseArtifactConfig trims incidental whitespace", () => {
  const env = { ...FULL_ENV, WEEKFORM_ARTIFACT_BUCKET: "  weekform-releases  " };
  const config = parseArtifactConfig(env);
  assert.ok(config);
  assert.equal(config.bucket, "weekform-releases");
});

test("parseArtifactConfig honors a valid custom TTL", () => {
  const env = {
    ...FULL_ENV,
    WEEKFORM_ARTIFACT_SIGNED_URL_TTL_SECONDS: "120",
  };
  const config = parseArtifactConfig(env);
  assert.ok(config);
  assert.equal(config.signedUrlTtlSeconds, 120);
});

test("parseArtifactConfig clamps an out-of-range TTL", () => {
  const tooLow = parseArtifactConfig({
    ...FULL_ENV,
    WEEKFORM_ARTIFACT_SIGNED_URL_TTL_SECONDS: "1",
  });
  assert.ok(tooLow);
  assert.equal(tooLow.signedUrlTtlSeconds, 30);

  const tooHigh = parseArtifactConfig({
    ...FULL_ENV,
    WEEKFORM_ARTIFACT_SIGNED_URL_TTL_SECONDS: "999999",
  });
  assert.ok(tooHigh);
  assert.equal(tooHigh.signedUrlTtlSeconds, 3600);
});

test("parseArtifactConfig falls back to the default TTL for malformed input", () => {
  const config = parseArtifactConfig({
    ...FULL_ENV,
    WEEKFORM_ARTIFACT_SIGNED_URL_TTL_SECONDS: "not-a-number",
  });
  assert.ok(config);
  assert.equal(config.signedUrlTtlSeconds, 300);
});

test("isArtifactConfigured mirrors parseArtifactConfig", () => {
  assert.equal(isArtifactConfigured({}), false);
  assert.equal(isArtifactConfigured(FULL_ENV), true);
});

test("formatTtl renders whole minutes and singular/plural seconds", () => {
  assert.equal(formatTtl(300), "5 minutes");
  assert.equal(formatTtl(60), "1 minute");
  assert.equal(formatTtl(45), "45 seconds");
  assert.equal(formatTtl(1), "1 second");
});

test("an unverified DMG keeps the default website release fail-closed", () => {
  const presentation = getReleasePresentation(null);

  assert.equal(presentation.kind, "pending");
  assert.equal(presentation.title, "Mac release is being finalized");
  assert.equal(presentation.action.label, "Open Weekform Web");
  assert.equal(presentation.action.href, "/app");
  assert.doesNotMatch(
    JSON.stringify(presentation),
    /bucket|credentials/i,
  );
  assert.match(presentation.detail, /Developer ID signing/i);
  assert.match(presentation.detail, /notarization/i);
  assert.match(presentation.detail, /stapler validation/i);
});

test("the website does not ship a directly addressable public DMG", () => {
  const publicRoot = new URL("../public", import.meta.url);
  const dmgs = existsSync(publicRoot)
    ? readdirSync(publicRoot, { recursive: true })
      .map(String)
      .filter((path) => path.toLowerCase().endsWith(".dmg"))
    : [];
  assert.deepEqual(dmgs, []);

  const configSource = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(configSource, /application\/x-apple-diskimage|\/downloads\//i);
});

test("configured artifact becomes an active, filename-specific download", () => {
  const config = parseArtifactConfig(FULL_ENV);
  assert.ok(config);

  const presentation = getReleasePresentation(config);
  assert.equal(presentation.kind, "available");
  assert.equal(presentation.action.label, "Download now");
  assert.equal(presentation.action.href, "/download/artifact");
  assert.equal(presentation.filename, RELEASE_INFO.artifactFilename);
  assert.match(presentation.note, /5 minutes/);
  assert.match(presentation.note, /Developer ID signed/i);
  assert.match(presentation.note, /notarized/i);
  assert.match(presentation.note, /stapled/i);
  assert.match(presentation.note, /verified July 20, 2026/i);
});

test("RELEASE_INFO carries non-empty version, date, and macOS requirement copy", () => {
  assert.ok(RELEASE_INFO.version.length > 0);
  assert.ok(RELEASE_INFO.generatedDate.length > 0);
  assert.match(RELEASE_INFO.macOsRequirement, /macOS/);
  assert.match(RELEASE_INFO.artifactFilename, /^Weekform_.+_universal\.dmg$/);
  assert.equal(RELEASE_INFO.architecture, "Apple silicon and Intel");
  assert.ok(RELEASE_INFO.releaseNotes.length >= 3);
  assert.ok(RELEASE_INFO.features.length >= 4);
  assert.ok(RELEASE_INFO.tips.length >= 3);
});

test("download page keeps unavailable releases out of disabled-button limbo", () => {
  const source = readFileSync(
    new URL("../app/download/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /getReleasePresentation/);
  assert.match(source, /releasePresentation\.kind === "available"/);
  assert.match(source, /releasePresentation\.action\.label/);
  assert.match(source, /releasePresentation\.filename/);
  assert.match(source, /RELEASE_INFO\.releaseNotes/);
  assert.match(source, /RELEASE_INFO\.features/);
  assert.match(source, /RELEASE_INFO\.tips/);
  assert.match(source, /Open the DMG/);
  assert.match(source, /Verified Mac install/);
  assert.match(source, /releasePresentation\.kind === "available"[\s\S]*download-install-strip/);
  assert.doesNotMatch(source, /Expect a Gatekeeper warning|unsigned preview/i);
  assert.doesNotMatch(
    source,
    /aria-disabled|is-disabled|private release bucket credentials|Developer ID certificate|notarization pending|npm ci|desktop:dev|xattr -dr/,
  );
});

test("pending Mac release offers an honestly labeled two-command source install beside Web", () => {
  const source = readFileSync(
    new URL("../app/download/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /href="#source-install"/);
  assert.match(source, /Install from source/);
  assert.match(source, /git clone --depth 1/);
  assert.match(source, /cd weekform-dev && bash start\.sh/);
  assert.match(source, /builds\s+Weekform locally/i);
  assert.match(source, /className="button button-secondary download-web-action"/);
  assert.match(source, /releasePresentation\.action\.label/);
  assert.doesNotMatch(source, /archive\/refs\/heads\/main\.zip/);
  assert.doesNotMatch(source, /source install[\s\S]{0,180}(notarized|stapled)/i);

  const styles = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /\.download-source-note\s*\{[\s\S]*?color:\s*var\(--text-muted\);[\s\S]*?font-size:\s*12px;/,
  );
});

// --- planArtifactResponse: the full /download/artifact decision sequence ---

import { planArtifactResponse, type ArtifactConfig } from "./download";

const CONFIG: ArtifactConfig = {
  bucket: "weekform-releases",
  path: "releases/Weekform_0.1.0_universal.dmg",
  supabaseUrl: "https://example.supabase.co",
  serviceRoleKey: "service-role-secret",
  signedUrlTtlSeconds: 300,
  releaseProof: {
    developerIdSigned: true,
    notarized: true,
    stapled: true,
    sha256: "a".repeat(64),
    verifiedAt: "2026-07-20T16:00:00.000Z",
  },
};

const REQUEST_URL = "https://weekform.example/download/artifact";

type PlanDeps = Parameters<typeof planArtifactResponse>[0];

/**
 * Deps that count each step so tests can pin down what must NOT run.
 * Counting is centralized in wrappers here — overrides are wrapped too, so a
 * step can never execute without its counter incrementing (an override that
 * forgot to count manually was the one seam that could make "URL matched but
 * count is 0" observable).
 */
function trackedDeps(overrides: Partial<PlanDeps>) {
  const calls = { getUser: 0, createSignedUrl: 0 };
  const getUser =
    overrides.getUser ?? (async () => ({ userId: "user-1" as string | null }));
  const createSignedUrl =
    overrides.createSignedUrl ?? (async () => "https://storage.example/signed");
  const deps: PlanDeps = {
    supabaseConfigured: overrides.supabaseConfigured ?? true,
    config: "config" in overrides ? (overrides.config ?? null) : CONFIG,
    requestUrl: REQUEST_URL,
    getUser: async () => {
      calls.getUser += 1;
      return getUser();
    },
    createSignedUrl: async (config) => {
      calls.createSignedUrl += 1;
      return createSignedUrl(config);
    },
  };
  return { deps, calls };
}

test("artifact plan: Supabase unconfigured → 503 without touching session or storage", async () => {
  const { deps, calls } = trackedDeps({ supabaseConfigured: false });
  const plan = await planArtifactResponse(deps);
  assert.ok(plan.kind === "json");
  assert.equal(plan.status, 503);
  assert.equal(plan.body.error, "not_configured");
  assert.equal(calls.getUser, 0, "session must not be consulted");
  assert.equal(calls.createSignedUrl, 0, "service-key step must not run");
});

test("artifact plan: unauthenticated → 401 and the service-key step never runs", async () => {
  const { deps, calls } = trackedDeps({
    getUser: async () => ({ userId: null }),
  });
  const plan = await planArtifactResponse(deps);
  assert.ok(plan.kind === "json");
  assert.equal(plan.status, 401);
  assert.equal(plan.body.error, "unauthenticated");
  assert.equal(calls.createSignedUrl, 0, "service-key step must not run");
});

test("artifact plan: signed in but no verified artifact host → honest 503", async () => {
  const { deps, calls } = trackedDeps({ config: null });
  const plan = await planArtifactResponse(deps);
  assert.ok(plan.kind === "json");
  assert.equal(plan.status, 503);
  assert.equal(plan.body.error, "artifact_not_configured");
  assert.equal(calls.getUser, 1);
  assert.equal(calls.createSignedUrl, 0, "service-key step must not run");
});

test("artifact route has no bundled public-DMG fallback", () => {
  const source = readFileSync(
    new URL("../app/download/artifact/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /BUNDLED_ARTIFACT|bundledArtifactUrl|\/downloads\//);
});

test("artifact route forces the verified filename and disables response caching", () => {
  const source = readFileSync(
    new URL("../app/download/artifact/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /download:\s*RELEASE_INFO\.artifactFilename/);
  assert.match(source, /Cache-Control["']:\s*["']private, no-store, max-age=0["']/);
});

test("artifact plan: storage signing failure → 303 back to the styled /download page", async () => {
  const { deps } = trackedDeps({ createSignedUrl: async () => null });
  const plan = await planArtifactResponse(deps);
  assert.ok(plan.kind === "redirect");
  assert.equal(plan.status, 303);
  assert.equal(plan.url, "https://weekform.example/download?error=artifact");
});

test("artifact plan: configured + signed in → 307 to the signed URL, exact config passed", async () => {
  let seenConfig: ArtifactConfig | null = null;
  const { deps, calls } = trackedDeps({
    createSignedUrl: async (config) => {
      seenConfig = config;
      return "https://storage.example/signed?token=abc";
    },
  });
  const plan = await planArtifactResponse(deps);
  assert.ok(plan.kind === "redirect");
  assert.equal(plan.status, 307);
  assert.equal(plan.url, "https://storage.example/signed?token=abc");
  assert.equal(calls.getUser, 1);
  assert.equal(calls.createSignedUrl, 1, "signing runs exactly once");
  assert.deepEqual(seenConfig, CONFIG, "signing receives the parsed config unchanged");
});

test("artifact plan: signed URL never leaks into a failure response", async () => {
  // Regression guard: only the success redirect may carry the signed URL.
  const { deps } = trackedDeps({ createSignedUrl: async () => null });
  const plan = await planArtifactResponse(deps);
  assert.ok(!JSON.stringify(plan).includes("storage.example"));
});
