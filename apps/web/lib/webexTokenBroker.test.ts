import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWebexTokenExchange,
  projectWebexTokenResponse,
  resolveWebexBrokerReadiness,
  type WebexBrokerConfig,
} from "./webexTokenBroker";

const config: WebexBrokerConfig = {
  clientId: "synthetic-webex-client",
  clientSecret: "SERVER_ONLY_SYNTHETIC_SECRET",
  redirectUri: "http://127.0.0.1:49323/chat-auth/callback",
};

test("broker stays unavailable until deployment security controls are explicitly verified", () => {
  for (const securityVerified of [undefined, "", "false", "1", "TRUE", " true "]) {
    assert.deepEqual(resolveWebexBrokerReadiness({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      securityVerified,
    }), {
      ready: false,
      reason: "security_unverified",
    });
  }

  assert.deepEqual(resolveWebexBrokerReadiness({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    securityVerified: "true",
  }), {
    ready: true,
    config,
  });
});

test("security verification does not make an incomplete broker configuration ready", () => {
  assert.deepEqual(resolveWebexBrokerReadiness({
    clientId: config.clientId,
    clientSecret: "",
    redirectUri: config.redirectUri,
    securityVerified: "true",
  }), {
    ready: false,
    reason: "configuration_missing",
  });
});

test("authorization-code exchange is fixed to the configured client and redirect", () => {
  const exchange = buildWebexTokenExchange({
    grantType: "authorization_code",
    clientId: config.clientId,
    code: "synthetic-one-time-code",
    redirectUri: config.redirectUri,
    codeVerifier: "v".repeat(64),
  }, config);

  assert.equal(exchange.endpoint, "https://webexapis.com/v1/access_token");
  assert.equal(exchange.form.get("client_id"), config.clientId);
  assert.equal(exchange.form.get("client_secret"), config.clientSecret);
  assert.equal(exchange.form.get("redirect_uri"), config.redirectUri);
  assert.equal(exchange.form.get("grant_type"), "authorization_code");
  assert.equal(exchange.form.get("code_verifier"), "v".repeat(64));
});

test("refresh exchange accepts only the configured client and a bounded token", () => {
  const exchange = buildWebexTokenExchange({
    grantType: "refresh_token",
    clientId: config.clientId,
    refreshToken: "synthetic-refresh-token",
  }, config);
  assert.equal(exchange.form.get("grant_type"), "refresh_token");
  assert.equal(exchange.form.get("refresh_token"), "synthetic-refresh-token");
  assert.equal(exchange.form.has("redirect_uri"), false);
});

test("broker rejects client substitution, redirect substitution, extra fields, and malformed PKCE", () => {
  for (const payload of [
    { grantType: "refresh_token", clientId: "attacker-client", refreshToken: "token" },
    {
      grantType: "authorization_code",
      clientId: config.clientId,
      code: "code",
      redirectUri: "http://127.0.0.1:49999/chat-auth/callback",
      codeVerifier: "v".repeat(64),
    },
    { grantType: "refresh_token", clientId: config.clientId, refreshToken: "token", message: "private" },
    {
      grantType: "authorization_code",
      clientId: config.clientId,
      code: "code",
      redirectUri: config.redirectUri,
      codeVerifier: "too-short",
    },
  ]) {
    assert.throws(() => buildWebexTokenExchange(payload, config));
  }
});

test("upstream response projection returns tokens only and drops all unrelated provider fields", () => {
  const projected = projectWebexTokenResponse({
    access_token: "access",
    refresh_token: "refresh",
    expires_in: 3600,
    refresh_token_expires_in: 7_776_000,
    message: "PRIVATE_PROVIDER_VALUE",
    personEmail: "private@example.test",
  });

  assert.deepEqual(projected, {
    accessToken: "access",
    refreshToken: "refresh",
    expiresIn: 3600,
    refreshTokenExpiresIn: 7_776_000,
  });
  assert.equal(JSON.stringify(projected).includes("PRIVATE_PROVIDER_VALUE"), false);
  assert.equal(JSON.stringify(projected).includes("private@example.test"), false);
});
