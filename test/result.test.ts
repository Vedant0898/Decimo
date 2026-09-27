import { describe, expect, it } from "vitest";

import {
  createBooleanResult,
  createDistributionResult,
  InvalidProviderResponseError,
} from "../src/index";

describe("createBooleanResult()", () => {
  it("exposes the probability and omits confidence when absent", () => {
    const result = createBooleanResult({
      questionId: "needsHuman",
      probability: 0.8,
    });

    expect(result.probability).toBe(0.8);
    expect("confidence" in result).toBe(false);
  });

  it("keeps probability and confidence separate", () => {
    const result = createBooleanResult({
      questionId: "needsHuman",
      probability: 0.8,
      confidence: 0.6,
    });

    expect(result.probability).toBe(0.8);
    expect(result.confidence).toBe(0.6);
  });

  it("rejects probabilities outside [0, 1]", () => {
    expect(() =>
      createBooleanResult({ questionId: "a", probability: 1.5 }),
    ).toThrow(InvalidProviderResponseError);
    expect(() =>
      createBooleanResult({ questionId: "a", probability: -0.1 }),
    ).toThrow(InvalidProviderResponseError);
  });

  it("rejects non-numeric and non-finite probabilities", () => {
    expect(() =>
      createBooleanResult({ questionId: "a", probability: "0.5" }),
    ).toThrow(InvalidProviderResponseError);
    expect(() =>
      createBooleanResult({ questionId: "a", probability: Number.NaN }),
    ).toThrow(InvalidProviderResponseError);
  });

  it("rejects an invalid confidence", () => {
    expect(() =>
      createBooleanResult({ questionId: "a", probability: 0.5, confidence: 2 }),
    ).toThrow(InvalidProviderResponseError);
  });
});

describe("createDistributionResult()", () => {
  const values = ["billing", "technical", "sales"] as const;

  it("looks up probabilities by value", () => {
    const result = createDistributionResult({
      questionId: "intent",
      values,
      probabilities: { billing: 0.7, technical: 0.2, sales: 0.1 },
    });

    expect(result.probability("billing")).toBeCloseTo(0.7);
    expect(result.probability("technical")).toBeCloseTo(0.2);
    expect(result.probability("sales")).toBeCloseTo(0.1);
  });

  it("returns the whole distribution", () => {
    const result = createDistributionResult({
      questionId: "intent",
      values,
      probabilities: { billing: 0.7, technical: 0.2, sales: 0.1 },
    });

    expect(result.distribution()).toEqual({
      billing: 0.7,
      technical: 0.2,
      sales: 0.1,
    });
  });

  it("does not expose its internal state through distribution()", () => {
    const result = createDistributionResult({
      questionId: "intent",
      values,
      probabilities: { billing: 0.7, technical: 0.2, sales: 0.1 },
    });

    const distribution = result.distribution();
    distribution.billing = 1;

    expect(result.probability("billing")).toBeCloseTo(0.7);
  });

  it("mostLikely() returns the highest probability value", () => {
    const result = createDistributionResult({
      questionId: "intent",
      values,
      probabilities: { billing: 0.1, technical: 0.2, sales: 0.7 },
    });

    expect(result.mostLikely()).toBe("sales");
  });

  it("mostLikely() breaks ties by declared order", () => {
    const result = createDistributionResult({
      questionId: "intent",
      values,
      probabilities: { billing: 0.34, technical: 0.33, sales: 0.33 },
    });

    expect(result.mostLikely()).toBe("billing");
  });

  it("rejects a missing value", () => {
    expect(() =>
      createDistributionResult({
        questionId: "intent",
        values,
        probabilities: { billing: 0.6, technical: 0.4 },
      }),
    ).toThrow(InvalidProviderResponseError);
  });

  it("rejects an undeclared value", () => {
    expect(() =>
      createDistributionResult({
        questionId: "intent",
        values,
        probabilities: { billing: 0.5, technical: 0.2, sales: 0.1, other: 0.2 },
      }),
    ).toThrow(InvalidProviderResponseError);
  });

  it("rejects a distribution that does not sum to 1", () => {
    expect(() =>
      createDistributionResult({
        questionId: "intent",
        values,
        probabilities: { billing: 0.5, technical: 0.2, sales: 0.1 },
      }),
    ).toThrow(/sum to 1/);
  });

  it("accepts a distribution that sums to 1 within tolerance", () => {
    const result = createDistributionResult({
      questionId: "intent",
      values,
      probabilities: { billing: 1 / 3, technical: 1 / 3, sales: 1 / 3 },
    });

    expect(result.mostLikely()).toBe("billing");
  });

  it("rejects a non-object distribution", () => {
    expect(() =>
      createDistributionResult({
        questionId: "intent",
        values,
        probabilities: 0.5,
      }),
    ).toThrow(InvalidProviderResponseError);
  });

  it("reports the question id and the offending value", () => {
    try {
      createDistributionResult({
        questionId: "intent",
        values,
        probabilities: { billing: 0.5, technical: 0.2, sales: 0.1, other: 0.2 },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidProviderResponseError);
      const invalid = error as InvalidProviderResponseError;
      expect(invalid.details.questionId).toBe("intent");
      expect(invalid.name).toBe("InvalidProviderResponseError");
      expect(invalid).toBeInstanceOf(Error);
    }
  });
});
