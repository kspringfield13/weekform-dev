export function safeNextPath(value: FormDataEntryValue | null | undefined): string {
  // Only allow same-origin relative paths to avoid open redirects.
  // Browsers treat `\` like `/` in redirect locations, so `/\host` is
  // protocol-relative too — reject either character in second position.
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    value[1] !== "/" &&
    value[1] !== "\\"
  ) {
    return value;
  }
  return "/dashboard";
}
