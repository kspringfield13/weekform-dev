export function buildContentSecurityPolicy({
  development,
  supabaseUrl,
  nonce,
}: {
  development: boolean;
  supabaseUrl?: string;
  nonce?: string;
}): string {
  if (nonce && !/^[A-Za-z0-9+/_=-]{16,256}$/.test(nonce)) {
    throw new Error("The CSP nonce is invalid.");
  }

  const scriptSources = nonce
    ? ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
    : ["'self'", "'unsafe-inline'"];
  const connectSources = [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
  ];
  const imageSources = ["'self'", "data:", "blob:", "https://*.supabase.co"];

  if (supabaseUrl) {
    try {
      const configuredOrigin = new URL(supabaseUrl);
      if (configuredOrigin.protocol === "https:") {
        connectSources.push(
          configuredOrigin.origin,
          `wss://${configuredOrigin.host}`,
        );
        imageSources.push(configuredOrigin.origin);
      } else if (development && configuredOrigin.protocol === "http:") {
        connectSources.push(
          configuredOrigin.origin,
          `ws://${configuredOrigin.host}`,
        );
        imageSources.push(configuredOrigin.origin);
      }
    } catch {
      // Invalid configuration remains unavailable; never widen CSP for it.
    }
  }

  if (development) {
    scriptSources.push("'unsafe-eval'");
    connectSources.push(
      "http://127.0.0.1:*",
      "ws://127.0.0.1:*",
      "http://localhost:*",
      "ws://localhost:*",
    );
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSources.join(" ")}`,
    // Weekform still uses deliberate React style attributes for data-driven
    // geometry. Script execution is nonce-strict; style attributes remain the
    // one explicit inline allowance until those primitives are CSS-variable-only.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${[...new Set(imageSources)].join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${[...new Set(connectSources)].join(" ")}`,
    "media-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
