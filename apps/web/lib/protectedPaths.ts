const PROTECTED_PREFIXES = [
  "/admin",
  "/manager-access",
  "/app",
  "/dashboard",
  "/download",
  "/teams",
];

// This server route owns its authentication response so signed-out requests
// receive a stable 401 and can never turn into an automatic post-login
// download through the proxy's `next` redirect.
const ROUTE_OWNED_AUTH_PATHS = new Set(["/download/artifact"]);

export function isProtectedWebPath(pathname: string): boolean {
  if (ROUTE_OWNED_AUTH_PATHS.has(pathname)) {
    return false;
  }

  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
