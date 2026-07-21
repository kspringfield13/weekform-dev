import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("the narrow Individual drawer keeps Settings touch-ready beside its route targets", () => {
  assert.match(
    globalStyles,
    /@media \(max-width: 820px\)[\s\S]*?\.web-individual-app \.settings-button\s*\{[^}]*display:\s*inline-flex[^}]*min-height:\s*44px[^}]*\}/,
    "Settings is a primary drawer destination and must preserve the same 44px minimum target as the mobile opener and close control",
  );
  assert.match(
    globalStyles,
    /@media \(max-width: 820px\)[\s\S]*?\.web-open-desktop-button\s*\{[^}]*width:\s*44px[^}]*min-height:\s*44px[^}]*\}/,
    "the icon-only Desktop handoff must remain a full touch target in the mobile drawer",
  );
  assert.match(
    globalStyles,
    /@media \(max-width: 820px\)[\s\S]*?\.web-sidebar-footer-actions\s*\{[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\)[^}]*\}/,
    "the mobile footer grid must reserve the handoff button's full 44px target without overlapping Settings",
  );
});
