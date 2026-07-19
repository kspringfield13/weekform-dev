const PROTECTED_PREFIXES = ["/admin", "/dashboard", "/download", "/teams"];

export function isProtectedWebPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
