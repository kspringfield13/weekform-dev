/**
 * Validate the machine-readable output of `supabase migration list --linked`.
 * Release publication must stop when either side has a migration the other
 * side does not: application code and RLS/RPC contracts ship as one unit.
 */
export function assertLinkedMigrationsMatch(rawOutput) {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Linked migration proof was not valid JSON.");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawOutput.slice(start, end + 1));
  } catch {
    throw new Error("Linked migration proof was not valid JSON.");
  }
  if (!Array.isArray(parsed.migrations) || parsed.migrations.length === 0) {
    throw new Error("Linked migration proof did not include any migrations.");
  }

  const drift = parsed.migrations.filter((migration) => (
    typeof migration?.local !== "string" ||
    typeof migration?.remote !== "string" ||
    !migration.local ||
    migration.local !== migration.remote
  ));
  if (drift.length > 0) {
    const versions = drift
      .map((migration) => migration?.local || migration?.remote || "unknown")
      .join(", ");
    throw new Error(`Linked migration drift blocks release (${versions}).`);
  }

  return parsed.migrations.length;
}

async function main() {
  let rawOutput = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) rawOutput += chunk;
  const count = assertLinkedMigrationsMatch(rawOutput);
  process.stdout.write(`Linked Supabase migrations match (${count}).\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Linked migration proof failed."}\n`);
    process.exitCode = 1;
  });
}
