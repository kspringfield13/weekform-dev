import assert from "node:assert/strict";
import test from "node:test";

import { assertLinkedMigrationsMatch } from "./assert-linked-migrations.mjs";

test("linked migration proof accepts exact local and remote equality", () => {
  const result = assertLinkedMigrationsMatch(JSON.stringify({
    migrations: [
      { local: "202607200009", remote: "202607200009" },
      { local: "202607200010", remote: "202607200010" },
    ],
  }));
  assert.equal(result, 2);
});

test("linked migration proof fails closed for local-only or remote-only rows", () => {
  assert.throws(
    () => assertLinkedMigrationsMatch(JSON.stringify({
      migrations: [{ local: "202607200010", remote: "" }],
    })),
    /linked migration drift/i,
  );
  assert.throws(
    () => assertLinkedMigrationsMatch(JSON.stringify({
      migrations: [{ local: "", remote: "202607200011" }],
    })),
    /linked migration drift/i,
  );
});
