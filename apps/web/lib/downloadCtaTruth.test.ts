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

test("every Web /download CTA describes acquisition instead of claiming a Mac action", () => {
  const misleading: string[] = [];

  for (const file of tsxFiles(webRoot)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<Link\s+[^>]*href=["']\/download["'][^>]*>([\s\S]*?)<\/Link>/g)) {
      const label = (match[1] ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (/^(?:Open|Review|Generate|Finish)\b/i.test(label)) {
        misleading.push(`${relative(webRoot.pathname, file.pathname)}: ${label}`);
      }
    }
  }

  assert.deepEqual(
    misleading,
    [],
    "the download route can acquire Weekform for Mac but cannot launch it or complete a local action",
  );
});
