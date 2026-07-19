import type { SimulationDataset } from "./types";

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function serializeSimulationJson(dataset: SimulationDataset): string {
  return JSON.stringify(dataset, null, 2);
}

export function serializeWeeklySnapshotsCsv(dataset: SimulationDataset): string {
  const header = [
    "is_synthetic",
    "simulation_run_id",
    "member_id",
    "week_id",
    "allocated_pct",
    "reliable_new_work_capacity_pct",
    "meeting_pct",
    "reactive_pct",
    "fragmented_work_pct",
    "committed_utilization_pct",
    "context_switch_score",
    "wip_load_score",
    "generator_version",
    "seed",
  ];
  const rows = dataset.weeklySnapshots.map((record) => {
    const snapshot = record.payload;
    return [
      true,
      dataset.runId,
      record.stamp.memberId,
      record.weekId,
      snapshot.allocated_pct,
      snapshot.reliable_new_work_capacity_pct,
      snapshot.meeting_pct,
      snapshot.reactive_pct,
      snapshot.fragmented_work_pct,
      snapshot.committed_utilization_pct,
      snapshot.context_switch_score,
      snapshot.wip_load_score,
      record.stamp.generatorVersion,
      record.stamp.seed,
    ].map(csvCell).join(",");
  });
  return [header.join(","), ...rows].join("\n");
}
