import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginSource = readFileSync(
  new URL("../app/login/page.tsx", import.meta.url),
  "utf8",
);
const headerSource = readFileSync(
  new URL("../components/SiteHeader.tsx", import.meta.url),
  "utf8",
);
const middlewareSource = readFileSync(
  new URL("./supabase/middleware.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("Account remains an active header destination after sign-in", () => {
  assert.match(loginSource, /<h1>Account<\/h1>/);
  assert.match(
    headerSource,
    /<Link[\s\S]*?href="\/login"[\s\S]*?aria-current=\{activePage === "account" \? "page" : undefined\}[\s\S]*?>\s*Account\s*<\/Link>/,
  );
  assert.equal(
    headerSource.match(/href="\/login"/g)?.length,
    1,
    "Account should be one persistent navigation item, not separate signed-in and signed-out links",
  );
  assert.match(loginSource, /<SiteHeader activePage="account" \/>/);
  assert.match(loginSource, /if \(user\) \{[\s\S]*?Signed in as[\s\S]*?action=\{signOut\}/);
  assert.doesNotMatch(
    middlewareSource,
    /AUTH_REDIRECT_PAGES\s*=\s*\[[^\]]*"\/login"/,
  );
});

test("login prioritizes Google and GitHub before Magic Link and password", () => {
  const social = loginSource.indexOf('className="oauth-options"');
  const magicLink = loginSource.indexOf("action={loginWithMagicLink}");
  const password = loginSource.indexOf('className="password-disclosure"');

  assert.ok(social >= 0, "social sign-in options must be rendered");
  assert.ok(magicLink > social, "Magic Link must follow social sign-in");
  assert.ok(password > magicLink, "password sign-in must follow Magic Link");
  assert.match(loginSource, /name="provider" value="google"/);
  assert.match(loginSource, /name="provider" value="github"/);
});

test("a missing magic-link account points directly to account creation", () => {
  assert.match(loginSource, /params\.reason === "account-not-found"/);
  assert.match(loginSource, /No account was found for that email/);
  assert.match(
    loginSource,
    /href={`\/signup\?next=\$\{encodeURIComponent\(next\)\}`}/,
  );
  assert.match(loginSource, />\s*Create an account\s*<\/Link>/);
});

test("email and password sign-in is an accessible disclosure closed by default", () => {
  assert.match(
    loginSource,
    /<details className="password-disclosure">[\s\S]*?<summary[\s\S]*?Use email and password[\s\S]*?<form action=\{login\}>/,
  );
  assert.doesNotMatch(loginSource, /<details className="password-disclosure"\s+open/);
  assert.match(stylesSource, /\.password-disclosure\[open\]/);
  assert.match(stylesSource, /\.password-disclosure-chevron/);
});

test("Google and GitHub buttons have distinct accent treatments", () => {
  assert.match(loginSource, /button-oauth-google/);
  assert.match(loginSource, /button-oauth-github/);
  assert.match(stylesSource, /\.button-oauth-google/);
  assert.match(stylesSource, /\.button-oauth-github/);
});
