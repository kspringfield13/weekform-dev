import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const globalsSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const labelUrl = new URL("../components/WebEditionLabel.tsx", import.meta.url);
const lockupSources = [
  "../components/SiteHeader.tsx",
  "../components/SiteFooter.tsx",
  "../components/IndividualWorkspaceShell.tsx",
  "../components/IndividualDashboardBoundaryShell.tsx",
  "../components/WebCompactWorkspace.tsx",
  "../components/WebCompactWindowHandoff.tsx",
].map((path) => ({ path, source: readFileSync(new URL(path, import.meta.url), "utf8") }));
const siteHeaderSource = readFileSync(new URL("../components/SiteHeader.tsx", import.meta.url), "utf8");

test("every Web-owned Weekform lockup uses the shared Web edition label", () => {
  assert.equal(existsSync(labelUrl), true, "the Web treatment must have one shared component");

  for (const lockup of lockupSources) {
    assert.match(
      lockup.source,
      /<WebEditionLabel\b/,
      `${lockup.path} must identify the Web edition with the shared label`,
    );
  }
});

test("the Web edition reads as quiet product context instead of a boxed badge", () => {
  const labelSource = readFileSync(labelUrl, "utf8");

  assert.match(labelSource, />\s*Web\s*</);
  assert.match(labelSource, /className=\{`web-edition-label/);
  assert.match(
    globalsSource,
    /\.web-edition-label\s*\{[^}]*color:\s*var\(--text-subtle\);[^}]*font-size:\s*11px;[^}]*font-weight:\s*550;/s,
  );
  assert.match(globalsSource, /\.web-edition-label::before\s*\{[^}]*width:\s*1px;[^}]*height:\s*14px;/s);
  assert.doesNotMatch(
    globalsSource,
    /\.web-edition-label\s*\{[^}]*(?:border|background|text-transform):/s,
  );
});

test("the public header stays compact and non-wrapping at phone widths", () => {
  assert.match(
    siteHeaderSource,
    /className="button button-primary header-cta">\s*Try Web App\s*<\/Link>/,
  );
  assert.match(
    globalsSource,
    /@media\s*\(max-width:\s*480px\)[\s\S]*?\.wordmark\s+\.web-edition-label[^}]*display:\s*none;[\s\S]*?\.nav-links\s+\.nav-account,[\s\S]*?\.nav-links\s+\.nav-manager-access[^}]*display:\s*none;/,
  );
  assert.match(globalsSource, /\.header-cta\s*\{[^}]*white-space:\s*nowrap;/s);
});
