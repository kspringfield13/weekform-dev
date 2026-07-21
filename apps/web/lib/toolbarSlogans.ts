export const README_TOOLBAR_SLOGANS = [
  "Know what fits before you commit.",
  "The moment before you say yes",
  "Can you take this on next week?",
] as const;

export const INDIVIDUAL_TOOLBAR_SLOGANS = [
  "Your week, ready to take shape",
  ...README_TOOLBAR_SLOGANS,
] as const;

export const TOOLBAR_SLOGAN_INTERVAL_MS = 6_500;

export function nextToolbarSloganIndex(currentIndex: number): number {
  return (currentIndex + 1) % INDIVIDUAL_TOOLBAR_SLOGANS.length;
}
