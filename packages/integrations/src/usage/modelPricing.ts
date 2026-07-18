import type { ModelPrice } from "../../../domain/src/models";
import rawCatalog from "./model-prices.catalog.json";

export interface ModelPriceSource {
  id: string;
  provider: string;
  label: string;
  url: string;
  domain: string;
  pricing_basis: string;
  verified_at: string;
  min_models: number;
}

export interface ModelPriceCatalogEntry {
  provider: string;
  model: string;
  source_id: string;
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  cache_read_usd_per_mtok?: number;
  cache_write_usd_per_mtok?: number;
  aliases?: string[];
  effective_until?: string;
  note?: string;
  verified_at: string;
}

export interface ModelPriceCatalog {
  schema_version: 1;
  generated_at: string;
  sources: ModelPriceSource[];
  models: ModelPriceCatalogEntry[];
}

export const MODEL_PRICE_CATALOG = rawCatalog as unknown as ModelPriceCatalog;
export const MODEL_PRICE_SOURCES = MODEL_PRICE_CATALOG.sources;
export const MODEL_PRICE_ENTRIES = MODEL_PRICE_CATALOG.models;

function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isCatalogEntryExpired(
  entry: Pick<ModelPriceCatalogEntry, "effective_until">,
  onDate = localIsoDate(new Date())
): boolean {
  return Boolean(entry.effective_until && onDate > entry.effective_until);
}

export function isModelPriceExpired(
  price: Pick<ModelPrice, "source_kind" | "effective_until">,
  onDate = localIsoDate(new Date())
): boolean {
  return price.source_kind === "official" &&
    Boolean(price.effective_until && onDate > price.effective_until);
}

/** Normalize loose provider labels from imports and UI controls to stable slugs. */
export function normalizePricingProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "grok") return "xai";
  if (normalized === "gemini") return "google";
  return normalized;
}

/** Provider family inferred only for UI prefill; calculation itself remains exact. */
export function inferPricingProvider(model: string): string {
  const lowered = model.trim().toLowerCase();
  if (/^(gpt|o1|o3|o4)/.test(lowered)) return "openai";
  if (lowered.startsWith("gemini")) return "google";
  if (lowered.startsWith("grok")) return "xai";
  if (lowered.startsWith("deepseek")) return "deepseek";
  return "";
}

export function modelPriceMapKey(provider: string, model: string): string {
  const normalizedProvider = normalizePricingProvider(provider);
  const normalizedModel = model.trim();
  return normalizedProvider && normalizedProvider !== "unknown"
    ? `${normalizedProvider}|${normalizedModel}`
    : normalizedModel;
}

export function splitModelPriceMapKey(
  key: string,
  price?: ModelPrice
): { provider: string; model: string } {
  const separator = key.indexOf("|");
  if (separator > 0 && separator < key.length - 1) {
    return {
      provider: normalizePricingProvider(key.slice(0, separator)),
      model: key.slice(separator + 1)
    };
  }
  return {
    provider: price?.provider ? normalizePricingProvider(price.provider) : "",
    model: key
  };
}

/** Strict runtime resolver: provider-qualified entry first, legacy exact-model fallback second. */
export function resolveModelPrice(
  priceMap: Record<string, ModelPrice>,
  provider: string,
  model: string,
  onDate?: string
): ModelPrice | undefined {
  const qualifiedKey = modelPriceMapKey(provider, model);
  const qualified = Object.prototype.hasOwnProperty.call(priceMap, qualifiedKey)
    ? priceMap[qualifiedKey]
    : undefined;
  if (qualified && !isModelPriceExpired(qualified, onDate)) return qualified;
  const legacy = Object.prototype.hasOwnProperty.call(priceMap, model)
    ? priceMap[model]
    : undefined;
  return legacy && !isModelPriceExpired(legacy, onDate) ? legacy : undefined;
}

/**
 * Catalog matching may recognize dated provider snapshots for one-click setup,
 * but the selected price is always stored against the exact observed model id.
 */
export function findCatalogModel(
  provider: string,
  model: string
): ModelPriceCatalogEntry | undefined {
  const normalizedProvider = normalizePricingProvider(provider);
  const normalizedModel = model.trim().toLowerCase();
  const candidates = MODEL_PRICE_ENTRIES
    .filter((entry) => entry.provider === normalizedProvider)
    .sort((left, right) => right.model.length - left.model.length);

  return candidates.find((entry) => {
    if (isCatalogEntryExpired(entry)) return false;
    const catalogModel = entry.model.toLowerCase();
    if (normalizedModel === catalogModel) return true;
    if (entry.aliases?.some((alias) => alias.toLowerCase() === normalizedModel)) return true;
    if (!normalizedModel.startsWith(catalogModel)) return false;
    const suffix = normalizedModel.slice(catalogModel.length);
    return /^(?:-20\d{2}-\d{2}-\d{2}|-20\d{6})$/.test(suffix);
  });
}

export function catalogEntryToModelPrice(entry: ModelPriceCatalogEntry): ModelPrice {
  const source = MODEL_PRICE_SOURCES.find((candidate) => candidate.id === entry.source_id);
  return {
    input_usd_per_mtok: entry.input_usd_per_mtok,
    output_usd_per_mtok: entry.output_usd_per_mtok,
    ...(entry.cache_read_usd_per_mtok === undefined
      ? {}
      : { cache_read_usd_per_mtok: entry.cache_read_usd_per_mtok }),
    ...(entry.cache_write_usd_per_mtok === undefined
      ? {}
      : { cache_write_usd_per_mtok: entry.cache_write_usd_per_mtok }),
    provider: entry.provider,
    source_kind: "official",
    source_id: entry.source_id,
    source_url: source?.url,
    updated_at: entry.verified_at,
    ...(entry.effective_until === undefined
      ? {}
      : { effective_until: entry.effective_until })
  };
}

export function pricingProviderLabel(provider: string): string {
  const normalized = normalizePricingProvider(provider);
  return MODEL_PRICE_SOURCES.find((source) => source.provider === normalized)?.label
    ?? (normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Any provider");
}
