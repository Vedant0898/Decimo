import { describe, expect, it } from "vitest";

import {
  boolean,
  categorical,
  DecisionEngine,
  InvalidProviderResponseError,
  ordinal,
  type CanonicalAnswer,
  type ProviderResponse,
} from "../src/index";

const spec = {
  intent: categorical({
    description: "Which department?",
    values: {
      billing: "Payments",
      technical: "Technical issues",
      sales: "Sales",
    },
  }),
  needsHuman: boolean({ description: "Does this need a human?" }),
  urgency: ordinal({
    description: "How urgent?",
    values: [
      { key: "low", description: "Low" },
      { key: "medium", description: "Medium" },
      { key: "high", description: "High" },
    ],
  }),
};

const values = ["billing", "technical", "sales"] as const;
const levels = ["low", "medium", "high"] as const;

function provider(answers: Record<string, CanonicalAnswer>): ProviderResponse {
  return { answers };
}

/** Drive a result through the boundary, so the numbers are pre-validated. */
async function evaluate(answers: Record<string, CanonicalAnswer>) {
  const engine = new DecisionEngine(
    { evaluate: () => Promise.resolve(provider(answers)) },
    { timeoutMs: 0 },
  );

  return engine.evaluate(spec, { message: "hello" });
}

describe("boolean results", () => {
  it("exposes the probability and omits confidence when absent", async () => {
    const result = await evaluate({
      intent: {
        type: "categorical",
        probabilities: { billing: 1 / 3, technical: 1 / 3, sales: 1 / 3 },
      },
      needsHuman: { type: "boolean", probability: 0.8 },
      urgency: {
        type: "ordinal",
        probabilities: { low: 1 / 3, medium: 1 / 3, high: 1 / 3 },
      },
    });

    expect(result.needsHuman.probability).toBe(0.8);
    expect("confidence" in result.needsHuman).toBe(false);
  });

  it("keeps probability and confidence separate", async () => {
    const result = await evaluate({
      intent: {
        type: "categorical",
        probabilities: { billing: 1 / 3, technical: 1 / 3, sales: 1 / 3 },
      },
      needsHuman: { type: "boolean", probability: 0.8, confidence: 0.6 },
      urgency: {
        type: "ordinal",
        probabilities: { low: 1 / 3, medium: 1 / 3, high: 1 / 3 },
      },
    });

    expect(result.needsHuman.probability).toBe(0.8);
    expect(result.needsHuman.confidence).toBe(0.6);
  });

  it("rejects an out-of-range probability before any result is built", async () => {
    await expect(
      evaluate({
        intent: {
          type: "categorical",
          probabilities: { billing: 1 / 3, technical: 1 / 3, sales: 1 / 3 },
        },
        needsHuman: { type: "boolean", probability: 1.5 },
        urgency: {
          type: "ordinal",
          probabilities: { low: 1 / 3, medium: 1 / 3, high: 1 / 3 },
        },
      }),
    ).rejects.toBeInstanceOf(InvalidProviderResponseError);
  });
});

describe("distribution results", () => {
  const answer = {
    type: "categorical",
    probabilities: { billing: 0.7, technical: 0.2, sales: 0.1 },
  } as const;

  it("looks up probabilities by value", async () => {
    const result = await evaluate({
      intent: answer,
      needsHuman: { type: "boolean", probability: 0.5 },
      urgency: {
        type: "ordinal",
        probabilities: { low: 1 / 3, medium: 1 / 3, high: 1 / 3 },
      },
    });

    expect(result.intent.probability("billing")).toBeCloseTo(0.7);
    expect(result.intent.probability("technical")).toBeCloseTo(0.2);
    expect(result.intent.probability("sales")).toBeCloseTo(0.1);
  });

  it("reports the whole distribution in declared order", async () => {
    const result = await evaluate({
      intent: answer,
      needsHuman: { type: "boolean", probability: 0.5 },
      urgency: {
        type: "ordinal",
        probabilities: { low: 1 / 3, medium: 1 / 3, high: 1 / 3 },
      },
    });

    expect(Object.keys(result.intent.distribution())).toEqual([...values]);
    expect(result.urgency.distribution()).toEqual({
      low: 1 / 3,
      medium: 1 / 3,
      high: 1 / 3,
    });
  });

  it("does not expose its internal state through distribution()", async () => {
    const result = await evaluate({
      intent: answer,
      needsHuman: { type: "boolean", probability: 0.5 },
      urgency: {
        type: "ordinal",
        probabilities: { low: 1 / 3, medium: 1 / 3, high: 1 / 3 },
      },
    });

    const distribution = result.intent.distribution();
    distribution.billing = 1;

    expect(result.intent.probability("billing")).toBeCloseTo(0.7);
  });

  it("mostLikely() returns the highest probability value", async () => {
    const result = await evaluate({
      intent: {
        type: "categorical",
        probabilities: { billing: 0.1, technical: 0.2, sales: 0.7 },
      },
      needsHuman: { type: "boolean", probability: 0.5 },
      urgency: {
        type: "ordinal",
        probabilities: { low: 1 / 3, medium: 1 / 3, high: 1 / 3 },
      },
    });

    expect(result.intent.mostLikely()).toBe("sales");
  });

  it("mostLikely() breaks ties by the earliest declared value", async () => {
    const result = await evaluate({
      intent: {
        type: "categorical",
        probabilities: { billing: 0.34, technical: 0.33, sales: 0.33 },
      },
      needsHuman: { type: "boolean", probability: 0.5 },
      urgency: {
        type: "ordinal",
        probabilities: { low: 1 / 3, medium: 1 / 3, high: 1 / 3 },
      },
    });

    expect(result.intent.mostLikely()).toBe("billing");
  });

  it("mostLikely() breaks ordinal ties by scale order, not key order", async () => {
    const result = await evaluate({
      intent: {
        type: "categorical",
        probabilities: { billing: 1 / 3, technical: 1 / 3, sales: 1 / 3 },
      },
      needsHuman: { type: "boolean", probability: 0.5 },
      urgency: {
        type: "ordinal",
        probabilities: { low: 0.4, medium: 0.3, high: 0.3 },
      },
    });

    // low is declared first, so it wins the tie against medium and high.
    expect(result.urgency.mostLikely()).toBe("low");
    expect([...levels]).toEqual(["low", "medium", "high"]);
  });
});
