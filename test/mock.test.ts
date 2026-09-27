import { describe, expect, it } from "vitest";

import {
  boolean,
  categorical,
  MockProvider,
  ordinal,
  type ProviderRequest,
} from "../src/index";

const questions = {
  needsHuman: {
    id: "needsHuman",
    type: "boolean",
    description: "Does this need a human?",
  },
  intent: {
    id: "intent",
    type: "categorical",
    description: "Which department?",
    values: {
      billing: "Payments",
      technical: "Technical issues",
      sales: "Sales",
    },
  },
  urgency: {
    id: "urgency",
    type: "ordinal",
    description: "How urgent?",
    values: { low: "Low", high: "High" },
  },
} as const;

const request: ProviderRequest = { state: "hello", questions };

describe("MockProvider", () => {
  it("returns uniform probabilities for every question type", async () => {
    const provider = new MockProvider();
    const { answers } = await provider.evaluate(request);

    expect(answers.needsHuman).toEqual({ type: "boolean", probability: 0.5 });
    expect(answers.intent).toEqual({
      type: "categorical",
      probabilities: { billing: 1 / 3, technical: 1 / 3, sales: 1 / 3 },
    });
    expect(answers.urgency).toEqual({
      type: "ordinal",
      probabilities: { low: 0.5, high: 0.5 },
    });
  });

  it("is deterministic across calls", async () => {
    const provider = new MockProvider();
    const first = await provider.evaluate(request);
    const second = await provider.evaluate(request);

    expect(second.answers).toEqual(first.answers);
  });

  it("omits confidence so the field stays genuinely optional", async () => {
    const { answers } = await new MockProvider().evaluate(request);

    expect("confidence" in (answers.intent ?? {})).toBe(false);
  });

  it("uses an injected responder when provided", async () => {
    const seen: ProviderRequest[] = [];
    const provider = new MockProvider({
      responder: (incoming) => {
        seen.push(incoming);
        return {
          answers: {
            needsHuman: { type: "boolean", probability: 0.01 },
          },
        };
      },
    });

    const { answers } = await provider.evaluate(request);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(request);
    expect(answers.needsHuman).toEqual({ type: "boolean", probability: 0.01 });
  });

  it("supports an async responder", async () => {
    const provider = new MockProvider({
      responder: async () => ({
        answers: { needsHuman: { type: "boolean", probability: 0.99 } },
      }),
    });

    const { answers } = await provider.evaluate(request);

    expect(answers.needsHuman).toEqual({ type: "boolean", probability: 0.99 });
  });

  it("receives the provider context", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const provider = new MockProvider({
      responder: (_request, context) => {
        receivedSignal = context?.signal;
        return { answers: {} };
      },
    });

    await provider.evaluate(request, {
      signal: controller.signal,
      timeoutMs: 10,
    });

    expect(receivedSignal).toBe(controller.signal);
  });

  it("reports its name", () => {
    expect(new MockProvider().name).toBe("mock");
  });

  it("works end to end with a decision built from the schema helpers", async () => {
    const { DecisionEngine, defineDecision } = await import("../src/index");

    const decision = defineDecision({
      needsHuman: boolean({ description: "Does this need a human?" }),
      intent: categorical({
        description: "Which department?",
        values: { billing: "Payments", technical: "Technical issues" },
      }),
      urgency: ordinal({
        description: "How urgent?",
        values: { low: "Low", high: "High" },
      }),
    });

    const result = await new DecisionEngine(new MockProvider()).evaluate(
      decision,
      { message: "My card was charged twice" },
    );

    expect(result.intent.probability("technical")).toBe(0.5);
    expect(result.urgency.mostLikely()).toBe("low");
  });
});
