import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CANONICAL_WEB_ORIGIN } from "./siteIdentity";
import { resolveTeamInviteOrigin } from "./teamInviteOrigin";

test("production team invites ignore hostile forwarded and Host headers", () => {
  const headers = new Headers({
    host: "attacker.example",
    "x-forwarded-host": "phishing.example",
    "x-forwarded-proto": "http",
  });

  assert.equal(
    resolveTeamInviteOrigin(headers, { nodeEnv: "production" }),
    CANONICAL_WEB_ORIGIN,
  );
});

test("development permits only explicit localhost and 127.0.0.1 Host origins", () => {
  assert.equal(
    resolveTeamInviteOrigin(new Headers({ host: "localhost:3000" }), {
      nodeEnv: "development",
    }),
    "http://localhost:3000",
  );
  assert.equal(
    resolveTeamInviteOrigin(new Headers({ host: "127.0.0.1:5173" }), {
      nodeEnv: "development",
    }),
    "http://127.0.0.1:5173",
  );

  for (const host of [
    "localhost.evil.example",
    "127.0.0.1.evil.example",
    "0.0.0.0:3000",
    "[::1]:3000",
    "attacker.example",
  ]) {
    assert.equal(
      resolveTeamInviteOrigin(new Headers({ host }), { nodeEnv: "development" }),
      CANONICAL_WEB_ORIGIN,
    );
  }
});

test("loopback invite origins remain disabled outside explicit development mode", () => {
  for (const environment of [{}, { nodeEnv: "test" }]) {
    assert.equal(
      resolveTeamInviteOrigin(new Headers({ host: "localhost:3000" }), environment),
      CANONICAL_WEB_ORIGIN,
    );
  }
});

test("a hostile forwarded host cannot override a valid development Host header", () => {
  assert.equal(
    resolveTeamInviteOrigin(new Headers({
      host: "localhost:3000",
      "x-forwarded-host": "phishing.example",
      "x-forwarded-proto": "https",
    }), { nodeEnv: "development" }),
    "http://localhost:3000",
  );
});

test("an exact Vercel preview deployment URL is allowed only in preview", () => {
  const preview = "weekform-git-security-synthetic.vercel.app";
  assert.equal(
    resolveTeamInviteOrigin(new Headers({ host: "attacker.example" }), {
      nodeEnv: "production",
      vercelEnv: "preview",
      vercelUrl: preview,
    }),
    `https://${preview}`,
  );
  assert.equal(
    resolveTeamInviteOrigin(new Headers(), {
      nodeEnv: "production",
      vercelEnv: "production",
      vercelUrl: preview,
    }),
    CANONICAL_WEB_ORIGIN,
  );
});

test("malformed or non-Vercel preview configuration fails closed", () => {
  for (const vercelUrl of [
    "https://weekform-preview.vercel.app",
    "weekform-preview.vercel.app/path",
    "weekform..vercel.app",
    "weekform-preview.vercel.app.attacker.example",
    "weekform-preview.vercel.app@attacker.example",
    "localhost:3000",
  ]) {
    assert.equal(
      resolveTeamInviteOrigin(new Headers({ host: "localhost:3000" }), {
        nodeEnv: "production",
        vercelEnv: "preview",
        vercelUrl,
      }),
      CANONICAL_WEB_ORIGIN,
    );
  }
});

test("the team invite action uses the pinned origin resolver, not proxy host headers", () => {
  const source = readFileSync(new URL("../app/teams/actions.ts", import.meta.url), "utf8");

  assert.match(source, /resolveTeamInviteOrigin/);
  assert.doesNotMatch(source, /headerList\.get\("x-forwarded-(?:host|proto)"\)/);
});
