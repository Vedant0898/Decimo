import { describe, expect, it } from "vitest";

import {
  boolean,
  categorical,
  ConfigurationError,
  DecisionEngine,
  defineDecision,
  InvalidProviderResponseError,
  MockProvider,
  ordinal,
  ProviderError,
  ProviderTimeoutError,
  type DecisionProvider,
  type ProviderRequest,
  type ProviderResponse,
} from "../src/index";

const supportDecision = defineDecision({
  intent: categorical({
    description: "Which department does this query belong to?",
    values: {
      billing: "Payments and invoices",
      technical: "Technical problems",
      sales: "Pricing and purchasing",
    },
  }),
  needsHuman: boolean({
    description: "Does this query require human intervention?",
  }),
  urgency: ordinal({
    description: "How urgent is this request?",
    values: {
      low: "Can be handled normally",
      medium: "Should be addressed soon",
      high: "Requires prompt attention",
    },
  }),
});

const state = {
  message: "My card was charged twice",
  customerTier: "premium",
};

function respondWith(answers: ProviderResponse["answers"]): DecisionProvider {
  return {
    evaluate: () => Promise.resolve({ answers }),
  };
}

describe("defineDecision()", () => {
  it("returns the definition unchanged", () => {
    expect(defineDecision(supportDecision)).toBe(supportDecision);
  });

  it("rejects an empty decision", () => {
    expect(() => defineDecision({})).toThrow(ConfigurationError);
  });

  it("rejects an unsupported question type", () => {
    expect(() =>
      defineDecision({
        broken: { type: "ordinal" } as unknown as ReturnType<typeof boolean>,
      }),
    ).toThrow(ConfigurationError);
  });
});

describe("DecisionEngine", () => {
  it("requires a provider", () => {
    expect(
      () => new DecisionEngine(undefined as unknown as DecisionProvider),
    ).toThrow(ConfigurationError);
  });

  it("rejects an invalid timeout", () => {
    expect(
      () => new DecisionEngine(new MockProvider(), { timeoutMs: -1 }),
    ).toThrow(ConfigurationError);
  });

  it("evaluates every question through the provider", async () => {
    const engine = new DecisionEngine(new MockProvider());
    const result = await engine.evaluate(supportDecision, state);

    expect(result.intent.probability("billing")).toBeCloseTo(1 / 3);
    expect(result.intent.mostLikely()).toBe("billing");
    expect(result.needsHuman.probability).toBe(0.5);
    expect(result.urgency.probability("high")).toBeCloseTo(1 / 3);
    expect(result.urgency.distribution()).toEqual({
      low: 1 / 3,
      medium: 1 / 3,
      high: 1 / 3,
    });
  });

  it("passes the state and normalized questions to the provider", async () => {
    let received: ProviderRequest | undefined;

    const provider = new MockProvider({
      responder: (request) => {
        received = request;
        return { answers: {} };
      },
    });

    const engine = new DecisionEngine(provider, { timeoutMs: 0 });

    await expect(
      engine.evaluate(supportDecision, state),
    ).rejects.toBeInstanceOf(InvalidProviderResponseError);

    expect(received?.state).toEqual(state);
    expect(received?.questions.needsHuman).toEqual({
      id: "needsHuman",
      type: "boolean",
      description: "Does this query require human intervention?",
    });
    const urgency = received?.questions["urgency"];

    expect(urgency?.type === "ordinal" ? urgency.values : undefined).toEqual({
      low: "Can be handled normally",
      medium: "Should be addressed soon",
      high: "Requires prompt attention",
    });
  });

  it("returns typed provider answers", async () => {
    const engine = new DecisionEngine(
      respondWith({
        intent: {
          type: "categorical",
          probabilities: { billing: 0.9, technical: 0.07, sales: 0.03 },
          confidence: 0.86,
        },
        needsHuman: { type: "boolean", probability: 0.04 },
        urgency: {
          type: "ordinal",
          probabilities: { low: 0.1, medium: 0.3, high: 0.6 },
          confidence: 0.7,
        },
      }),
    );

    const result = await engine.evaluate(supportDecision, state);

    expect(result.intent.mostLikely()).toBe("billing");
    expect(result.intent.probability("billing")).toBeCloseTo(0.9);
    expect(result.intent.confidence).toBe(0.86);
    expect(result.needsHuman.probability).toBe(0.04);
    expect(result.urgency.mostLikely()).toBe("high");
    expect(result.urgency.confidence).toBe(0.7);
  });

  it("detects a missing answer", async () => {
    const engine = new DecisionEngine(
      respondWith({ needsHuman: { type: "boolean", probability: 0.5 } }),
      { timeoutMs: 0 },
    );

    await expect(engine.evaluate(supportDecision, state)).rejects.toThrow(
      /did not answer question "intent"/,
    );
  });

  it("detects an unrequested answer", async () => {
    const engine = new DecisionEngine(
      respondWith({
        intent: {
          type: "categorical",
          probabilities: { billing: 1 / 3, technical: 1 / 3, sales: 1 / 3 },
        },
        needsHuman: { type: "boolean", probability: 0.5 },
        urgency: {
          type: "ordinal",
          probabilities: { low: 1 / 3, medium: 1 / 3, high: 1 / 3 },
        },
        extra: { type: "boolean", probability: 0.5 },
      }),
      { timeoutMs: 0 },
    );

    await expect(engine.evaluate(supportDecision, state)).rejects.toThrow(
      /unrequested question "extra"/,
    );
  });

  it("rejects an answer whose type does not match the question", async () => {
    const engine = new DecisionEngine(
      respondWith({
        intent: {
          type: "ordinal",
          probabilities: { billing: 1 / 3, technical: 1 / 3, sales: 1 / 3 },
        },
        needsHuman: { type: "boolean", probability: 0.5 },
        urgency: {
          type: "ordinal",
          probabilities: { low: 1 / 3, medium: 1 / 3, high: 1 / 3 },
        },
      }),
      { timeoutMs: 0 },
    );

    await expect(engine.evaluate(supportDecision, state)).rejects.toThrow(
      /is a categorical question but was answered as ordinal/,
    );
  });

  it("rejects an invalid probability", async () => {
    const engine = new DecisionEngine(
      respondWith({
        intent: {
          type: "categorical",
          probabilities: { billing: 0.9, technical: 0.9, sales: 0.9 },
        },
        needsHuman: { type: "boolean", probability: 0.5 },
        urgency: {
          type: "ordinal",
          probabilities: { low: 1 / 3, medium: 1 / 3, high: 1 / 3 },
        },
      }),
      { timeoutMs: 0 },
    );

    await expect(
      engine.evaluate(supportDecision, state),
    ).rejects.toBeInstanceOf(InvalidProviderResponseError);
  });

  it("rejects a response without an answers map", async () => {
    const engine = new DecisionEngine(
      {
        evaluate: () =>
          Promise.resolve({ answers: null } as unknown as ProviderResponse),
      },
      { timeoutMs: 0 },
    );

    await expect(engine.evaluate(supportDecision, state)).rejects.toThrow(
      /did not return an answers map/,
    );
  });

  it("rejects state that is not valid JSON", async () => {
    const engine = new DecisionEngine(new MockProvider());

    await expect(
      engine.evaluate(supportDecision, {
        message: undefined,
      } as unknown as Record<string, never>),
    ).rejects.toThrow(ConfigurationError);
  });

  it("wraps unexpected provider failures in a ProviderError", async () => {
    const cause = new Error("socket hang up");
    const engine = new DecisionEngine(
      {
        evaluate: () => Promise.reject(cause),
      },
      { timeoutMs: 0 },
    );

    try {
      await engine.evaluate(supportDecision, state);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      const providerError = error as ProviderError;
      expect(providerError.provider).toBe("unknown");
      expect(providerError.message).toContain("socket hang up");
      expect(providerError.cause).toBe(cause);
    }
  });

  it("passes Decimo errors through unchanged", async () => {
    const original = new InvalidProviderResponseError("nope", {
      details: { provider: "custom" },
    });
    const engine = new DecisionEngine(
      { evaluate: () => Promise.reject(original) },
      { timeoutMs: 0 },
    );

    await expect(engine.evaluate(supportDecision, state)).rejects.toBe(
      original,
    );
  });

  it("surfaces a timeout as ProviderTimeoutError and aborts the request", async () => {
    let aborted = false;

    const engine = new DecisionEngine(
      {
        evaluate: (_request, context) =>
          new Promise<ProviderResponse>(() => {
            context?.signal?.addEventListener("abort", () => {
              aborted = true;
            });
          }),
      },
      { timeoutMs: 5 },
    );

    try {
      await engine.evaluate(supportDecision, state);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderTimeoutError);
      expect((error as ProviderTimeoutError).timeoutMs).toBe(5);
    }

    expect(aborted).toBe(true);
  });

  it("waits indefinitely when timeoutMs is 0", async () => {
    const engine = new DecisionEngine(new MockProvider(), { timeoutMs: 0 });
    const result = await engine.evaluate(supportDecision, state);

    expect(result.needsHuman.probability).toBe(0.5);
  });

  it("uses an explicit provider name in errors", async () => {
    const engine = new DecisionEngine(
      { evaluate: () => Promise.reject(new Error("down")) },
      { providerName: "acme", timeoutMs: 0 },
    );

    await expect(engine.evaluate(supportDecision, state)).rejects.toThrow(
      /Provider "acme" failed/,
    );
  });
});
