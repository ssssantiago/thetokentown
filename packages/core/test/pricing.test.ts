import assert from "node:assert/strict";
import test from "node:test";

import pricingJson from "../pricing.json" with { type: "json" };
import {
  BUNDLED_PRICING,
  CURSOR_TOKENS_PER_TURN,
  createPricer,
  estimateCursorCostUsd,
  loadPricingTable,
  priceTokens,
  resolveModelPrice,
} from "../src/pricing.ts";

const noTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

test("the bundled table loads with a blended rate and no underscore keys", () => {
  assert.ok(Object.keys(BUNDLED_PRICING.models).length > 0);
  assert.ok(BUNDLED_PRICING.blendedUsdPerToken > 0);
  for (const model of Object.keys(BUNDLED_PRICING.models)) {
    assert.ok(!model.startsWith("_"), `${model} should not be a metadata key`);
  }
});

test("every row cites the page it was read from and the day it was checked", () => {
  // SPEC §12 task 2b. A row without a source is a number someone invented.
  const models = pricingJson.models as Record<string, Record<string, unknown>>;
  const rows = Object.entries(models);
  assert.ok(rows.length > 0);

  for (const [model, row] of rows) {
    assert.match(String(row["source"] ?? ""), /^https:\/\//, `${model} has no source URL`);
    assert.match(String(row["verifiedAt"] ?? ""), /^\d{4}-\d{2}-\d{2}$/, `${model} has no verifiedAt`);
  }

  const meta = pricingJson._meta as Record<string, unknown>;
  assert.equal(meta["warning"], undefined, "the placeholder warning must be gone once every row is sourced");
});

test("the declared blended rate matches the row it claims to come from", () => {
  const blended = pricingJson._blended as Record<string, unknown>;
  const reference = BUNDLED_PRICING.models[String(blended["derivedFrom"])];
  assert.ok(reference, `the reference model ${blended["derivedFrom"]} must exist in the table`);
  const derived = (reference.input + reference.output) / 2 / 1_000_000;
  assert.equal(BUNDLED_PRICING.blendedUsdPerToken, derived);
});

test("the models this machine actually uses are all priced", () => {
  // Observed in ~/.claude and ~/.codex on 2026-09-06. A miss here means the
  // building is silently short by whatever that model cost.
  const observed = [
    "claude-opus-5",
    "claude-fable-5",
    "claude-haiku-4-5-20251001",
    "gpt-5.3-codex",
    "gpt-5.4",
    "gpt-5.6-sol",
    "gpt-5.1-codex-mini",
  ];
  for (const model of observed) {
    assert.ok(resolveModelPrice(model, BUNDLED_PRICING), `${model} resolves to no price`);
  }
});

test("model matching goes exact, then dateless, then longest prefix", () => {
  const table = loadPricingTable({
    _blended: { default: 0.000009 },
    models: {
      "claude-sonnet-4": { input: 1, output: 2 },
      "claude-sonnet-4-5": { input: 3, output: 15 },
    },
  });

  assert.equal(resolveModelPrice("claude-sonnet-4-5", table)?.output, 15, "exact");
  assert.equal(resolveModelPrice("claude-sonnet-4-5-20250929", table)?.output, 15, "compact date suffix");
  assert.equal(resolveModelPrice("claude-sonnet-4-5-2025-09-29", table)?.output, 15, "dashed date suffix");
  assert.equal(
    resolveModelPrice("claude-sonnet-4-5-thinking", table)?.output,
    15,
    "longest prefix wins over claude-sonnet-4",
  );
  assert.equal(resolveModelPrice("claude-sonnet-4-turbo", table)?.output, 2, "falls back to the shorter prefix");
  assert.equal(resolveModelPrice("llama-3", table), null);
});

test("rows missing input or output are dropped, and cache falls back to input", () => {
  const table = loadPricingTable({
    models: {
      good: { input: 4, output: 8 },
      broken: { input: 4 },
      alsoBroken: "nope",
      negative: { input: -1, output: 2 },
    },
  });
  assert.deepEqual(Object.keys(table.models), ["good"]);
  assert.equal(table.models["good"]?.cacheRead, 4, "cacheRead defaults to input");
  assert.equal(table.models["good"]?.cacheWrite, 4);
});

test("a missing blended rate is derived from the table instead of being zero", () => {
  const table = loadPricingTable({ models: { "claude-sonnet-5": { input: 2, output: 10 } } });
  assert.equal(table.blendedUsdPerToken, 6 / 1_000_000);

  const empty = loadPricingTable({});
  assert.equal(empty.blendedUsdPerToken, 0, "nothing to derive from");
});

test("priceTokens charges every bucket at its own rate", () => {
  const price = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
  assert.equal(priceTokens({ ...noTokens, input: 1_000_000 }, price), 3);
  assert.equal(priceTokens({ ...noTokens, output: 1_000_000 }, price), 15);
  assert.equal(priceTokens({ ...noTokens, cacheWrite: 1_000_000 }, price), 3.75);
  assert.equal(priceTokens({ ...noTokens, cacheRead: 1_000_000 }, price), 0.3);
  assert.equal(priceTokens(noTokens, price), 0);
  assert.equal(
    priceTokens({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 }, price),
    18.3,
  );
});

test("an unknown model costs 0 and is recorded once for a single warning", () => {
  const pricer = createPricer(BUNDLED_PRICING);
  assert.equal(pricer.cost("claude-sonnet-4-5", { ...noTokens, input: 1_000_000 }), 3);
  assert.equal(pricer.cost("some-unreleased-model", { ...noTokens, input: 1_000_000 }), 0);
  assert.equal(pricer.cost("some-unreleased-model", { ...noTokens, output: 500 }), 0);
  assert.deepEqual([...pricer.unknownModels], ["some-unreleased-model"]);
});

test("Cursor prefers tokens and falls back to turns, always estimated", () => {
  const table = loadPricingTable({ _blended: { default: 0.000006 }, models: {} });

  assert.equal(estimateCursorCostUsd({ tokens: 1_000_000 }, table), 6);
  assert.equal(estimateCursorCostUsd({ turns: 10 }, table), 10 * CURSOR_TOKENS_PER_TURN * 0.000006);
  assert.equal(
    estimateCursorCostUsd({ tokens: 1_000_000, turns: 999 }, table),
    6,
    "tokens win when both are present",
  );
});

test("Cursor with neither tokens nor turns has no cost at all", () => {
  const table = loadPricingTable({ _blended: { default: 0.000006 }, models: {} });
  assert.equal(estimateCursorCostUsd({}, table), null);
  assert.equal(estimateCursorCostUsd({ tokens: 0, turns: 0 }, table), null);
});

test("an estimated Cursor building is comparable to a priced one", () => {
  // SPEC §5.3: the whole point of the estimate is that both use the same
  // floors formula, so a Cursor-only tower is not a shack next to everyone.
  const table = loadPricingTable({ _blended: { default: 0.000006 }, models: {} });
  const cost = estimateCursorCostUsd({ turns: 500 }, table);
  assert.ok(cost !== null && cost > 50, `500 turns should be worth real money, got ${cost}`);
});
