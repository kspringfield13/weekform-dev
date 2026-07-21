import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  authenticatedCookieHeader,
  verifyProductionDownloadSurface,
} from "./verify-production-download.mjs";

const SUPABASE_URL = "https://fytospjjbcksmppmvupy.supabase.co";

test("production smoke proves the authenticated page, signed redirect, and exact bytes", async () => {
  const artifact = Buffer.from("synthetic signed Weekform DMG bytes");
  const expectedSha256 = createHash("sha256").update(artifact).digest("hex");
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url) === "https://weekform.dev/download") {
      return new Response('<a href="/download/artifact">Download now</a>', { status: 200 });
    }
    if (String(url) === "https://weekform.dev/download/artifact") {
      return new Response(null, {
        status: 307,
        headers: {
          location: `${SUPABASE_URL}/storage/v1/object/sign/weekform-releases/private-value`,
        },
      });
    }
    if (String(url).startsWith(`${SUPABASE_URL}/storage/v1/object/sign/`)) {
      return new Response(artifact, {
        status: 200,
        headers: { "content-length": String(artifact.length) },
      });
    }
    throw new Error("unexpected request");
  };

  const result = await verifyProductionDownloadSurface({
    baseUrl: "https://weekform.dev",
    cookieHeader: "sb-project-auth-token=private-session",
    expectedSha256,
    supabaseUrl: SUPABASE_URL,
    fetchImpl,
  });

  assert.deepEqual(result, { byteLength: artifact.length, sha256: expectedSha256 });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].init.headers.Cookie, "sb-project-auth-token=private-session");
  assert.equal(requests[0].init.headers["x-vercel-protection-bypass"], undefined);
  assert.equal(requests[1].init.redirect, "manual");
  assert.equal(requests[1].init.headers["x-vercel-protection-bypass"], undefined);
  assert.equal(requests[2].init.redirect, "manual");
  assert.ok(requests.every(({ init }) => init.signal instanceof AbortSignal));
});

test("candidate smoke sends the Vercel automation bypass only to the candidate origin", async () => {
  const artifact = Buffer.from("synthetic candidate DMG bytes");
  const expectedSha256 = createHash("sha256").update(artifact).digest("hex");
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url) === "https://weekform-candidate-blerbz.vercel.app/download") {
      return new Response('<a href="/download/artifact">Download now</a>', { status: 200 });
    }
    if (String(url).endsWith("/download/artifact")) {
      return new Response(null, {
        status: 307,
        headers: { location: `${SUPABASE_URL}/storage/v1/object/sign/private-candidate` },
      });
    }
    return new Response(artifact, {
      status: 200,
      headers: { "content-length": String(artifact.length) },
    });
  };

  await verifyProductionDownloadSurface({
    baseUrl: "https://weekform-candidate-blerbz.vercel.app",
    cookieHeader: "private-cookie",
    expectedSha256,
    supabaseUrl: SUPABASE_URL,
    protectionBypassSecret: "private-bypass-secret",
    fetchImpl,
  });

  assert.equal(requests[0].init.headers["x-vercel-protection-bypass"], "private-bypass-secret");
  assert.equal(requests[1].init.headers["x-vercel-protection-bypass"], "private-bypass-secret");
  assert.equal(requests[2].init.headers, undefined);
});

test("production smoke rejects a Vercel bypass secret for a non-candidate origin", async () => {
  await assert.rejects(
    verifyProductionDownloadSurface({
      baseUrl: "https://weekform.dev",
      cookieHeader: "private-cookie",
      expectedSha256: "a".repeat(64),
      supabaseUrl: SUPABASE_URL,
      protectionBypassSecret: "private-bypass-secret",
      fetchImpl: async () => {
        throw new Error("no request should run");
      },
    }),
    /automation bypass target was invalid/i,
  );
});

test("production smoke fails closed on a checksum mismatch without exposing the signed URL", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/download")) {
      return new Response('<a href="/download/artifact">Download now</a>', { status: 200 });
    }
    if (String(url).endsWith("/download/artifact")) {
      return new Response(null, {
        status: 307,
        headers: { location: `${SUPABASE_URL}/storage/v1/object/sign/private-secret` },
      });
    }
    return new Response("wrong bytes", { status: 200 });
  };

  await assert.rejects(
    verifyProductionDownloadSurface({
      baseUrl: "https://weekform.dev",
      cookieHeader: "private-cookie",
      expectedSha256: "a".repeat(64),
      supabaseUrl: SUPABASE_URL,
      fetchImpl,
    }),
    (error) => {
      assert.match(String(error), /checksum did not match/i);
      assert.doesNotMatch(String(error), /private-secret|private-cookie/);
      return true;
    },
  );
});

test("production smoke rejects non-HTTPS and cross-origin signed redirects without exposing them", async () => {
  for (const signedLocation of [
    "http://fytospjjbcksmppmvupy.supabase.co/storage/v1/object/sign/private?token=secret-http",
    "https://evil.example/storage/v1/object/sign/private?token=secret-cross-origin",
  ]) {
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/download")) {
        return new Response('<a href="/download/artifact">Download now</a>', { status: 200 });
      }
      if (String(url).endsWith("/download/artifact")) {
        return new Response(null, { status: 307, headers: { location: signedLocation } });
      }
      throw new Error(`hostile fetch should not run: ${signedLocation}`);
    };

    await assert.rejects(
      verifyProductionDownloadSurface({
        baseUrl: "https://weekform.dev",
        cookieHeader: "private-cookie",
        expectedSha256: "a".repeat(64),
        supabaseUrl: SUPABASE_URL,
        fetchImpl,
      }),
      (error) => {
        assert.match(String(error), /signed download target was invalid/i);
        assert.doesNotMatch(String(error), /secret-http|secret-cross-origin|private-cookie/);
        return true;
      },
    );
  }
});

test("production smoke sanitizes hostile fetch and artifact-read failures", async () => {
  await assert.rejects(
    verifyProductionDownloadSurface({
      baseUrl: "https://weekform.dev",
      cookieHeader: "private-cookie",
      expectedSha256: "a".repeat(64),
      supabaseUrl: SUPABASE_URL,
      fetchImpl: async () => {
        throw new Error("https://evil.example/?token=fetch-secret private-cookie");
      },
    }),
    (error) => {
      assert.match(String(error), /download page could not be verified/i);
      assert.doesNotMatch(String(error), /fetch-secret|private-cookie/);
      return true;
    },
  );

  const fetchImpl = async (url) => {
    if (String(url).endsWith("/download")) {
      return new Response('<a href="/download/artifact">Download now</a>', { status: 200 });
    }
    if (String(url).endsWith("/download/artifact")) {
      return new Response(null, {
        status: 307,
        headers: { location: `${SUPABASE_URL}/storage/v1/object/sign/private?token=read-secret` },
      });
    }
    return {
      ok: true,
      headers: new Headers(),
      body: {
        getReader() {
          return {
            async read() {
              throw new Error("read-secret private-cookie");
            },
            releaseLock() {},
          };
        },
      },
    };
  };

  await assert.rejects(
    verifyProductionDownloadSurface({
      baseUrl: "https://weekform.dev",
      cookieHeader: "private-cookie",
      expectedSha256: "a".repeat(64),
      supabaseUrl: SUPABASE_URL,
      fetchImpl,
    }),
    (error) => {
      assert.match(String(error), /artifact bytes could not be verified/i);
      assert.doesNotMatch(String(error), /read-secret|private-cookie/);
      return true;
    },
  );
});

test("production smoke aborts a stalled request and reports only a bounded public error", async () => {
  let receivedSignal;
  const fetchImpl = async (_url, init = {}) => {
    receivedSignal = init.signal;
    return await new Promise((_, reject) => {
      const fallback = setTimeout(
        () => reject(new Error("missing-timeout-secret private-cookie")),
        50,
      );
      init.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(fallback);
          reject(new Error("timeout-secret private-cookie"));
        },
        { once: true },
      );
    });
  };

  await assert.rejects(
    verifyProductionDownloadSurface({
      baseUrl: "https://weekform.dev",
      cookieHeader: "private-cookie",
      expectedSha256: "a".repeat(64),
      supabaseUrl: SUPABASE_URL,
      fetchImpl,
      timeoutMs: 10,
    }),
    (error) => {
      assert.match(String(error), /download page could not be verified/i);
      assert.doesNotMatch(String(error), /timeout-secret|private-cookie/);
      return true;
    },
  );
  assert.equal(receivedSignal?.aborted, true);
});

test("synthetic authentication is timeout-bounded and never exposes provider errors", async () => {
  let receivedSignal;
  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...values) => {
    loggedErrors.push(values.map(String).join(" "));
  };
  const fetchImpl = async (_url, init = {}) => {
    receivedSignal = init.signal;
    return await new Promise((_, reject) => {
      const fallback = setTimeout(
        () => reject(new Error("missing-auth-timeout-secret release-password")),
        50,
      );
      init.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(fallback);
          reject(new Error("auth-timeout-secret release-password"));
        },
        { once: true },
      );
    });
  };

  try {
    await assert.rejects(
      authenticatedCookieHeader({
        supabaseUrl: SUPABASE_URL,
        expectedSupabaseOrigin: SUPABASE_URL,
        anonKey: "synthetic-anon-key",
        email: "synthetic@example.test",
        password: "release-password",
        fetchImpl,
        timeoutMs: 10,
      }),
      (error) => {
        assert.match(String(error), /synthetic release account could not authenticate/i);
        assert.doesNotMatch(String(error), /auth-timeout-secret|release-password/);
        return true;
      },
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(receivedSignal?.aborted, true);
  assert.doesNotMatch(loggedErrors.join("\n"), /auth-timeout-secret|release-password/);
});

test("synthetic authentication sanitizes synchronous provider failures before provider logging", async () => {
  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...values) => {
    loggedErrors.push(values.map(String).join(" "));
  };
  try {
    await assert.rejects(
      authenticatedCookieHeader({
        supabaseUrl: SUPABASE_URL,
        expectedSupabaseOrigin: SUPABASE_URL,
        anonKey: "synthetic-anon-key",
        email: "synthetic@example.test",
        password: "release-password",
        fetchImpl() {
          throw new Error("sync-auth-secret release-password");
        },
      }),
      /synthetic release account could not authenticate/i,
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.doesNotMatch(loggedErrors.join("\n"), /sync-auth-secret|release-password/);
});

test("synthetic authentication rejects an unpinned Supabase origin before sending credentials", async () => {
  for (const supabaseUrl of [
    "http://fytospjjbcksmppmvupy.supabase.co",
    "https://attacker.example",
    "https://fytospjjbcksmppmvupy.supabase.co/credential-collector",
    "https://release-password@fytospjjbcksmppmvupy.supabase.co",
  ]) {
    let fetchCalled = false;
    await assert.rejects(
      authenticatedCookieHeader({
        supabaseUrl,
        expectedSupabaseOrigin: SUPABASE_URL,
        anonKey: "synthetic-anon-key",
        email: "synthetic@example.test",
        password: "release-password",
        fetchImpl: async () => {
          fetchCalled = true;
          throw new Error("credentials escaped");
        },
      }),
      /configured Supabase origin was invalid/i,
    );
    assert.equal(fetchCalled, false);
  }
});
