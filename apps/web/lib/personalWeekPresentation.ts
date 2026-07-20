export interface CapacityCoverageInput {
  committedUtilizationPct: number;
  reliableNewWorkCapacityPct: number;
}

export interface CapacityCoverage {
  committedPct: number;
  availablePct: number;
  protectedPct: number;
}

export interface ReplicaCategoryInput {
  category: string;
  estimatedCapacityPct: number;
}

export interface ReplicaCategorySummary {
  label: string;
  capacityPct: number;
  sharePct: number;
}

export interface ReplicaModeInput {
  mode: string;
  estimatedCapacityPct: number;
}

export interface ReplicaModeSummary {
  label: string;
  capacityPct: number;
  sharePct: number;
}

export function safePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function displayPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, value));
}

export function ratioScorePercent(value: number): number {
  return Math.round(safePercent(value * 100));
}

export function isElevatedRatioScore(value: number, threshold: number): boolean {
  return Number.isFinite(value) && Number.isFinite(threshold) && value >= threshold;
}

function roundedPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export function capacityCoverage(input: CapacityCoverageInput): CapacityCoverage {
  const committedPct = safePercent(input.committedUtilizationPct);
  const availablePct = roundedPercent(Math.min(
    safePercent(input.reliableNewWorkCapacityPct),
    100 - committedPct,
  ));
  const protectedPct = roundedPercent(Math.max(0, 100 - committedPct - availablePct));

  return { committedPct, availablePct, protectedPct };
}

export function aggregateReplicaCategories(
  blocks: ReplicaCategoryInput[],
  limit = 5,
): ReplicaCategorySummary[] {
  const totals = new Map<string, number>();
  for (const block of blocks) {
    const capacityPct = safePercent(block.estimatedCapacityPct);
    if (capacityPct <= 0) continue;
    totals.set(block.category, (totals.get(block.category) ?? 0) + capacityPct);
  }

  const sorted = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = sorted.reduce((sum, [, capacityPct]) => sum + capacityPct, 0);

  return sorted.slice(0, Math.max(0, limit)).map(([label, capacityPct]) => ({
    label,
    capacityPct,
    sharePct: total > 0 ? Math.round((capacityPct / total) * 100) : 0,
  }));
}

export function aggregateReplicaModes(blocks: ReplicaModeInput[]): ReplicaModeSummary[] {
  const totals = new Map<string, number>();
  for (const block of blocks) {
    const capacityPct = safePercent(block.estimatedCapacityPct);
    if (capacityPct <= 0) continue;
    totals.set(block.mode, (totals.get(block.mode) ?? 0) + capacityPct);
  }

  const sorted = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = sorted.reduce((sum, [, capacityPct]) => sum + capacityPct, 0);

  return sorted.map(([label, capacityPct]) => ({
    label,
    capacityPct,
    sharePct: total > 0 ? Math.round((capacityPct / total) * 100) : 0,
  }));
}
