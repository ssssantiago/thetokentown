/** Model pricing and cost derivation. See docs/SPEC.md §5.3 and §6 (Pricing). */

import pricingJson from "../pricing.json" with { type: "json" };

/** USD per 1,000,000 tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface PricingTable {
  models: Record<string, ModelPrice>;
  /** USD for a single token, used for sources that only report a total. */
  blendedUsdPerToken: number;
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Declared guess: one Cursor turn is worth this many tokens. §5.3 */
export const CURSOR_TOKENS_PER_TURN = 20_000;

const PER_MILLION = 1_000_000;
/** `-20250929` or `-2025-09-29` pinned to the end of a model id. */
const DATE_SUFFIX = /-\d{4}-?\d{2}-?\d{2}$/;

function toModelPrice(value: unknown): ModelPrice | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const read = (key: string): number | null => {
    const raw = row[key];
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
  };
  const input = read("input");
  const output = read("output");
  if (input === null || output === null) return null;
  return {
    input,
    output,
    cacheWrite: read("cacheWrite") ?? input,
    cacheRead: read("cacheRead") ?? input,
  };
}

/** Parse an arbitrary pricing document; unusable rows are dropped, not thrown. */
export function loadPricingTable(raw: unknown): PricingTable {
  const doc = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const rawModels = (typeof doc["models"] === "object" && doc["models"] !== null
    ? doc["models"]
    : {}) as Record<string, unknown>;

  const models: Record<string, ModelPrice> = {};
  for (const [model, value] of Object.entries(rawModels)) {
    if (model.startsWith("_")) continue;
    const price = toModelPrice(value);
    if (price) models[model] = price;
  }

  const blended = (typeof doc["_blended"] === "object" && doc["_blended"] !== null
    ? doc["_blended"]
    : {}) as Record<string, unknown>;
  const declared = blended["default"];
  const blendedUsdPerToken =
    typeof declared === "number" && Number.isFinite(declared) && declared > 0
      ? declared
      : fallbackBlendedRate(models);

  return { models, blendedUsdPerToken };
}

/** Average of input and output for the reference model, per single token. */
function fallbackBlendedRate(models: Record<string, ModelPrice>): number {
  const reference = models["claude-sonnet-4-5"] ?? Object.values(models)[0];
  if (!reference) return 0;
  return (reference.input + reference.output) / 2 / PER_MILLION;
}

/** The pricing table bundled with this release. */
export const BUNDLED_PRICING: PricingTable = loadPricingTable(pricingJson);

/**
 * Exact match, then the id without its date suffix, then the longest key that
 * is a prefix of the id. Returns null when nothing matches.
 */
export function resolveModelPrice(model: string, table: PricingTable): ModelPrice | null {
  const exact = table.models[model];
  if (exact) return exact;

  const undated = model.replace(DATE_SUFFIX, "");
  if (undated !== model) {
    const dateless = table.models[undated];
    if (dateless) return dateless;
  }

  let best: ModelPrice | null = null;
  let bestLength = 0;
  for (const [key, price] of Object.entries(table.models)) {
    if (undated.startsWith(key) && key.length > bestLength) {
      best = price;
      bestLength = key.length;
    }
  }
  return best;
}

export function priceTokens(tokens: TokenCounts, price: ModelPrice): number {
  return (
    (tokens.input * price.input +
      tokens.output * price.output +
      tokens.cacheWrite * price.cacheWrite +
      tokens.cacheRead * price.cacheRead) /
    PER_MILLION
  );
}

export interface Pricer {
  /** Cost in USD; 0 for an unrecognized model, which is recorded instead. */
  cost(model: string, tokens: TokenCounts): number;
  /** Models seen that had no price. The caller warns once per run. */
  unknownModels: ReadonlySet<string>;
}

export function createPricer(table: PricingTable = BUNDLED_PRICING): Pricer {
  const unknownModels = new Set<string>();
  return {
    cost(model, tokens) {
      const price = resolveModelPrice(model, table);
      if (!price) {
        unknownModels.add(model);
        return 0;
      }
      return priceTokens(tokens, price);
    },
    unknownModels,
  };
}

/**
 * Cursor never reports a bill. Tokens win when present; otherwise turns are
 * converted at a declared rate. Both results are flagged as estimated.
 */
export function estimateCursorCostUsd(
  observed: { tokens?: number | undefined; turns?: number | undefined },
  table: PricingTable = BUNDLED_PRICING,
): number | null {
  const tokens = observed.tokens ?? 0;
  if (tokens > 0) return tokens * table.blendedUsdPerToken;

  const turns = observed.turns ?? 0;
  if (turns > 0) return turns * CURSOR_TOKENS_PER_TURN * table.blendedUsdPerToken;

  return null;
}
