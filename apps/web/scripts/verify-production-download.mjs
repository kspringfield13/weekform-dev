import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

function requireValue(value, name) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Production download smoke requires ${name}.`);
  return normalized;
}

function requireHttpsOrigin(value, publicError) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      throw new Error(publicError);
    }
    return url.origin;
  } catch {
    throw new Error(publicError);
  }
}

function requireTimeoutMs(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error("The release smoke timeout was invalid.");
  }
  return timeoutMs;
}

function requirePinnedSupabaseOrigin(supabaseUrl, expectedSupabaseOrigin) {
  const configuredOrigin = requireHttpsOrigin(
    supabaseUrl,
    "The configured Supabase origin was invalid.",
  );
  const expectedOrigin = requireHttpsOrigin(
    expectedSupabaseOrigin,
    "The configured Supabase origin was invalid.",
  );
  if (configuredOrigin !== expectedOrigin) {
    throw new Error("The configured Supabase origin was invalid.");
  }
  return configuredOrigin;
}

async function runBounded(publicError, timeoutMs, task) {
  const controller = new AbortController();
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(publicError));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      timeoutPromise,
    ]);
  } catch {
    throw new Error(publicError);
  } finally {
    clearTimeout(timeout);
  }
}

async function hashResponseBody(response, signal) {
  if (!response.ok || !response.body) {
    throw new Error("The private artifact bytes were unavailable.");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARTIFACT_BYTES) {
    throw new Error("The private artifact exceeded the release smoke size limit.");
  }

  const hash = createHash("sha256");
  const reader = response.body.getReader();
  let byteLength = 0;
  const cancelReader = () => {
    if (typeof reader.cancel === "function") {
      try {
        Promise.resolve(reader.cancel()).catch(() => {});
      } catch {
        // A hostile or broken stream must not escape the sanitized stage error.
      }
    }
  };
  signal.addEventListener("abort", cancelReader, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error("The private artifact read timed out.");
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_ARTIFACT_BYTES) {
        await reader.cancel();
        throw new Error("The private artifact exceeded the release smoke size limit.");
      }
      hash.update(value);
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
  if (byteLength === 0) throw new Error("The private artifact was empty.");
  return { byteLength, sha256: hash.digest("hex") };
}

export async function verifyProductionDownloadSurface({
  baseUrl,
  cookieHeader,
  expectedSha256,
  supabaseUrl,
  protectionBypassSecret,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  requireTimeoutMs(timeoutMs);
  const origin = requireHttpsOrigin(baseUrl, "The release smoke base URL was invalid.");
  const expectedSupabaseOrigin = requireHttpsOrigin(
    supabaseUrl,
    "The configured Supabase origin was invalid.",
  );
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("The expected release checksum was invalid.");
  }
  const normalizedBypassSecret = protectionBypassSecret === undefined
    ? undefined
    : requireValue(protectionBypassSecret, "a Vercel automation bypass secret");
  const smokeHostname = new URL(origin).hostname;
  if (
    normalizedBypassSecret &&
    (!smokeHostname.endsWith(".vercel.app") || smokeHostname === "vercel.app")
  ) {
    throw new Error("The Vercel automation bypass target was invalid.");
  }
  const authenticatedHeaders = {
    Cookie: requireValue(cookieHeader, "an authenticated cookie"),
    ...(normalizedBypassSecret
      ? { "x-vercel-protection-bypass": normalizedBypassSecret }
      : {}),
  };

  const { page, pageBody } = await runBounded(
    "The authenticated download page could not be verified.",
    timeoutMs,
    async (signal) => {
      const response = await fetchImpl(`${origin}/download`, {
        headers: authenticatedHeaders,
        redirect: "manual",
        signal,
      });
      return {
        page: response,
        pageBody: response.status === 200 ? await response.text() : "",
      };
    },
  );
  if (
    page.status !== 200 ||
    !pageBody.includes('/download/artifact') ||
    !pageBody.includes("Download now")
  ) {
    throw new Error("The authenticated download page did not present the verified artifact.");
  }

  const bridge = await runBounded(
    "The authenticated artifact route could not be verified.",
    timeoutMs,
    (signal) => fetchImpl(`${origin}/download/artifact`, {
      headers: authenticatedHeaders,
      redirect: "manual",
      signal,
    }),
  );
  const signedLocation = bridge.headers.get("location");
  if (![303, 307].includes(bridge.status) || !signedLocation) {
    throw new Error("The authenticated artifact route did not mint a signed download.");
  }

  let signedUrl;
  try {
    signedUrl = new URL(signedLocation);
    if (
      signedUrl.protocol !== "https:" ||
      signedUrl.origin !== expectedSupabaseOrigin ||
      signedUrl.username ||
      signedUrl.password ||
      signedUrl.hash ||
      !signedUrl.pathname.startsWith("/storage/v1/object/sign/")
    ) {
      throw new Error("invalid");
    }
  } catch {
    throw new Error("The signed download target was invalid.");
  }

  const result = await runBounded(
    "The artifact bytes could not be verified.",
    timeoutMs,
    async (signal) => {
      const artifactResponse = await fetchImpl(signedUrl.href, {
        redirect: "manual",
        signal,
      });
      return hashResponseBody(artifactResponse, signal);
    },
  );
  if (result.sha256 !== expectedSha256) {
    throw new Error("The downloaded artifact checksum did not match the notarized release.");
  }
  return result;
}

export async function authenticatedCookieHeader({
  supabaseUrl,
  expectedSupabaseOrigin,
  anonKey,
  email,
  password,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  requireTimeoutMs(timeoutMs);
  const pinnedSupabaseOrigin = requirePinnedSupabaseOrigin(
    supabaseUrl,
    expectedSupabaseOrigin,
  );
  try {
    return await runBounded(
      "The synthetic release account could not authenticate.",
      timeoutMs,
      async (signal) => {
        const cookies = new Map();
        const client = createServerClient(pinnedSupabaseOrigin, anonKey, {
          global: {
            fetch(input, init = {}) {
              return Promise.resolve()
                .then(() => fetchImpl(input, { ...init, signal }))
                .catch(() => {
                  throw new Error("The authentication request failed.");
                });
            },
          },
          cookies: {
            getAll() {
              return [...cookies].map(([name, value]) => ({ name, value }));
            },
            setAll(updates) {
              for (const { name, value, options } of updates) {
                if (options?.maxAge === 0) cookies.delete(name);
                else cookies.set(name, value);
              }
            },
          },
        });

        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw new Error("authentication failed");
        const cookieHeader = [...cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join("; ");
        return requireValue(cookieHeader, "a synthetic release session");
      },
    );
  } catch {
    throw new Error("The synthetic release account could not authenticate.");
  }
}

async function main() {
  const expectedSha256 = requireValue(process.argv[2], "the expected SHA-256 argument").toLowerCase();
  const baseUrl = requireValue(process.argv[3], "the release smoke base URL");
  const targetKind = requireValue(process.argv[4], "the release smoke target kind");
  const expectedSupabaseOrigin = requireValue(
    process.argv[5],
    "the expected Supabase origin",
  );
  let protectionBypassSecret;
  if (targetKind === "candidate") {
    let candidateOrigin;
    try {
      candidateOrigin = new URL(baseUrl);
    } catch {
      throw new Error("The release candidate URL was invalid.");
    }
    if (
      candidateOrigin.origin !== baseUrl ||
      !candidateOrigin.hostname.endsWith(".vercel.app") ||
      candidateOrigin.hostname === "vercel.app"
    ) {
      throw new Error("The release candidate URL was invalid.");
    }
    protectionBypassSecret = requireValue(
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      "VERCEL_AUTOMATION_BYPASS_SECRET",
    );
  } else if (targetKind === "canonical") {
    if (baseUrl !== "https://weekform.dev") {
      throw new Error("The canonical release smoke origin was invalid.");
    }
  } else {
    throw new Error("The release smoke target kind was invalid.");
  }
  const supabaseUrl = requirePinnedSupabaseOrigin(
    requireValue(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    expectedSupabaseOrigin,
  );
  const cookieHeader = await authenticatedCookieHeader({
    supabaseUrl,
    expectedSupabaseOrigin,
    anonKey: requireValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    email: requireValue(process.env.WEEKFORM_RELEASE_SMOKE_EMAIL, "WEEKFORM_RELEASE_SMOKE_EMAIL"),
    password: requireValue(process.env.WEEKFORM_RELEASE_SMOKE_PASSWORD, "WEEKFORM_RELEASE_SMOKE_PASSWORD"),
  });
  const result = await verifyProductionDownloadSurface({
    baseUrl,
    cookieHeader,
    expectedSha256,
    supabaseUrl,
    protectionBypassSecret,
  });
  process.stdout.write(
    `Release download smoke passed (${result.byteLength} bytes; checksum verified).\n`,
  );
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    // Never print cookies, provider responses, signed URLs, or passwords.
    process.stderr.write(`${error instanceof Error ? error.message : "Production download smoke failed."}\n`);
    process.exitCode = 1;
  });
}
