import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readBoundedRequestText } from "./boundedRequestText";

function requestWithChunks(
  chunks: string[],
  headers: Record<string, string> = {},
): {
  request: Pick<Request, "body" | "headers">;
  wasCancelled: () => boolean;
} {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  let nextChunk = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      const chunk = encoded[nextChunk];
      nextChunk += 1;
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return {
    request: { body, headers: new Headers(headers) },
    wasCancelled: () => cancelled,
  };
}

test("bounded reader counts streamed UTF-8 bytes without requiring Content-Length", async () => {
  const fixture = requestWithChunks(["caf", "é"]);
  const result = await readBoundedRequestText(fixture.request, 5);

  assert.deepEqual(result, { status: "ok", text: "café", byteLength: 5 });
  assert.equal(fixture.wasCancelled(), false);
});

test("bounded reader cancels a dishonest stream as soon as its real bytes exceed the limit", async () => {
  const fixture = requestWithChunks(["1234", "5", "never-read"], {
    "content-length": "1",
  });
  const result = await readBoundedRequestText(fixture.request, 4);

  assert.deepEqual(result, { status: "too_large" });
  assert.equal(fixture.wasCancelled(), true);
});

test("bounded reader cancels an announced oversized request before consuming it", async () => {
  const fixture = requestWithChunks(["not-consumed"], { "content-length": "99" });
  const result = await readBoundedRequestText(fixture.request, 8);

  assert.deepEqual(result, { status: "too_large" });
  assert.equal(fixture.wasCancelled(), true);
});

test("bounded reader rejects digit-only Content-Length values beyond safe integer range", async () => {
  const fixture = requestWithChunks(["tiny"], {
    "content-length": "9007199254740993",
  });
  const result = await readBoundedRequestText(fixture.request, 8);

  assert.deepEqual(result, { status: "too_large" });
  assert.equal(fixture.wasCancelled(), true);
});

test("bounded reader reports stream failures as invalid input", async () => {
  const request = {
    headers: new Headers(),
    body: new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        controller.error(new Error("synthetic read failure"));
      },
    }),
  };

  assert.deepEqual(await readBoundedRequestText(request, 8), { status: "invalid" });
});

test("bounded reader treats an absent body as an empty bounded payload", async () => {
  assert.deepEqual(
    await readBoundedRequestText({ headers: new Headers(), body: null }, 8),
    { status: "ok", text: "", byteLength: 0 },
  );
});

test("both sensitive routes use the streaming limiter with their fixed byte ceilings", () => {
  const personalRoute = readFileSync(
    new URL("../app/api/personal-agent/route.ts", import.meta.url),
    "utf8",
  );
  const webexRoute = readFileSync(
    new URL("../app/api/oauth/webex/token/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(personalRoute, /const MAX_REQUEST_BYTES = 2_048;/);
  assert.match(webexRoute, /const MAX_REQUEST_BYTES = 16_384;/);
  for (const source of [personalRoute, webexRoute]) {
    assert.match(source, /readBoundedRequestText\(request, MAX_REQUEST_BYTES\)/);
    assert.doesNotMatch(source, /request\.(?:json|text)\(\)/);
  }
});

test("every Personal Agent response passes through one no-store response helper", () => {
  const source = readFileSync(
    new URL("../app/api/personal-agent/route.ts", import.meta.url),
    "utf8",
  );
  const jsonResponseCalls = source.match(/NextResponse\.json\(/g) ?? [];

  assert.equal(jsonResponseCalls.length, 1);
  assert.match(source, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(source, /headers: \{ \.\.\.NO_STORE_HEADERS, \.\.\.extraHeaders \}/);
});
