import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, relative } from "node:path";
import test from "node:test";

const webRoot = new URL("..", import.meta.url);
const launcherSource = readFileSync(
  new URL("../components/MacAppLink.tsx", import.meta.url),
  "utf8",
);
const productEntrySource = readFileSync(
  new URL("./productEntry.ts", import.meta.url),
  "utf8",
);

function tsxFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return tsxFiles(child);
    return extname(entry.name) === ".tsx" ? [child] : [];
  });
}

test("every Web Mac CTA uses the shared prompt-free acquisition or explicit-action link", () => {
  const rawDownloadLinks: string[] = [];
  const launcherFiles: string[] = [];
  const protocolAttemptFiles: string[] = [];

  for (const file of tsxFiles(webRoot)) {
    const source = readFileSync(file, "utf8");
    const relativePath = relative(webRoot.pathname, file.pathname);
    if (/<Link\s+[^>]*href=["']\/download["']/.test(source)) {
      rawDownloadLinks.push(relativePath);
    }
    if (relativePath !== "components/MacAppLink.tsx" && /<MacAppLink\b/.test(source)) {
      launcherFiles.push(relativePath);
    }
    if (/attemptAppOpen=/.test(source)) {
      protocolAttemptFiles.push(relativePath);
    }
  }

  assert.deepEqual(rawDownloadLinks, []);
  assert.ok(launcherFiles.length >= 10, "Mac handoffs across marketing and the Web app must share the launcher");
  assert.deepEqual(protocolAttemptFiles, [], "Web controls never invoke a custom protocol");
});

test("every acquisition link retains the authenticated download page when the app is absent", () => {
  assert.match(launcherSource, /fallbackHref\s*=\s*"\/download"/);
  assert.match(launcherSource, /!openUrl/);
  assert.match(
    productEntrySource,
    /id:\s*"mac"[\s\S]*?href:\s*"\/download"/,
  );
});
