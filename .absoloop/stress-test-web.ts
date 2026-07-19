// Iteration-3 flake characterization: repeat the full web suite and capture any failure.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let fails = 0;
for (let i = 1; i <= 12; i++) {
  let out = "";
  let failed = false;
  try {
    out = execSync("npm run test:web", {
      cwd: "/Users/rohnspringfield/weekform-dev",
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: any) {
    failed = true;
    out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
  }
  const summary = out
    .split("\n")
    .filter((l) => /\b(tests|pass|fail) \d+/.test(l))
    .join(" | ");
  if (failed || /\bfail [1-9]/.test(out)) {
    fails++;
    const log = `/Users/rohnspringfield/weekform-dev/.absoloop/stress-fail-run-${i}.log`;
    writeFileSync(log, out);
    console.log(`run ${i}: FAIL — ${summary} (log: ${log})`);
  } else {
    console.log(`run ${i}: ok — ${summary}`);
  }
}
console.log(`total failing runs: ${fails} / 12`);
