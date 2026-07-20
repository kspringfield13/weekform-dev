import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import nextConfig from "../next.config";
import { CANONICAL_WEB_ORIGIN } from "./siteIdentity";

test("weekform.dev is the single canonical Web origin", () => {
  assert.equal(CANONICAL_WEB_ORIGIN, "https://weekform.dev");

  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /metadataBase:\s*new URL\(CANONICAL_WEB_ORIGIN\)/);
});

test("legacy and www host aliases redirect permanently to the canonical origin", async () => {
  assert.equal(typeof nextConfig.redirects, "function");
  const redirects = await nextConfig.redirects!();

  for (const host of ["weekform.com", "www.weekform.com", "www.weekform.dev"]) {
    assert.ok(
      redirects.some((rule) =>
        rule.source === "/:path*"
        && rule.destination === "https://weekform.dev/:path*"
        && rule.permanent === true
        && rule.has?.some((condition) => condition.type === "host" && condition.value === host)
      ),
      `expected ${host} to redirect to weekform.dev`,
    );
  }
});

test("active Web package metadata no longer advertises weekform.com as canonical", () => {
  const activeSources = [
    new URL("../package.json", import.meta.url),
    new URL("../.env.example", import.meta.url),
    new URL("../app/globals.css", import.meta.url),
  ];
  for (const source of activeSources) {
    assert.doesNotMatch(readFileSync(source, "utf8"), /weekform\.com/i);
  }
});
