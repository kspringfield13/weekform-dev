import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, relative } from "node:path";
import test from "node:test";

const webRoot = new URL("..", import.meta.url);

function tsxFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return tsxFiles(child);
    return extname(entry.name) === ".tsx" ? [child] : [];
  });
}

test("every Web Mac CTA uses the installed-app launcher instead of a raw download link", () => {
  const rawDownloadLinks: string[] = [];
  const launcherFiles: string[] = [];

  for (const file of tsxFiles(webRoot)) {
    const source = readFileSync(file, "utf8");
    const relativePath = relative(webRoot.pathname, file.pathname);
    if (/<Link\s+[^>]*href=["']\/download["']/.test(source)) {
      rawDownloadLinks.push(relativePath);
    }
    if (relativePath !== "components/MacAppLink.tsx" && /<MacAppLink\b/.test(source)) {
      launcherFiles.push(relativePath);
    }
  }

  assert.deepEqual(rawDownloadLinks, []);
  assert.ok(launcherFiles.length >= 10, "Mac handoffs across marketing and the Web app must share the launcher");
});
