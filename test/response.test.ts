import { describe, expect, expectTypeOf, it } from "vitest";

import {
  boolean,
  categorical,
  InvalidProviderResponseError,
  ordinal,
} from "../src/index";
import { validateProviderResponse } from "../src/core/response";
import type { AnswerPair, CanonicalDecision } from "../src/schema/canonical";
import { prepareDecision } from "../src/core/decision";
import type { DecisionSpec } from "../src/core/decision";

const spec: DecisionSpec = {
  intent: categorical({
    description: "Which department?",
    values: { billing: "Payments", technical: "Technical", sales: "Sales" },
  }),
  needsHuman: boolean({ description: "Does this need a human?" }),
  urgency: ordinal({
    description: "How urgent?",
    values: [
      { key: "low", description: "Low" },
      { key: "high", description: "High" },
    ],
  }),
};

const decision: CanonicalDecision = prepareDecision(spec);
const PROVIDER = "test";

const good = {
  intent: {
    type: "categorical",
    probabilities: { billing: 0.7, technical: 0.2, sales: 0.1 },
    confidence: 0.8,
  },
  needsHuman: { type: "boolean", probability: 0.4 },
  urgency: {
    type: "ordinal",
    probabilities: { low: 0.25, high: 0.75 },
    confidence: 0.5,
  },
};

function check(answers: unknown, canonical = decision) {
  return validateProviderResponse({ answers }, canonical, PROVIDER);
}

describe("validateProviderResponse()", () => {
  it("returns one pair per question, in decision order", () => {
    const pairs = check(good);

    expect(pairs.map((pair) => pair.id)).toEqual([
      "intent",
      "needsHuman",
      "urgency",
    ]);
  });

  it("narrows a pair's question and answer from its kind", () => {
    const pairs = check(good);
    const intent = pairs[0];

    expect(intent?.kind).toBe("categorical");

    // Both halves narrow together, with no assertion at the call site.
    if (intent?.kind === "categorical") {
      expectTypeOf(intent.question).toExtend<{
        type: "categorical";
      }>();
      expectTypeOf(intent.answer.probabilities).toExtend<
        Readonly<Record<string, number>>
      >();
    }

    const human = pairs[1];

    if (human?.kind === "boolean") {
      expectTypeOf(human.answer.probability).toEqualTypeOf<number>();
    }
  });

  it("is a discriminated union of question/answer pairs", () => {
    expectTypeOf<AnswerPair["kind"]>().toEqualTypeOf<
      "boolean" | "categorical" | "ordinal"
    >();
  });

  it("rejects a response that is not an object", () => {
    for (const value of [null, undefined, "ok", 42, [good]]) {
      expect(() => validateProviderResponse(value, decision, PROVIDER)).toThrow(
        /did not return a response object/,
      );
    }
  });

  it("rejects a response without an answers map", () => {
    expect(() => validateProviderResponse({}, decision, PROVIDER)).toThrow(
      /did not return an answers map/,
    );
    expect(() =>
      validateProviderResponse({ answers: [] }, decision, PROVIDER),
    ).toThrow(/did not return an answers map/);
  });

  it("rejects a missing answer", () => {
    expect(() => check({ ...good, urgency: undefined })).toThrow(
      /did not answer question "urgency"/,
    );
  });

  it("rejects an answer of the wrong kind", () => {
    expect(() =>
      check({
        ...good,
        intent: { type: "ordinal", probabilities: { low: 1, high: 0 } },
      }),
    ).toThrow(/is a categorical question but was answered as ordinal/);
  });

  it("rejects a non-object answer", () => {
    expect(() => check({ ...good, needsHuman: 0.4 })).toThrow(
      /non-object answer/,
    );
  });

  it("rejects an unsupported answer type", () => {
    expect(() =>
      check({ ...good, needsHuman: { type: "guess", probability: 0.4 } }),
    ).toThrow(/unsupported answer type/);
  });

  describe("numbers", () => {
    it("rejects a non-numeric probability", () => {
      expect(() =>
        check({ ...good, needsHuman: { type: "boolean", probability: "0.4" } }),
      ).toThrow(/non-numeric probability/);
    });

    it("rejects a non-finite probability", () => {
      expect(() =>
        check({
          ...good,
          needsHuman: { type: "boolean", probability: Number.NaN },
        }),
      ).toThrow(/non-numeric probability/);
    });

    it("rejects a probability outside [0, 1]", () => {
      expect(() =>
        check({ ...good, needsHuman: { type: "boolean", probability: 1.5 } }),
      ).toThrow(/outside \[0, 1\]/);
    });

    it("rejects an out-of-range confidence", () => {
      expect(() =>
        check({
          ...good,
          needsHuman: { type: "boolean", probability: 0.5, confidence: 2 },
        }),
      ).toThrow(/outside \[0, 1\]/);
    });

    it("rejects a non-object distribution", () => {
      expect(() =>
        check({
          ...good,
          intent: { type: "categorical", probabilities: 0.7 },
        }),
      ).toThrow(/probability distribution/);
    });

    it("rejects a non-numeric entry in a distribution", () => {
      expect(() =>
        check({
          ...good,
          intent: {
            type: "categorical",
            probabilities: { billing: "high", technical: 0.2, sales: 0.1 },
          },
        }),
      ).toThrow(/non-numeric probability for "billing"/);
    });
  });

  describe("distributions", () => {
    it("rejects a missing declared value", () => {
      expect(() =>
        check({
          ...good,
          intent: {
            type: "categorical",
            probabilities: { billing: 0.8, technical: 0.2 },
          },
        }),
      ).toThrow(/missing a probability for value "sales"/);
    });

    it("rejects an undeclared value", () => {
      expect(() =>
        check({
          ...good,
          urgency: {
            type: "ordinal",
            probabilities: { low: 0.25, high: 0.7, critical: 0.05 },
          },
        }),
      ).toThrow(/unknown value "critical"/);
    });

    it("rejects a distribution that does not sum to 1", () => {
      expect(() =>
        check({
          ...good,
          urgency: { type: "ordinal", probabilities: { low: 0.5, high: 0.9 } },
        }),
      ).toThrow(/must sum to 1/);
    });

    it("accepts a distribution that sums to 1 within tolerance", () => {
      const pairs = check({
        ...good,
        intent: {
          type: "categorical",
          probabilities: {
            billing: 1 / 3,
            technical: 1 / 3,
            sales: 1 / 3,
          },
        },
      });

      expect(pairs).toHaveLength(3);
    });

    it("validates ordinal coverage against the declared levels", () => {
      expect(() =>
        check({
          ...good,
          urgency: { type: "ordinal", probabilities: { low: 0.5 } },
        }),
      ).toThrow(/missing a probability for value "high"/);
    });
  });

  describe("error details", () => {
    it("carries the provider, question id and payload", () => {
      try {
        check({
          ...good,
          needsHuman: { type: "boolean", probability: 9 },
        });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidProviderResponseError);
        const invalid = error as InvalidProviderResponseError;
        expect(invalid.details.provider).toBe(PROVIDER);
        expect(invalid.details.questionId).toBe("needsHuman");
        expect(invalid.name).toBe("InvalidProviderResponseError");
      }
    });
  });
});
