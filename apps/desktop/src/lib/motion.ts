// Best-effort read of the OS "reduce motion" accessibility preference. Guarded
// for environments without `matchMedia` (older/embedded webviews) — treats a
// missing/erroring media API as "motion is fine" (false) so behavior is
// unchanged there.
//
// Why this exists: the global `@media (prefers-reduced-motion: reduce)` reset in
// `styles.css` sets `scroll-behavior: auto !important`, but that CSS property is
// only consulted by a JS scroll call whose `behavior` is `"auto"`. A call that
// passes `behavior: "smooth"` EXPLICITLY wins over the CSS property (CSSOM View
// spec), so a reduced-motion user would still get an animated scroll. Gate any
// explicit `behavior: "smooth"` on this helper — read it at call time so it
// reflects the user's current OS setting, not a value captured at mount.
function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

// Resolve the `behavior` option for a programmatic scroll so it honors the
// reduced-motion preference: "auto" (instant jump) when the user asked to reduce
// motion, "smooth" otherwise.
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
