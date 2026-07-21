import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const downloadPage = readFileSync(
  new URL("../app/download/page.tsx", import.meta.url),
  "utf8",
);

test("pending Mac release presents a transparent two-command source install", () => {
  assert.match(
    downloadPage,
    /git clone --depth 1 https:\/\/github\.com\/kspringfield13\/weekform-dev\.git/,
  );
  assert.match(downloadPage, /cd weekform-dev && bash start\.sh/);
  assert.match(downloadPage, /releasePresentation\.kind === "pending"\s*\?\s*\(/);
  assert.match(downloadPage, /href="#source-install"/);
  assert.match(downloadPage, /Install Weekform from source/);
  assert.doesNotMatch(downloadPage, /fallbackHref=/);
  assert.doesNotMatch(downloadPage, /GitHub ZIP/i);
  assert.match(downloadPage, /id="source-install"/);
  assert.doesNotMatch(downloadPage, /archive\/refs\/heads\/main\.zip/);
  assert.doesNotMatch(downloadPage, /curl[^\n]{0,80}\|\s*(?:ba|z)?sh/);
  assert.doesNotMatch(downloadPage, /xattr\s+-[dr]+\s+com\.apple\.quarantine/i);
  assert.match(downloadPage, /Paste these two commands into Terminal/);
  assert.doesNotMatch(downloadPage, /Release notes|First-week tips|Inside the app/);
});
