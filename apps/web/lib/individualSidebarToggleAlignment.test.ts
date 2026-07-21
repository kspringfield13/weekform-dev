import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("the sidebar arrow is optically centered inside its toggle", () => {
  assert.match(
    stylesSource,
    /\.web-sidebar-toggle\s*>\s*span\s*\{[^}]*transform:\s*translateY\(-1px\)\s*;/s,
  );
});
