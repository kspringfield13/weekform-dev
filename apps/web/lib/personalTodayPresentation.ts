export function reviewProgressPercent(verifiedCount: number, totalCount: number): number {
  if (!Number.isFinite(verifiedCount) || !Number.isFinite(totalCount) || totalCount <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((verifiedCount / totalCount) * 100)));
}

export function presentPersonalToday<T extends { userVerified: boolean }>(blocks: T[]) {
  const reviewQueue = blocks.filter((block) => !block.userVerified);
  const totalCount = blocks.length;
  const verifiedCount = totalCount - reviewQueue.length;
  const heading = totalCount === 0
    ? "No work tracked yet."
    : reviewQueue.length === 0
      ? "All blocks reviewed."
      : `${reviewQueue.length} block${reviewQueue.length === 1 ? " needs" : "s need"} a quick look.`;

  return {
    reviewQueue,
    verifiedCount,
    totalCount,
    progressPct: reviewProgressPercent(verifiedCount, totalCount),
    heading,
  };
}
