import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Match the desktop's local-development convention without adding a runtime
// dependency. Exported variables keep precedence over the ignored `.env` file.
try {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  }
} catch {
  // A missing .env is normal; FIRECRAWL_API_KEY can be exported by the caller.
}

const catalogUrl = new URL(
  "../packages/integrations/src/usage/model-prices.catalog.json",
  import.meta.url
);
const candidateUrl = new URL(
  "../packages/integrations/src/usage/model-prices.candidate.json",
  import.meta.url
);
const args = new Set(process.argv.slice(2));
const isCheckOnly = args.has("--check");
const shouldApply = args.has("--apply");

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonEmptyString(value, maxLength = 500) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function validateCatalog(catalog) {
  const errors = [];
  if (!catalog || catalog.schema_version !== 1) errors.push("schema_version must be 1");
  if (!catalog || !Array.isArray(catalog.sources) || catalog.sources.length === 0) {
    errors.push("sources must be a non-empty array");
  }
  if (!catalog || !Array.isArray(catalog.models)) errors.push("models must be an array");
  if (errors.length > 0) return errors;
  if (!isIsoTimestamp(catalog.generated_at)) {
    errors.push("generated_at must be a valid ISO timestamp");
  }
  if (catalog.sources.length > 50) errors.push("sources exceeds the safety limit of 50");
  if (catalog.models.length > 5000) errors.push("models exceeds the safety limit of 5000");

  const sourceIds = new Set();
  const sourcesById = new Map();
  for (const source of catalog.sources) {
    if (!source || typeof source.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(source.id)) {
      errors.push("every source needs an id");
      continue;
    }
    if (sourceIds.has(source.id)) errors.push(`duplicate source id: ${source.id}`);
    sourceIds.add(source.id);
    sourcesById.set(source.id, source);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(source.provider ?? "")) {
      errors.push(`${source.id}: provider is required`);
    }
    if (!isNonEmptyString(source.label, 100)) errors.push(`${source.id}: label is required`);
    if (!isNonEmptyString(source.pricing_basis, 500)) {
      errors.push(`${source.id}: pricing_basis is required`);
    }
    if (!isIsoDate(source.verified_at)) errors.push(`${source.id}: invalid verified_at`);
    if (!/^[a-z0-9.-]+$/.test(source.domain ?? "")) {
      errors.push(`${source.id}: invalid domain`);
    }
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:") errors.push(`${source.id}: source URL must use HTTPS`);
      if (url.hostname !== source.domain) errors.push(`${source.id}: domain does not match URL`);
    } catch {
      errors.push(`${source.id}: invalid source URL`);
    }
    if (!Number.isInteger(source.min_models) || source.min_models < 1) {
      errors.push(`${source.id}: min_models must be a positive integer`);
    }
  }

  const keys = new Set();
  const counts = new Map();
  for (const entry of catalog.models) {
    const key = `${entry?.provider}|${entry?.model}`;
    if (!entry || typeof entry.provider !== "string" || !entry.provider) {
      errors.push(`${key}: provider is required`);
      continue;
    }
    if (typeof entry.model !== "string" || !/^[a-z0-9][a-z0-9._:/-]*$/i.test(entry.model)) {
      errors.push(`${key}: model must be an exact API-style id`);
    }
    if (keys.has(key)) errors.push(`duplicate model: ${key}`);
    keys.add(key);
    if (!sourceIds.has(entry.source_id)) errors.push(`${key}: unknown source ${entry.source_id}`);
    const source = sourcesById.get(entry.source_id);
    if (source && entry.provider !== source.provider) {
      errors.push(`${key}: provider does not match source ${entry.source_id}`);
    }
    if (!isNonNegativeNumber(entry.input_usd_per_mtok)) errors.push(`${key}: invalid input price`);
    if (!isNonNegativeNumber(entry.output_usd_per_mtok)) errors.push(`${key}: invalid output price`);
    for (const field of ["cache_read_usd_per_mtok", "cache_write_usd_per_mtok"]) {
      if (entry[field] !== undefined && !isNonNegativeNumber(entry[field])) {
        errors.push(`${key}: invalid ${field}`);
      }
    }
    if (!isIsoDate(entry.verified_at)) errors.push(`${key}: invalid verified_at`);
    if (entry.effective_until !== undefined && !isIsoDate(entry.effective_until)) {
      errors.push(`${key}: invalid effective_until`);
    }
    if (entry.note !== undefined && !isNonEmptyString(entry.note, 500)) {
      errors.push(`${key}: invalid note`);
    }
    if (entry.aliases !== undefined) {
      if (!Array.isArray(entry.aliases)) {
        errors.push(`${key}: aliases must be an array`);
      } else {
        const aliases = new Set();
        for (const alias of entry.aliases) {
          if (typeof alias !== "string" || !/^[a-z0-9][a-z0-9._:/-]*$/i.test(alias)) {
            errors.push(`${key}: invalid alias`);
          } else if (aliases.has(alias)) {
            errors.push(`${key}: duplicate alias ${alias}`);
          }
          aliases.add(alias);
        }
      }
    }
    counts.set(entry.source_id, (counts.get(entry.source_id) ?? 0) + 1);
  }

  for (const source of catalog.sources) {
    if ((counts.get(source.id) ?? 0) < source.min_models) {
      errors.push(`${source.id}: catalog has fewer than ${source.min_models} models`);
    }
  }
  return errors;
}

function normalizedExtractedEntry(source, raw, verifiedAt) {
  if (!raw || typeof raw.model !== "string") return null;
  const model = raw.model.trim();
  if (!/^[a-z0-9][a-z0-9._:/-]*$/i.test(model)) return null;
  if (!isNonNegativeNumber(raw.input_usd_per_mtok)) return null;
  if (!isNonNegativeNumber(raw.output_usd_per_mtok)) return null;

  const entry = {
    provider: source.provider,
    model,
    source_id: source.id,
    input_usd_per_mtok: raw.input_usd_per_mtok,
    output_usd_per_mtok: raw.output_usd_per_mtok,
    verified_at: verifiedAt
  };
  for (const field of ["cache_read_usd_per_mtok", "cache_write_usd_per_mtok"]) {
    if (isNonNegativeNumber(raw[field])) entry[field] = raw[field];
  }
  if (typeof raw.effective_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.effective_until)) {
    entry.effective_until = raw.effective_until;
  }
  if (typeof raw.note === "string" && raw.note.trim()) entry.note = raw.note.trim().slice(0, 500);
  return entry;
}

async function scrapeSource(source, apiKey, verifiedAt) {
  const schema = {
    type: "object",
    required: ["models"],
    properties: {
      models: {
        type: "array",
        items: {
          type: "object",
          required: ["model", "input_usd_per_mtok", "output_usd_per_mtok"],
          properties: {
            model: { type: "string" },
            input_usd_per_mtok: { type: "number" },
            output_usd_per_mtok: { type: "number" },
            cache_read_usd_per_mtok: { type: ["number", "null"] },
            cache_write_usd_per_mtok: { type: ["number", "null"] },
            effective_until: { type: ["string", "null"] },
            note: { type: ["string", "null"] }
          }
        }
      }
    }
  };
  const prompt = [
    `Extract direct ${source.label} API text-model prices from this official page.`,
    "Return exact API model IDs, never display names.",
    "All numeric rates must be USD per one million tokens.",
    `Use this billing basis: ${source.pricing_basis}.`,
    "Exclude batch, flex, priority, regional, audio, image, embedding, fine-tuning, tool, storage, and long-context variants.",
    "Use standard/cache-miss input as input_usd_per_mtok. Put cached-input/cache-hit in cache_read_usd_per_mtok.",
    "Put a separately listed prompt-cache creation or write price in cache_write_usd_per_mtok.",
    "If a price is temporary, include effective_until and a short note. Do not invent missing rates."
  ].join(" ");

  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: source.url,
      formats: [{ type: "json", prompt, schema }],
      onlyMainContent: true,
      maxAge: 0,
      storeInCache: true,
      timeout: 120000
    }),
    signal: AbortSignal.timeout(130000)
  });
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > 5_000_000) {
    throw new Error(`${source.label}: Firecrawl response exceeded the 5 MB safety limit`);
  }
  const responseText = await response.text();
  if (responseText.length > 5_000_000) {
    throw new Error(`${source.label}: Firecrawl response exceeded the 5 MB safety limit`);
  }
  if (!response.ok) {
    throw new Error(`${source.label}: Firecrawl ${response.status} ${responseText.slice(0, 240)}`);
  }
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(`${source.label}: Firecrawl returned invalid JSON`);
  }
  const rawModels = payload?.data?.json?.models;
  if (!payload?.success || !Array.isArray(rawModels)) {
    throw new Error(`${source.label}: Firecrawl returned no structured model list`);
  }
  if (rawModels.length > 5000) {
    throw new Error(`${source.label}: Firecrawl returned too many model rows`);
  }

  const entries = rawModels
    .map((entry) => normalizedExtractedEntry(source, entry, verifiedAt))
    .filter(Boolean);
  const unique = new Map();
  for (const entry of entries) {
    const previous = unique.get(entry.model);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
      throw new Error(`${source.label}: conflicting duplicate prices for ${entry.model}`);
    }
    unique.set(entry.model, entry);
  }
  if (unique.size < source.min_models) {
    throw new Error(
      `${source.label}: extracted ${unique.size} valid models; expected at least ${source.min_models}`
    );
  }
  return [...unique.values()].sort((left, right) => left.model.localeCompare(right.model));
}

function summarizeDiff(before, after) {
  const beforeMap = new Map(before.map((entry) => [`${entry.provider}|${entry.model}`, entry]));
  const afterMap = new Map(after.map((entry) => [`${entry.provider}|${entry.model}`, entry]));
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const [key, entry] of afterMap) {
    const previous = beforeMap.get(key);
    if (!previous) added += 1;
    else {
      const { verified_at: _previousVerification, ...previousCommercialFields } = previous;
      const { verified_at: _nextVerification, ...nextCommercialFields } = entry;
      if (JSON.stringify(previousCommercialFields) !== JSON.stringify(nextCommercialFields)) {
        changed += 1;
      }
    }
  }
  for (const key of beforeMap.keys()) if (!afterMap.has(key)) removed += 1;
  return { added, changed, removed };
}

const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
const initialErrors = validateCatalog(catalog);
if (initialErrors.length > 0) {
  console.error(initialErrors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else if (isCheckOnly) {
  console.log(
    `Model pricing catalog is valid: ${catalog.models.length} models from ${catalog.sources.length} official sources.`
  );
} else if (shouldApply) {
  let candidate;
  try {
    candidate = JSON.parse(await readFile(candidateUrl, "utf8"));
  } catch {
    console.error("No review candidate found. Run `npm run pricing:refresh` first.");
    process.exitCode = 1;
  }
  if (candidate) {
    const errors = validateCatalog(candidate);
    const candidateSources = new Map(
      (Array.isArray(candidate.sources) ? candidate.sources : [])
        .filter((source) => source && typeof source.id === "string")
        .map((source) => [source.id, source])
    );
    for (const trusted of catalog.sources) {
      const source = candidateSources.get(trusted.id);
      if (
        !source ||
        source.provider !== trusted.provider ||
        source.label !== trusted.label ||
        source.url !== trusted.url ||
        source.domain !== trusted.domain ||
        source.pricing_basis !== trusted.pricing_basis ||
        source.min_models !== trusted.min_models
      ) {
        errors.push(`${trusted.id}: candidate changed the trusted source allowlist`);
      }
    }
    if (candidateSources.size !== catalog.sources.length) {
      errors.push("candidate source count does not match the trusted allowlist");
    }
    if (Date.parse(candidate.generated_at) <= Date.parse(catalog.generated_at)) {
      errors.push("candidate is not newer than the checked-in catalog");
    }
    if (errors.length > 0) {
      console.error(errors.map((error) => `- ${error}`).join("\n"));
      process.exitCode = 1;
    } else {
      const diff = summarizeDiff(catalog.models, candidate.models);
      await writeFile(catalogUrl, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
      await rm(candidateUrl, { force: true });
      console.log(
        `Applied reviewed candidate: ${fileURLToPath(catalogUrl)} ` +
        `(${diff.added} added, ${diff.changed} changed, ${diff.removed} removed).`
      );
    }
  }
} else {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) {
    console.error("FIRECRAWL_API_KEY is required to refresh the model pricing catalog.");
    process.exitCode = 1;
  } else {
    const verifiedAt = new Date().toISOString().slice(0, 10);
    const refreshedGroups = await Promise.all(
      catalog.sources.map((source) => scrapeSource(source, apiKey, verifiedAt))
    );
    const nextCatalog = {
      ...catalog,
      generated_at: new Date().toISOString(),
      sources: catalog.sources.map((source) => ({ ...source, verified_at: verifiedAt })),
      models: refreshedGroups.flat().sort((left, right) =>
        left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model)
      )
    };
    const errors = validateCatalog(nextCatalog);
    if (errors.length > 0) {
      console.error(errors.map((error) => `- ${error}`).join("\n"));
      process.exitCode = 1;
    } else {
      const diff = summarizeDiff(catalog.models, nextCatalog.models);
      await writeFile(candidateUrl, `${JSON.stringify(nextCatalog, null, 2)}\n`, "utf8");
      console.log(
        `Wrote review candidate: ${fileURLToPath(candidateUrl)} ` +
        `(${diff.added} added, ${diff.changed} changed, ${diff.removed} removed).`
      );
      console.log("Review the candidate, then run `npm run pricing:refresh:apply` to replace the catalog.");
    }
  }
}
