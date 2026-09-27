import { describe, expect, it } from "vitest";

import {
  boolean,
  categorical,
  ConfigurationError,
  ordinal,
} from "../src/index";

describe("boolean()", () => {
  it("builds a boolean question", () => {
    expect(boolean({ description: "Does this need a human?" })).toEqual({
      type: "boolean",
      description: "Does this need a human?",
    });
  });

  it("rejects a missing or empty description", () => {
    expect(() => boolean({ description: "" })).toThrow(ConfigurationError);
    expect(() => boolean({ description: "   " })).toThrow(ConfigurationError);
    expect(() =>
      boolean({ description: undefined as unknown as string }),
    ).toThrow(ConfigurationError);
  });
});

describe("categorical()", () => {
  it("builds a categorical question and preserves the values", () => {
    const question = categorical({
      description: "Which department?",
      values: { billing: "Payments", technical: "Technical issues" },
    });

    expect(question).toEqual({
      type: "categorical",
      description: "Which department?",
      values: { billing: "Payments", technical: "Technical issues" },
    });
  });

  it("rejects empty or malformed values", () => {
    expect(() => categorical({ description: "Which?", values: {} })).toThrow(
      ConfigurationError,
    );
    expect(() =>
      categorical({
        description: "Which?",
        values: { billing: "" },
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      categorical({
        description: "Which?",
        values: [] as unknown as Record<string, string>,
      }),
    ).toThrow(ConfigurationError);
  });
});

describe("ordinal()", () => {
  it("builds an ordinal question and preserves the declared order", () => {
    const question = ordinal({
      description: "How urgent?",
      values: { low: "Normal", high: "Now" },
    });

    expect(question.type).toBe("ordinal");
    expect(Object.keys(question.values)).toEqual(["low", "high"]);
  });

  it("requires at least two levels", () => {
    expect(() =>
      ordinal({ description: "How urgent?", values: { low: "Normal" } }),
    ).toThrow(ConfigurationError);
  });
});
