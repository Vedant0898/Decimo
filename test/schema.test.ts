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
      values: [
        { key: "low", description: "Normal" },
        { key: "high", description: "Now" },
      ],
    });

    expect(question.type).toBe("ordinal");
    expect(question.values.map((value) => value.key)).toEqual(["low", "high"]);
  });

  it("rejects a record, because a record cannot carry a reliable order", () => {
    expect(() =>
      ordinal({
        description: "How urgent?",
        values: { low: "Normal", high: "Now" } as never,
      }),
    ).toThrow(/ordered array/);
  });

  it("preserves a descending numeric-keyed order exactly as declared", () => {
    const question = ordinal({
      description: "How good?",
      values: [
        { key: "5", description: "Terrible" },
        { key: "1", description: "Great" },
      ],
    });

    // A record would come back as ["1", "5"] from Object.keys.
    expect(question.values.map((value) => value.key)).toEqual(["5", "1"]);
  });

  it("requires at least two levels", () => {
    expect(() =>
      ordinal({
        description: "How urgent?",
        values: [{ key: "low", description: "Normal" }],
      }),
    ).toThrow(/at least 2 levels/);
  });

  it("rejects a duplicate level key", () => {
    expect(() =>
      ordinal({
        description: "How urgent?",
        values: [
          { key: "low", description: "Normal" },
          { key: "low", description: "Also normal" },
        ],
      }),
    ).toThrow(/declared more than once/);
  });

  it("rejects an empty key or description", () => {
    expect(() =>
      ordinal({
        description: "How urgent?",
        values: [
          { key: "  ", description: "Normal" },
          { key: "high", description: "Now" },
        ],
      }),
    ).toThrow(/non-empty string "key"/);

    expect(() =>
      ordinal({
        description: "How urgent?",
        values: [
          { key: "low", description: "" },
          { key: "high", description: "Now" },
        ],
      }),
    ).toThrow(/requires a non-empty "description"/);
  });
});
