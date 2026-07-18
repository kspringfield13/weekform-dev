import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleDollarSign,
  ExternalLink,
  Globe2,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2
} from "lucide-react";
import type {
  ModelPrice,
  TokenUsageDay
} from "../../../../../packages/domain/src/models";
import {
  MODEL_PRICE_CATALOG,
  MODEL_PRICE_ENTRIES,
  MODEL_PRICE_SOURCES,
  catalogEntryToModelPrice,
  findCatalogModel,
  inferPricingProvider,
  isCatalogEntryExpired,
  isModelPriceExpired,
  modelPriceMapKey,
  normalizePricingProvider,
  pricingProviderLabel,
  resolveModelPrice,
  splitModelPriceMapKey,
  type ModelPriceCatalogEntry
} from "../../../../../packages/integrations/src/usage/modelPricing";
import { EmptyState } from "../common/EmptyState";

interface PriceDraftRow {
  id: string;
  provider: string;
  model: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  sourceKind: "manual" | "official";
  sourceId?: string;
  sourceUrl?: string;
  updatedAt?: string;
  effectiveUntil?: string;
}

interface PriceRowErrors {
  model?: string;
  input?: string;
  output?: string;
  cacheRead?: string;
  cacheWrite?: string;
  duplicate?: string;
}

interface PriceDraftValidation {
  map: Record<string, ModelPrice> | null;
  errors: Record<string, PriceRowErrors>;
  errorCount: number;
}

type PriceStatus =
  | { tone: "success" | "error" | "info"; message: string }
  | null;

let nextPriceRowId = 0;

function createPriceRowId() {
  nextPriceRowId += 1;
  return `model-price-${nextPriceRowId}`;
}

function draftRowsFromMap(priceMap: Record<string, ModelPrice>): PriceDraftRow[] {
  return Object.entries(priceMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, price]) => {
      const identity = splitModelPriceMapKey(key, price);
      return {
        id: createPriceRowId(),
        provider: identity.provider,
        model: identity.model,
        input: String(price.input_usd_per_mtok),
        output: String(price.output_usd_per_mtok),
        cacheRead: price.cache_read_usd_per_mtok === undefined
          ? ""
          : String(price.cache_read_usd_per_mtok),
        cacheWrite: price.cache_write_usd_per_mtok === undefined
          ? ""
          : String(price.cache_write_usd_per_mtok),
        sourceKind: price.source_kind === "official" ? "official" : "manual",
        sourceId: price.source_id,
        sourceUrl: price.source_url,
        updatedAt: price.updated_at,
        effectiveUntil: price.effective_until
      };
    });
}

function parseRequiredRate(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseOptionalRate(value: string): number | null | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function validatePriceDraft(rows: PriceDraftRow[]): PriceDraftValidation {
  const errors: Record<string, PriceRowErrors> = {};
  const keys = new Map<string, string[]>();
  const map: Record<string, ModelPrice> = Object.create(null) as Record<string, ModelPrice>;

  for (const row of rows) {
    const rowErrors: PriceRowErrors = {};
    const model = row.model.trim();
    const provider = normalizePricingProvider(row.provider);
    const input = parseRequiredRate(row.input);
    const output = parseRequiredRate(row.output);
    const cacheRead = parseOptionalRate(row.cacheRead);
    const cacheWrite = parseOptionalRate(row.cacheWrite);

    if (!model) rowErrors.model = "Enter the exact model ID.";
    else if (model.includes("|")) rowErrors.model = "Model IDs cannot contain |.";
    if (input === null) rowErrors.input = "Enter a non-negative input rate.";
    if (output === null) rowErrors.output = "Enter a non-negative output rate.";
    if (cacheRead === null) rowErrors.cacheRead = "Cache read must be non-negative.";
    if (cacheWrite === null) rowErrors.cacheWrite = "Cache write must be non-negative.";

    if (model) {
      const key = modelPriceMapKey(provider, model);
      keys.set(key, [...(keys.get(key) ?? []), row.id]);
    }
    if (Object.keys(rowErrors).length > 0) errors[row.id] = rowErrors;

    if (
      model &&
      !rowErrors.model &&
      input !== null &&
      output !== null &&
      cacheRead !== null &&
      cacheWrite !== null
    ) {
      const price: ModelPrice = {
        input_usd_per_mtok: input,
        output_usd_per_mtok: output,
        ...(cacheRead === undefined ? {} : { cache_read_usd_per_mtok: cacheRead }),
        ...(cacheWrite === undefined ? {} : { cache_write_usd_per_mtok: cacheWrite }),
        ...(provider ? { provider } : {}),
        source_kind: row.sourceKind,
        ...(row.sourceKind === "official" && row.sourceId ? { source_id: row.sourceId } : {}),
        ...(row.sourceKind === "official" && row.sourceUrl ? { source_url: row.sourceUrl } : {}),
        ...(row.sourceKind === "official" && row.updatedAt ? { updated_at: row.updatedAt } : {}),
        ...(row.sourceKind === "official" && row.effectiveUntil
          ? { effective_until: row.effectiveUntil }
          : {})
      };
      map[modelPriceMapKey(provider, model)] = price;
    }
  }

  for (const [key, rowIds] of keys) {
    if (rowIds.length < 2) continue;
    for (const rowId of rowIds) {
      errors[rowId] = {
        ...errors[rowId],
        duplicate: `Duplicate pricing rule for ${key.replace("|", " / ")}.`
      };
    }
  }

  const errorCount = Object.values(errors).reduce(
    (total, rowErrors) => total + Object.keys(rowErrors).length,
    0
  );
  return { map: errorCount === 0 ? map : null, errors, errorCount };
}

function normalizedPrice(price: ModelPrice) {
  return {
    input_usd_per_mtok: price.input_usd_per_mtok,
    output_usd_per_mtok: price.output_usd_per_mtok,
    cache_read_usd_per_mtok: price.cache_read_usd_per_mtok ?? null,
    cache_write_usd_per_mtok: price.cache_write_usd_per_mtok ?? null,
    provider: price.provider ?? null,
    source_kind: price.source_kind ?? "manual",
    source_id: price.source_id ?? null,
    source_url: price.source_url ?? null,
    updated_at: price.updated_at ?? null,
    effective_until: price.effective_until ?? null
  };
}

function priceMapSignature(priceMap: Record<string, ModelPrice>): string {
  return JSON.stringify(
    Object.entries(priceMap)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, price]) => [key, normalizedPrice(price)])
  );
}

function priceMapChangeCount(
  previous: Record<string, ModelPrice>,
  next: Record<string, ModelPrice>
): number {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  let changes = 0;
  for (const key of keys) {
    const before = previous[key];
    const after = next[key];
    if (!before || !after || JSON.stringify(normalizedPrice(before)) !== JSON.stringify(normalizedPrice(after))) {
      changes += 1;
    }
  }
  return changes;
}

function sourceForEntry(entry: ModelPriceCatalogEntry) {
  return MODEL_PRICE_SOURCES.find((source) => source.id === entry.source_id);
}

function draftRowFromCatalog(
  entry: ModelPriceCatalogEntry,
  model = entry.model,
  provider = entry.provider
): PriceDraftRow {
  const price = catalogEntryToModelPrice(entry);
  return {
    id: createPriceRowId(),
    provider: normalizePricingProvider(provider),
    model,
    input: String(price.input_usd_per_mtok),
    output: String(price.output_usd_per_mtok),
    cacheRead: price.cache_read_usd_per_mtok === undefined
      ? ""
      : String(price.cache_read_usd_per_mtok),
    cacheWrite: price.cache_write_usd_per_mtok === undefined
      ? ""
      : String(price.cache_write_usd_per_mtok),
    sourceKind: "official",
    sourceId: entry.source_id,
    sourceUrl: price.source_url,
    updatedAt: entry.verified_at,
    effectiveUntil: entry.effective_until
  };
}

function rowMatchesCatalogPrice(row: PriceDraftRow, entry: ModelPriceCatalogEntry): boolean {
  return (
    parseRequiredRate(row.input) === entry.input_usd_per_mtok &&
    parseRequiredRate(row.output) === entry.output_usd_per_mtok &&
    parseOptionalRate(row.cacheRead) === entry.cache_read_usd_per_mtok &&
    parseOptionalRate(row.cacheWrite) === entry.cache_write_usd_per_mtok &&
    row.sourceId === entry.source_id &&
    row.effectiveUntil === entry.effective_until
  );
}

function formatRate(value: number | undefined): string {
  if (value === undefined) return "—";
  return `$${new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value)}`;
}

function formatVerifiedDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: year === new Date().getFullYear() ? undefined : "numeric"
  }).format(new Date(year, month - 1, day));
}

function catalogEntryForRow(row: PriceDraftRow): ModelPriceCatalogEntry | undefined {
  const provider = row.provider || inferPricingProvider(row.model);
  return findCatalogModel(provider, row.model);
}

export function ModelPricingPanel({
  tokenUsageDays,
  priceMap,
  preferredProvider,
  onSave
}: {
  tokenUsageDays: TokenUsageDay[];
  priceMap: Record<string, ModelPrice>;
  preferredProvider?: string;
  onSave: (priceMap: Record<string, ModelPrice>) => void;
}) {
  const normalizedPreferredProvider = normalizePricingProvider(preferredProvider ?? "");
  const preferredCatalogProvider = MODEL_PRICE_SOURCES.some(
    (source) => source.provider === normalizedPreferredProvider
  )
    ? normalizedPreferredProvider
    : "all";
  const [rows, setRows] = useState<PriceDraftRow[]>(() => draftRowsFromMap(priceMap));
  const [status, setStatus] = useState<PriceStatus>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogProvider, setCatalogProvider] = useState(preferredCatalogProvider);
  const modelInputRefs = useRef(new Map<string, HTMLInputElement>());
  const rateInputRefs = useRef(new Map<string, HTMLInputElement>());
  const catalogToggleRef = useRef<HTMLButtonElement>(null);
  const catalogSearchRef = useRef<HTMLInputElement>(null);
  const manualAddRef = useRef<HTMLButtonElement>(null);
  const catalogInvokerRef = useRef<HTMLElement | null>(null);

  const openCatalog = (invoker: HTMLElement) => {
    catalogInvokerRef.current = invoker;
    setCatalogOpen(true);
    requestAnimationFrame(() => catalogSearchRef.current?.focus());
  };

  const closeCatalog = () => {
    const invoker = catalogInvokerRef.current;
    setCatalogOpen(false);
    requestAnimationFrame(() => {
      if (invoker?.isConnected) invoker.focus();
      else catalogToggleRef.current?.focus();
    });
  };

  const persistedSignature = useMemo(() => priceMapSignature(priceMap), [priceMap]);
  const validation = useMemo(() => validatePriceDraft(rows), [rows]);
  const draftSignature = validation.map ? priceMapSignature(validation.map) : null;
  const isDirty = draftSignature !== persistedSignature;
  const changeCount = validation.map ? priceMapChangeCount(priceMap, validation.map) : 0;
  const effectiveMap = validation.map ?? priceMap;

  // External resets or future catalog installs must replace an open stale draft.
  // A normal Save does not flicker because its draft signature already equals the
  // newly persisted signature.
  useEffect(() => {
    if (draftSignature === persistedSignature) return;
    setRows(draftRowsFromMap(priceMap));
    setStatus(null);
    // Intentionally keyed only to the persisted snapshot: local typing must not
    // trigger a resync back to disk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedSignature]);

  const detectedModels = useMemo(() => {
    const detected = new Map<
      string,
      { provider: string; model: string; needsCacheReadRate: boolean }
    >();
    for (const day of tokenUsageDays) {
      const hasTokens =
        day.input_tokens > 0 ||
        day.output_tokens > 0 ||
        day.cache_read_tokens > 0 ||
        day.cache_creation_tokens > 0;
      if (
        day.measurement !== "exact" ||
        day.cost_usd !== null ||
        !hasTokens ||
        !day.model ||
        day.model === "unknown"
      ) {
        continue;
      }
      const normalizedProvider = normalizePricingProvider(day.provider);
      const provider = normalizedProvider === "unknown" ? "" : normalizedProvider;
      const key = modelPriceMapKey(provider, day.model);
      const previous = detected.get(key);
      detected.set(key, {
        provider,
        model: day.model,
        needsCacheReadRate: Boolean(previous?.needsCacheReadRate || day.cache_read_tokens > 0)
      });
    }
    return [...detected.values()].sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model)
    );
  }, [tokenUsageDays]);

  const unpricedDetected = detectedModels.filter(({ provider, model, needsCacheReadRate }) => {
    const price = resolveModelPrice(effectiveMap, provider, model);
    return !price || (needsCacheReadRate && price.cache_read_usd_per_mtok === undefined);
  });
  const matchedUnpricedDetected = unpricedDetected.filter(
    ({ provider, model, needsCacheReadRate }) => {
      const entry = findCatalogModel(provider || inferPricingProvider(model), model);
      return Boolean(entry && (!needsCacheReadRate || entry.cache_read_usd_per_mtok !== undefined));
    }
  );
  const pricedDetectedCount = detectedModels.length - unpricedDetected.length;

  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    return MODEL_PRICE_ENTRIES.filter((entry) => {
      if (catalogProvider !== "all" && entry.provider !== catalogProvider) return false;
      if (!query) return true;
      return (
        entry.model.toLowerCase().includes(query) ||
        pricingProviderLabel(entry.provider).toLowerCase().includes(query)
      );
    }).sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model)
    );
  }, [catalogProvider, catalogQuery]);

  const updateRow = (
    rowId: string,
    patch: Partial<PriceDraftRow>,
    preserveSource = false
  ) => {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              ...patch,
              ...(preserveSource
                ? {}
                : {
                    sourceKind: "manual" as const,
                    sourceId: undefined,
                    sourceUrl: undefined,
                    updatedAt: undefined,
                    effectiveUntil: undefined
                  })
            }
          : row
      )
    );
    setStatus(null);
  };

  const addManualRow = (provider = normalizedPreferredProvider, model = "") => {
    const usableProvider = MODEL_PRICE_SOURCES.some((source) => source.provider === provider)
      ? provider
      : "";
    const row: PriceDraftRow = {
      id: createPriceRowId(),
      provider: usableProvider,
      model,
      input: "",
      output: "",
      cacheRead: "",
      cacheWrite: "",
      sourceKind: "manual"
    };
    setRows((current) => [...current, row]);
    setStatus({
      tone: "info",
      message: model ? `Add rates for ${model}.` : "Add an exact model ID and its token rates."
    });
    requestAnimationFrame(() => modelInputRefs.current.get(row.id)?.focus());
  };

  const installCatalogEntry = (
    entry: ModelPriceCatalogEntry,
    exactModel = entry.model,
    exactProvider = entry.provider
  ) => {
    const key = modelPriceMapKey(exactProvider, exactModel);
    const existing = rows.find(
      (row) => modelPriceMapKey(row.provider, row.model) === key
    );
    const nextRow = draftRowFromCatalog(entry, exactModel, exactProvider);
    if (existing) {
      setRows((current) =>
        current.map((row) => row.id === existing.id ? { ...nextRow, id: existing.id } : row)
      );
    } else {
      setRows((current) => [...current, nextRow]);
    }
    setStatus({
      tone: "info",
      message: isCatalogEntryExpired(entry)
        ? `Staged the historical ${entry.model} rate through ${formatVerifiedDate(entry.effective_until!)}. Save to price usage inside that window.`
        : `Staged ${entry.model} from ${pricingProviderLabel(entry.provider)}. Save to apply it.`
    });
    requestAnimationFrame(() => modelInputRefs.current.get(existing?.id ?? nextRow.id)?.focus());
  };

  const addDetectedModel = (
    provider: string,
    model: string,
    needsCacheReadRate = false
  ) => {
    const existing = rows.find(
      (row) => modelPriceMapKey(row.provider, row.model) === modelPriceMapKey(provider, model)
    );
    if (existing) {
      setStatus({
        tone: "info",
        message: `Finish the existing ${model} row; editing a rate makes an expired official price a local override.`
      });
      const field = needsCacheReadRate ? "cache-read" : "input";
      requestAnimationFrame(() => rateInputRefs.current.get(`${existing.id}|${field}`)?.focus());
      return;
    }
    const catalogEntry = findCatalogModel(provider || inferPricingProvider(model), model);
    if (catalogEntry) installCatalogEntry(catalogEntry, model, provider);
    else addManualRow(provider, model);
  };

  const addAllVerifiedDetected = () => {
    const additions = matchedUnpricedDetected
      .map(({ provider, model }) => ({
        provider,
        model,
        entry: findCatalogModel(provider || inferPricingProvider(model), model)
      }))
      .filter((item): item is { provider: string; model: string; entry: ModelPriceCatalogEntry } =>
        Boolean(item.entry)
      );
    const additionsByKey = new Map(
      additions.map((item) => [modelPriceMapKey(item.provider, item.model), item])
    );
    let firstAffectedId: string | undefined;
    const updatedRows = rows.map((row) => {
      const item = additionsByKey.get(modelPriceMapKey(row.provider, row.model));
      if (!item) return row;
      firstAffectedId ??= row.id;
      return { ...draftRowFromCatalog(item.entry, item.model, item.provider), id: row.id };
    });
    const existingKeys = new Set(rows.map((row) => modelPriceMapKey(row.provider, row.model)));
    const stagedRows = additions
      .filter(({ provider, model }) => !existingKeys.has(modelPriceMapKey(provider, model)))
      .map(({ provider, model, entry }) => draftRowFromCatalog(entry, model, provider));
    firstAffectedId ??= stagedRows[0]?.id;
    setRows([...updatedRows, ...stagedRows]);
    setStatus({
      tone: "info",
      message: `Staged ${additions.length} verified ${additions.length === 1 ? "price" : "prices"}. Review and save to apply.`
    });
    requestAnimationFrame(() => {
      if (firstAffectedId) modelInputRefs.current.get(firstAffectedId)?.focus();
    });
  };

  const applyCatalogToRow = (rowId: string, entry: ModelPriceCatalogEntry) => {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        const replacement = draftRowFromCatalog(entry, row.model, row.provider || entry.provider);
        return { ...replacement, id: row.id };
      })
    );
    setStatus({
      tone: "info",
      message: `Staged the verified ${pricingProviderLabel(entry.provider)} price. Save to apply it.`
    });
    requestAnimationFrame(() => modelInputRefs.current.get(rowId)?.focus());
  };

  const savePrices = () => {
    if (!validation.map) {
      setStatus({ tone: "error", message: "Fix the highlighted pricing fields before saving." });
      return;
    }
    onSave(validation.map);
    setStatus({
      tone: "success",
      message: `${Object.keys(validation.map).length} model ${Object.keys(validation.map).length === 1 ? "price" : "prices"} saved locally.`
    });
  };

  const discardChanges = () => {
    setRows(draftRowsFromMap(priceMap));
    setStatus({ tone: "info", message: "Unsaved pricing changes discarded." });
  };

  const catalogVerifiedAt = MODEL_PRICE_CATALOG.generated_at.slice(0, 10);

  return (
    <section className="model-pricing-card" aria-labelledby="model-pricing-title">
      <div className="model-pricing-header">
        <div className="model-pricing-title">
          <span className="model-pricing-icon"><CircleDollarSign size={18} aria-hidden /></span>
          <div>
            <h3 id="model-pricing-title">Model prices</h3>
            <p>
              Apply reviewed $/million-token rates to measured usage. Imported CSV costs remain
              authoritative, while edits here reprice only the computed history overlay.
            </p>
          </div>
        </div>
        <div className="model-pricing-summary" role="group" aria-label="Model pricing status">
          <strong>
            {detectedModels.length > 0
              ? `${pricedDetectedCount} of ${detectedModels.length} current rates`
              : `${rows.length} configured`}
          </strong>
          <span>Catalog checked {formatVerifiedDate(catalogVerifiedAt)}</span>
        </div>
        <div className="model-pricing-header-actions">
          <button
            ref={catalogToggleRef}
            className={catalogOpen ? "settings-control is-on" : "settings-control"}
            type="button"
            aria-expanded={catalogOpen}
            aria-controls="model-price-catalog"
            onClick={(event) => {
              if (catalogOpen) setCatalogOpen(false);
              else openCatalog(event.currentTarget);
            }}
          >
            <Sparkles size={15} aria-hidden />
            <span>Browse catalog</span>
          </button>
          <button
            ref={manualAddRef}
            className="settings-control"
            type="button"
            onClick={() => addManualRow()}
          >
            <Plus size={15} aria-hidden />
            <span>Add manually</span>
          </button>
        </div>
      </div>

      {unpricedDetected.length > 0 && (
        <div className="pricing-detected-callout">
          <div className="pricing-detected-copy">
            <Sparkles size={16} aria-hidden />
            <div>
              <strong>
                {unpricedDetected.length} detected {unpricedDetected.length === 1 ? "model needs" : "models need"} a current price
              </strong>
              <span>
                {matchedUnpricedDetected.length > 0
                  ? `${matchedUnpricedDetected.length} ${matchedUnpricedDetected.length === 1 ? "match is" : "matches are"} ready from official sources.`
                  : "Add a manual rule for the exact model IDs found in your usage."}
              </span>
            </div>
          </div>
          <div className="pricing-detected-models">
            {unpricedDetected.slice(0, 6).map(({ provider, model, needsCacheReadRate }) => (
              <button
                type="button"
                key={modelPriceMapKey(provider, model)}
                onClick={() => addDetectedModel(provider, model, needsCacheReadRate)}
                aria-label={`Add pricing for ${pricingProviderLabel(provider)} ${model}`}
                title={`Add pricing for ${pricingProviderLabel(provider)} ${model}`}
              >
                <span>{model}</span>
                <Plus size={12} aria-hidden />
              </button>
            ))}
          </div>
          {matchedUnpricedDetected.length > 1 && (
            <button className="settings-control" type="button" onClick={addAllVerifiedDetected}>
              <Check size={14} aria-hidden />
              <span>Add {matchedUnpricedDetected.length} verified</span>
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={CircleDollarSign}
          title="No model prices configured"
          description="Choose a reviewed provider price or add an exact model ID manually."
        >
          <button
            className="primary-action"
            type="button"
            onClick={(event) => openCatalog(event.currentTarget)}
          >
            <Sparkles size={15} aria-hidden />
            <span>Choose from catalog</span>
          </button>
        </EmptyState>
      ) : (
        <div className="model-pricing-table-wrap">
          <table className="model-pricing-table">
            <caption className="sr-only">Configured model prices in US dollars per million tokens</caption>
            <thead>
              <tr>
                <th scope="col">Provider / model</th>
                <th scope="col">Input</th>
                <th scope="col">Output</th>
                <th scope="col">Cache read</th>
                <th scope="col">Cache write</th>
                <th scope="col">Source</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowErrors = validation.errors[row.id] ?? {};
                const rowErrorMessage = Object.values(rowErrors).join(" ");
                const modelErrorMessage = [rowErrors.model, rowErrors.duplicate]
                  .filter(Boolean)
                  .join(" ");
                const catalogEntry = catalogEntryForRow(row);
                const hasCatalogUpdate = Boolean(
                  catalogEntry &&
                  (row.sourceKind !== "official" || !rowMatchesCatalogPrice(row, catalogEntry))
                );
                const source = row.sourceId
                  ? MODEL_PRICE_SOURCES.find((candidate) => candidate.id === row.sourceId)
                  : undefined;
                const priceExpired = isModelPriceExpired({
                  source_kind: row.sourceKind,
                  effective_until: row.effectiveUntil
                });
                const modelErrorId = `price-model-error-${row.id}`;
                return (
                  <tr key={row.id} className={rowErrorMessage ? "has-error" : undefined}>
                    <td data-label="Provider / model">
                      <div className="pricing-model-fields">
                        <label className="sr-only" htmlFor={`price-provider-${row.id}`}>Provider</label>
                        <select
                          id={`price-provider-${row.id}`}
                          value={row.provider}
                          onChange={(event) => updateRow(row.id, { provider: event.target.value })}
                          aria-label={`Provider for ${row.model || "new model"}`}
                        >
                          <option value="">Any provider</option>
                          {MODEL_PRICE_SOURCES.map((providerSource) => (
                            <option key={providerSource.id} value={providerSource.provider}>
                              {providerSource.label}
                            </option>
                          ))}
                        </select>
                        <label className="sr-only" htmlFor={`price-model-${row.id}`}>Exact model ID</label>
                        <input
                          ref={(element) => {
                            if (element) modelInputRefs.current.set(row.id, element);
                            else modelInputRefs.current.delete(row.id);
                          }}
                          id={`price-model-${row.id}`}
                          type="text"
                          spellCheck={false}
                          autoComplete="off"
                          placeholder="Exact model ID"
                          value={row.model}
                          aria-invalid={Boolean(rowErrors.model || rowErrors.duplicate)}
                          aria-describedby={modelErrorMessage ? modelErrorId : undefined}
                          onChange={(event) => updateRow(row.id, { model: event.target.value })}
                        />
                        {modelErrorMessage && (
                          <small className="pricing-row-error" id={modelErrorId}>{modelErrorMessage}</small>
                        )}
                      </div>
                    </td>
                    {([
                      ["input", "Input", row.input, rowErrors.input],
                      ["output", "Output", row.output, rowErrors.output],
                      ["cache-read", "Cache read", row.cacheRead, rowErrors.cacheRead],
                      ["cache-write", "Cache write", row.cacheWrite, rowErrors.cacheWrite]
                    ] as const).map(([field, label, value, error]) => (
                      <td data-label={`${label} / 1M`} key={field}>
                        <label className="sr-only" htmlFor={`price-${field}-${row.id}`}>
                          {label} dollars per million tokens for {row.model || "new model"}
                        </label>
                        <div className="pricing-money-input">
                          <span aria-hidden>$</span>
                          <input
                            ref={(element) => {
                              const key = `${row.id}|${field}`;
                              if (element) rateInputRefs.current.set(key, element);
                              else rateInputRefs.current.delete(key);
                            }}
                            id={`price-${field}-${row.id}`}
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            placeholder={field.startsWith("cache") ? "Optional" : "0.00"}
                            value={value}
                            aria-invalid={Boolean(error)}
                            aria-describedby={error ? `price-${field}-error-${row.id}` : undefined}
                            onChange={(event) =>
                              updateRow(row.id, {
                                [field === "cache-read"
                                  ? "cacheRead"
                                  : field === "cache-write"
                                    ? "cacheWrite"
                                    : field]: event.target.value
                              })
                            }
                          />
                        </div>
                        {error && (
                          <small className="pricing-field-error" id={`price-${field}-error-${row.id}`}>
                            {error}
                          </small>
                        )}
                      </td>
                    ))}
                    <td data-label="Source">
                      <div className="pricing-row-source">
                        <span className={row.sourceKind === "official" ? "is-official" : "is-manual"}>
                          {row.sourceKind === "official" ? "Official" : "Manual"}
                        </span>
                        {row.sourceKind === "official" && source ? (
                          <a href={row.sourceUrl ?? source.url} target="_blank" rel="noopener noreferrer">
                            {source.label} · {formatVerifiedDate(row.updatedAt ?? source.verified_at)}
                            <ExternalLink size={10} aria-hidden />
                          </a>
                        ) : (
                          <small>Local override</small>
                        )}
                        {row.effectiveUntil && (
                          <small className={priceExpired ? "is-expired" : undefined}>
                            {priceExpired ? "Expired" : "Valid"} through {formatVerifiedDate(row.effectiveUntil)}
                          </small>
                        )}
                        {hasCatalogUpdate && catalogEntry && (
                          <button
                            type="button"
                            aria-label={`${row.sourceKind === "official" ? "Use price update" : "Use official price"} for ${row.model}`}
                            onClick={() => applyCatalogToRow(row.id, catalogEntry)}
                          >
                            {row.sourceKind === "official" ? "Use update" : "Use official price"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td data-label="Actions">
                      <button
                        className="pricing-remove-button"
                        type="button"
                        aria-label={`Remove price for ${row.model || "new model"}`}
                        title="Remove model price"
                        onClick={() => {
                          const rowIndex = rows.findIndex((candidate) => candidate.id === row.id);
                          const focusTarget = rows[rowIndex + 1] ?? rows[rowIndex - 1];
                          setRows((current) => current.filter((candidate) => candidate.id !== row.id));
                          setStatus(null);
                          requestAnimationFrame(() => {
                            if (focusTarget) modelInputRefs.current.get(focusTarget.id)?.focus();
                            else manualAddRef.current?.focus();
                          });
                        }}
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section
        className="model-price-catalog"
        id="model-price-catalog"
        aria-labelledby="model-price-catalog-title"
        hidden={!catalogOpen}
      >
          <div className="model-price-catalog-header">
            <div>
              <h4 id="model-price-catalog-title">Reviewed model catalog</h4>
              <p>Standard text-token pricing from official provider pages, including labeled historical windows. Nothing is applied until you save.</p>
            </div>
            <div className="model-price-catalog-filters">
              <label className="pricing-catalog-search">
                <Search size={14} aria-hidden />
                <span className="sr-only">Search model catalog</span>
                <input
                  ref={catalogSearchRef}
                  type="search"
                  placeholder="Search models"
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">Filter catalog by provider</span>
                <select
                  value={catalogProvider}
                  onChange={(event) => setCatalogProvider(event.target.value)}
                >
                  <option value="all">All providers</option>
                  {MODEL_PRICE_SOURCES.map((source) => (
                    <option key={source.id} value={source.provider}>{source.label}</option>
                  ))}
                </select>
              </label>
              <button
                className="settings-control"
                type="button"
                onClick={closeCatalog}
              >
                Close
              </button>
            </div>
          </div>
          <div className="model-price-catalog-list">
            {filteredCatalog.length === 0 ? (
              <p className="pricing-catalog-empty">No catalog models match that search.</p>
            ) : (
              filteredCatalog.map((entry) => {
                const source = sourceForEntry(entry);
                const expired = isCatalogEntryExpired(entry);
                const alreadyAdded = rows.some((row) => {
                  return modelPriceMapKey(row.provider, row.model) ===
                    modelPriceMapKey(entry.provider, entry.model);
                });
                return (
                  <div className="model-price-catalog-row" key={`${entry.provider}|${entry.model}`}>
                    <div className="catalog-model-identity">
                      <span>{source?.label ?? pricingProviderLabel(entry.provider)}</span>
                      <strong>{entry.model}</strong>
                      {entry.note && <small className="catalog-price-note">{entry.note}</small>}
                      {entry.effective_until && (
                        <small className={expired ? "is-expired" : undefined}>
                          {expired ? "Expired" : "Valid"} through {formatVerifiedDate(entry.effective_until)}
                        </small>
                      )}
                    </div>
                    <dl>
                      <div><dt>Input</dt><dd>{formatRate(entry.input_usd_per_mtok)}</dd></div>
                      <div><dt>Output</dt><dd>{formatRate(entry.output_usd_per_mtok)}</dd></div>
                      <div><dt>Cache read</dt><dd>{formatRate(entry.cache_read_usd_per_mtok)}</dd></div>
                      <div><dt>Cache write</dt><dd>{formatRate(entry.cache_write_usd_per_mtok)}</dd></div>
                    </dl>
                    <button
                      className="settings-control"
                      type="button"
                      disabled={alreadyAdded}
                      aria-label={alreadyAdded
                        ? `${entry.model} price already added`
                        : expired
                          ? `Add historical price for ${entry.model} through ${entry.effective_until}`
                          : `Add official price for ${entry.model}`}
                      onClick={() => installCatalogEntry(entry)}
                    >
                      {alreadyAdded ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
                      <span>{alreadyAdded ? "Added" : expired ? "Add history" : "Add"}</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
      </section>

      <details className="pricing-sources">
        <summary>
          <span><Globe2 size={15} aria-hidden /> Pricing sources</span>
          <small>{MODEL_PRICE_SOURCES.length} official sites · reviewed before publishing</small>
          <ChevronDown size={14} aria-hidden />
        </summary>
        <div className="pricing-source-list">
          {MODEL_PRICE_SOURCES.map((source) => (
            <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
              <span>
                <strong>{source.label}</strong>
                <small>{source.domain}</small>
              </span>
              <span>
                <small>{source.pricing_basis}</small>
                <small>Checked {formatVerifiedDate(source.verified_at)}</small>
              </span>
              <ExternalLink size={13} aria-hidden />
            </a>
          ))}
        </div>
        <p>
          Maintainers can refresh these allowlisted public pages with Firecrawl outside the desktop
          app. Extracted changes are validated and reviewed before the bundled catalog is updated;
          local usage and manual prices are never sent.
        </p>
      </details>

      <div className="model-pricing-footer">
        <div
          className={`model-pricing-status${status ? ` is-${status.tone}` : ""}`}
          role="status"
          aria-live="polite"
        >
          {validation.errorCount > 0
            ? `${validation.errorCount} ${validation.errorCount === 1 ? "field needs" : "fields need"} attention.`
            : status?.message ?? "Cache prices are optional; legacy rules still price cache writes at the input rate."}
        </div>
        <div className="model-pricing-actions">
          <button className="settings-control" type="button" disabled={!isDirty} onClick={discardChanges}>
            Discard
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={!isDirty || !validation.map}
            onClick={savePrices}
          >
            <Save size={15} aria-hidden />
            <span>
              {isDirty && validation.map
                ? `Save ${changeCount} ${changeCount === 1 ? "change" : "changes"}`
                : "Prices saved"}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
