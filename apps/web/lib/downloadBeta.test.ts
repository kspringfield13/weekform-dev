// RED specification for the temporary, account-gated Mac beta channel.
// Production implementation intentionally follows in a separate TDD step.
// Run: node --import tsx --test apps/web/lib/downloadBeta.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import * as downloadModule from "./download";
import { isProtectedWebPath } from "./protectedPaths";

const BETA_FILENAME = "Weekform_0.1.0_universal_Beta.dmg";
const BETA_ROUTE = "/download/beta";

const BETA_ENV = {
  WEEKFORM_BETA_ARTIFACT_BUCKET: "weekform-releases",
  WEEKFORM_BETA_ARTIFACT_PATH:
    `releases/beta/${"b".repeat(64)}/${BETA_FILENAME}`,
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  WEEKFORM_BETA_ARTIFACT_DEVELOPER_ID_SIGNED: "true",
  WEEKFORM_BETA_ARTIFACT_SHA256: "b".repeat(64),
  WEEKFORM_BETA_ARTIFACT_VERIFIED_AT: "2026-07-20T19:30:00.000Z",
};

type BetaArtifactConfig = {
  bucket: string;
  path: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  signedUrlTtlSeconds: number;
  releaseProof: {
    developerIdSigned: true;
    sha256: string;
    verifiedAt: string;
  };
};

type BetaReleasePresentation = {
  kind: "beta";
  title: "Beta Version";
  action: { label: "Download Beta"; href: typeof BETA_ROUTE };
  filename: typeof BETA_FILENAME;
  disclosure: string;
};

type BetaArtifactPlan =
  | {
      kind: "json";
      status: 401 | 503;
      body: { error: string; message: string };
    }
  | { kind: "redirect"; status: 303 | 307; url: string };

type ExpectedBetaExports = {
  BETA_RELEASE_INFO: {
    artifactFilename: typeof BETA_FILENAME;
  };
  parseBetaArtifactConfig: (
    env: Record<string, string | undefined>,
  ) => BetaArtifactConfig | null;
  getBetaReleasePresentation: (
    config: BetaArtifactConfig,
  ) => BetaReleasePresentation;
  planBetaArtifactResponse: (deps: {
    supabaseConfigured: boolean;
    getUser: () => Promise<{ userId: string | null }>;
    config: BetaArtifactConfig | null;
    officialConfig?: downloadModule.ArtifactConfig | null;
    createSignedUrl: (config: BetaArtifactConfig) => Promise<string | null>;
    requestUrl: string;
  }) => Promise<BetaArtifactPlan>;
};

const betaExports = downloadModule as unknown as Partial<ExpectedBetaExports>;

function requireBetaExport<Key extends keyof ExpectedBetaExports>(
  name: Key,
): ExpectedBetaExports[Key] {
  const value = betaExports[name];
  assert.notEqual(
    value,
    undefined,
    `download.ts must export ${name} for the separate beta channel`,
  );
  return value as ExpectedBetaExports[Key];
}

test("official release remains fail-closed when only a signed, unnotarized beta exists", () => {
  const officialWithoutNotarization = {
    WEEKFORM_ARTIFACT_BUCKET: "weekform-releases",
    WEEKFORM_ARTIFACT_PATH: "releases/Weekform_0.1.0_universal.dmg",
    NEXT_PUBLIC_SUPABASE_URL: BETA_ENV.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: BETA_ENV.SUPABASE_SERVICE_ROLE_KEY,
    WEEKFORM_ARTIFACT_DEVELOPER_ID_SIGNED: "true",
    WEEKFORM_ARTIFACT_SHA256: "a".repeat(64),
    WEEKFORM_ARTIFACT_VERIFIED_AT: "2026-07-20T19:30:00.000Z",
  };

  assert.equal(downloadModule.parseArtifactConfig(officialWithoutNotarization), null);
  const officialPresentation = downloadModule.getReleasePresentation(null);
  assert.equal(officialPresentation.kind, "pending");
  assert.equal(officialPresentation.action.href, "/app");
});

test("beta config requires its explicit signed flag, path, hash, and timestamp", () => {
  const parseBetaArtifactConfig = requireBetaExport("parseBetaArtifactConfig");

  for (const key of [
    "WEEKFORM_BETA_ARTIFACT_DEVELOPER_ID_SIGNED",
    "WEEKFORM_BETA_ARTIFACT_PATH",
    "WEEKFORM_BETA_ARTIFACT_SHA256",
    "WEEKFORM_BETA_ARTIFACT_VERIFIED_AT",
  ] as const) {
    assert.equal(
      parseBetaArtifactConfig({ ...BETA_ENV, [key]: undefined }),
      null,
      `beta must remain unavailable when ${key} is missing`,
    );
  }

  assert.equal(
    parseBetaArtifactConfig({
      ...BETA_ENV,
      WEEKFORM_BETA_ARTIFACT_DEVELOPER_ID_SIGNED: "false",
    }),
    null,
    "the beta channel must require an explicit true signing attestation",
  );
  assert.equal(
    parseBetaArtifactConfig({
      ...BETA_ENV,
      WEEKFORM_BETA_ARTIFACT_PATH: "releases/beta/Weekform_0.1.0_universal.dmg",
    }),
    null,
    "the beta path must resolve to the beta-specific filename",
  );
});

test("a Developer-ID-signed beta parses without claiming notarization", () => {
  const parseBetaArtifactConfig = requireBetaExport("parseBetaArtifactConfig");
  const config = parseBetaArtifactConfig(BETA_ENV);

  assert.ok(config);
  assert.equal(config.path.split("/").at(-1), BETA_FILENAME);
  assert.deepEqual(config.releaseProof, {
    developerIdSigned: true,
    sha256: "b".repeat(64),
    verifiedAt: "2026-07-20T19:30:00.000Z",
  });
  assert.equal("notarized" in config.releaseProof, false);
  assert.equal("stapled" in config.releaseProof, false);
});

test("beta config binds its content-addressed object path to the declared SHA", () => {
  const parseBetaArtifactConfig = requireBetaExport("parseBetaArtifactConfig");

  assert.equal(
    parseBetaArtifactConfig({
      ...BETA_ENV,
      WEEKFORM_BETA_ARTIFACT_PATH:
        `releases/beta/${"a".repeat(64)}/${BETA_FILENAME}`,
    }),
    null,
    "a mismatched object path must never support checksum-verified copy",
  );
  assert.ok(parseBetaArtifactConfig(BETA_ENV));
});

test("beta presentation uses the exact label, action, filename, and unnotarized disclosure", () => {
  const betaReleaseInfo = requireBetaExport("BETA_RELEASE_INFO");
  const parseBetaArtifactConfig = requireBetaExport("parseBetaArtifactConfig");
  const getBetaReleasePresentation = requireBetaExport(
    "getBetaReleasePresentation",
  );
  const config = parseBetaArtifactConfig(BETA_ENV);
  assert.ok(config);

  const presentation = getBetaReleasePresentation(config);
  assert.equal(betaReleaseInfo.artifactFilename, BETA_FILENAME);
  assert.equal(presentation.kind, "beta");
  assert.equal(presentation.title, "Beta Version");
  assert.equal(presentation.action.label, "Download Beta");
  assert.equal(presentation.action.href, BETA_ROUTE);
  assert.equal(presentation.filename, BETA_FILENAME);
  assert.match(
    presentation.disclosure,
    /not Apple-notarized or stapled/i,
  );
  assert.doesNotMatch(presentation.disclosure, /notarization is pending/i);
});

test("download page renders the separate beta presentation without the old preview label", () => {
  const source = readFileSync(
    new URL("../app/download/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /parseBetaArtifactConfig/);
  assert.match(source, /getBetaReleasePresentation/);
  assert.match(source, /betaReleasePresentation/);
  assert.doesNotMatch(source, /Developer Preview\s*[—-]\s*notarization pending/i);
});

test("beta route owns auth so signed-out requests receive 401 instead of a login download redirect", () => {
  assert.equal(
    isProtectedWebPath(BETA_ROUTE),
    false,
    "the beta artifact route must perform its own server-side session check",
  );
});

test("beta response is authenticated and never mints a signed URL for a signed-out request", async () => {
  const planBetaArtifactResponse = requireBetaExport("planBetaArtifactResponse");
  const parseBetaArtifactConfig = requireBetaExport("parseBetaArtifactConfig");
  const config = parseBetaArtifactConfig(BETA_ENV);
  assert.ok(config);
  let signedUrlCalls = 0;

  const response = await planBetaArtifactResponse({
    supabaseConfigured: true,
    getUser: async () => ({ userId: null }),
    config,
    createSignedUrl: async () => {
      signedUrlCalls += 1;
      return "https://storage.example/should-not-be-created";
    },
    requestUrl: `https://weekform.dev${BETA_ROUTE}`,
  });

  assert.equal(response.kind, "json");
  assert.equal(response.status, 401);
  if (response.kind === "json") {
    assert.equal(response.body.error, "unauthenticated");
  }
  assert.equal(signedUrlCalls, 0);
});

test("configured beta returns only a short-lived private signed-URL redirect", async () => {
  const planBetaArtifactResponse = requireBetaExport("planBetaArtifactResponse");
  const parseBetaArtifactConfig = requireBetaExport("parseBetaArtifactConfig");
  const config = parseBetaArtifactConfig(BETA_ENV);
  assert.ok(config);

  const response = await planBetaArtifactResponse({
    supabaseConfigured: true,
    getUser: async () => ({ userId: "beta-user" }),
    config,
    createSignedUrl: async () =>
      "https://example.supabase.co/storage/v1/object/sign/weekform-releases/beta?token=short-lived",
    requestUrl: `https://weekform.dev${BETA_ROUTE}`,
  });

  assert.deepEqual(response, {
    kind: "redirect",
    status: 307,
    url: "https://example.supabase.co/storage/v1/object/sign/weekform-releases/beta?token=short-lived",
  });
});

test("an available official release retires the direct beta route without minting a beta URL", async () => {
  const planBetaArtifactResponse = requireBetaExport("planBetaArtifactResponse");
  const parseBetaArtifactConfig = requireBetaExport("parseBetaArtifactConfig");
  const config = parseBetaArtifactConfig(BETA_ENV);
  assert.ok(config);
  const officialConfig = downloadModule.parseArtifactConfig({
    WEEKFORM_ARTIFACT_BUCKET: "weekform-releases",
    WEEKFORM_ARTIFACT_PATH: "releases/Weekform_0.1.0_universal.dmg",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    WEEKFORM_ARTIFACT_DEVELOPER_ID_SIGNED: "true",
    WEEKFORM_ARTIFACT_NOTARIZED: "true",
    WEEKFORM_ARTIFACT_STAPLED: "true",
    WEEKFORM_ARTIFACT_SHA256: "c".repeat(64),
    WEEKFORM_ARTIFACT_VERIFIED_AT: "2026-07-20T20:00:00.000Z",
  });
  assert.ok(officialConfig);
  let betaSigningCalls = 0;

  const response = await planBetaArtifactResponse({
    supabaseConfigured: true,
    getUser: async () => ({ userId: "signed-in-user" }),
    config,
    officialConfig,
    createSignedUrl: async () => {
      betaSigningCalls += 1;
      return "https://storage.example/obsolete-beta";
    },
    requestUrl: `https://weekform.dev${BETA_ROUTE}`,
  });

  assert.deepEqual(response, {
    kind: "redirect",
    status: 303,
    url: "https://weekform.dev/download/artifact",
  });
  assert.equal(betaSigningCalls, 0);
});

test("beta route is private/no-store, forces the beta filename, and has no public fallback", () => {
  const routeUrl = new URL("../app/download/beta/route.ts", import.meta.url);
  assert.ok(existsSync(routeUrl), "the separate /download/beta route must exist");

  const source = readFileSync(routeUrl, "utf8");
  assert.match(source, /getUser\(\)/);
  assert.match(
    source,
    /Cache-Control["']:\s*["']private, no-store, max-age=0["']/,
  );
  assert.match(source, /download:\s*BETA_RELEASE_INFO\.artifactFilename/);
  assert.doesNotMatch(
    source,
    /BUNDLED_ARTIFACT|bundledArtifactUrl|\/downloads\/|NextResponse\.rewrite/,
  );

  const publicRoot = new URL("../public", import.meta.url);
  const publicDmgs = existsSync(publicRoot)
    ? readdirSync(publicRoot, { recursive: true })
      .map(String)
      .filter((path) => path.toLowerCase().endsWith(".dmg"))
    : [];
  assert.deepEqual(publicDmgs, [], "no beta DMG may be copied into public/");
});
