import { describe, expect, it } from "vitest";

import {
  boolean,
  categorical,
  DecisionEngine,
  defineDecision,
  JevProvider,
  MockProvider,
  ordinal,
  type HttpFetch,
  type HttpResponse,
} from "../src/index";

const decision = defineDecision({
  intent: categorical({
    description: "Which department does this query belong to?",
    values: {
      billing: "Payments and invoices",
      technical: "Technical problems",
      sales: "Pricing and purchasing",
    },
  }),

  needsHuman: boolean({
    description: "Does this require human intervention?",
  }),

  urgency: ordinal({
    description: "How urgent is this request?",
    values: [
      { key: "low", description: "Can be handled normally" },
      { key: "medium", description: "Should be addressed soon" },
      { key: "high", description: "Requires prompt attention" },
    ],
  }),
});

const jevFetch: HttpFetch = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () =>
      Promise.resolve(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            intent: {
              type: "choice",
              choice: "billing",
              probabilities: { billing: 0.91, technical: 0.06, sales: 0.03 },
              confidence: 0.84,
            },
            needsHuman: { type: "noul", noul: 0.08 },
            urgency: {
              type: "score",
              score: 1.4,
              legend: { "0": "low", "1": "medium", "2": "high" },
              probabilities: { "0": 0.2, "1": 0.3, "2": 0.5 },
              confidence: 0.6,
            },
          },
          usage: { input_tokens: 300, output_tokens: 30 },
        }),
      ),
  } satisfies HttpResponse);

describe("definition of done", () => {
  it("evaluates the PRD example with MockProvider", async () => {
    const engine = new DecisionEngine(new MockProvider());

    const result = await engine.evaluate(decision, {
      message: "My payment failed",
    });

    expect(result.intent.mostLikely()).toBe("billing");
    expect(result.intent.probability("billing")).toBeCloseTo(1 / 3);
    expect(result.needsHuman.probability).toBe(0.5);
    expect(result.urgency.mostLikely()).toBe("low");
  });

  it("evaluates the same decision with JevProvider, no API key required", async () => {
    const engine = new DecisionEngine(
      new JevProvider({ apiKey: "test-key", fetch: jevFetch }),
    );

    const result = await engine.evaluate(decision, {
      message: "My payment failed",
    });

    expect(result.intent.mostLikely()).toBe("billing");
    expect(result.intent.probability("billing")).toBeCloseTo(0.91);
    expect(result.needsHuman.probability).toBe(0.08);
    expect(result.urgency.mostLikely()).toBe("high");
  });

  it("needs no Jev credentials for the whole suite", () => {
    expect(new JevProvider({ apiKey: "test-key", fetch: jevFetch }).name).toBe(
      "jev",
    );
  });
});
