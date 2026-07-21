const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const EXPECTED_PROJECT = "weekform";
const CANONICAL_HOST = "weekform.dev";

function invalidMetadata(kind) {
  throw new Error(`The ${kind} deployment metadata was invalid.`);
}

function parseJson(raw, kind) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalidMetadata(kind);
    }
    return value;
  } catch {
    invalidMetadata(kind);
  }
}

function normalizeDeploymentUrl(value, kind) {
  try {
    const candidate = typeof value === "string" && value.startsWith("https://")
      ? value
      : `https://${value}`;
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".vercel.app") ||
      url.hostname === "vercel.app" ||
      url.username ||
      url.password ||
      url.port ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      invalidMetadata(kind);
    }
    return url.origin;
  } catch {
    invalidMetadata(kind);
  }
}

function validateCommon(deployment, kind) {
  if (
    !deployment ||
    typeof deployment !== "object" ||
    Array.isArray(deployment) ||
    Object.hasOwn(deployment, "error") ||
    !DEPLOYMENT_ID_PATTERN.test(deployment.id ?? "") ||
    deployment.readyState !== "READY" ||
    deployment.target !== "production"
  ) {
    invalidMetadata(kind);
  }
  return {
    ...deployment,
    url: normalizeDeploymentUrl(deployment.url, kind),
  };
}

export function parseCandidateDeployment(raw) {
  const root = parseJson(raw, "candidate");
  const wrapped = Object.hasOwn(root, "deployment");
  if (wrapped && root.status !== "ok") invalidMetadata("candidate");
  const deployment = validateCommon(wrapped ? root.deployment : root, "candidate");
  return deployment;
}

export function parseInspectedCandidate(raw, { expectedId, expectedUrl }) {
  const root = parseJson(raw, "candidate");
  const deployment = validateCommon(root, "candidate");
  const aliases = deployment.aliases === undefined ? [] : deployment.aliases;
  let normalizedExpectedUrl;
  try {
    normalizedExpectedUrl = normalizeDeploymentUrl(expectedUrl, "candidate");
  } catch {
    invalidMetadata("candidate");
  }
  if (
    deployment.name !== EXPECTED_PROJECT ||
    deployment.id !== expectedId ||
    deployment.url !== normalizedExpectedUrl ||
    !Array.isArray(aliases) ||
    aliases.length !== 0
  ) {
    invalidMetadata("candidate");
  }
  return { ...deployment, aliases };
}

export function parsePreviousProduction(raw) {
  const root = parseJson(raw, "production");
  const deployment = validateCommon(root, "production");
  if (
    deployment.name !== EXPECTED_PROJECT ||
    !Array.isArray(deployment.aliases) ||
    !deployment.aliases.includes(CANONICAL_HOST)
  ) {
    invalidMetadata("production");
  }
  return deployment;
}

export function parseExpectedCurrentProduction(raw, expectedId) {
  const deployment = parsePreviousProduction(raw);
  if (!DEPLOYMENT_ID_PATTERN.test(expectedId ?? "") || deployment.id !== expectedId) {
    invalidMetadata("production");
  }
  return deployment;
}

async function main() {
  const mode = process.argv[2];
  const raw = await new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      value += chunk;
    });
    process.stdin.on("end", () => resolve(value));
    process.stdin.on("error", reject);
  });

  if (mode === "candidate-id") {
    process.stdout.write(parseCandidateDeployment(raw).id);
    return;
  }
  if (mode === "candidate-url") {
    process.stdout.write(parseCandidateDeployment(raw).url);
    return;
  }
  if (mode === "candidate-inspect") {
    parseInspectedCandidate(raw, {
      expectedId: process.argv[3],
      expectedUrl: process.argv[4],
    });
    return;
  }
  if (mode === "previous-id") {
    process.stdout.write(parsePreviousProduction(raw).id);
    return;
  }
  if (mode === "current-match") {
    parseExpectedCurrentProduction(raw, process.argv[3]);
    return;
  }
  throw new Error("The deployment validation mode was invalid.");
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch(() => {
    process.stderr.write("The Vercel deployment metadata could not be validated.\n");
    process.exitCode = 1;
  });
}
