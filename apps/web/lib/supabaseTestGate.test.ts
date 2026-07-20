import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rootPackage = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string> };

test("static Web checks and executable Supabase RLS checks have separate named gates", () => {
  const scripts = rootPackage.scripts ?? {};
  assert.equal(
    scripts["test:web:static"],
    "node --import tsx --test apps/web/lib/*.test.ts",
  );
  assert.equal(scripts["test:web"], "npm run test:web:static");
  assert.equal(
    scripts["test:supabase:rls"],
    "supabase test db --local supabase/tests",
  );
  assert.equal(
    scripts["verify:web:release"],
    "npm run test:web:static && npm run test:supabase:rls && npm run web:build",
  );
});

test("the personal replica production smoke is a real pgTAP test", () => {
  const source = readFileSync(
    new URL("../../../supabase/tests/personal_replica_production_smoke.sql", import.meta.url),
    "utf8",
  );
  assert.match(source, /select plan\(\d+\)/i);
  assert.match(source, /select \* from finish\(\)/i);
  assert.doesNotMatch(source, /select 'production verification passed'/i);
});

test("static SQL source inspections do not call themselves live database proof", () => {
  for (const path of ["adminPortalMigration.test.ts", "teamActionsMigration.test.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /test\(["'`]live\b/i);
  }
});
