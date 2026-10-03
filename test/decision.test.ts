import { describe, expect, it } from "vitest";

import {
  boolean,
  categorical,
  ConfigurationError,
  defineDecision,
  ordinal,
} from "../src/index";
import {
  canonicalizeDecision,
  prepareDecision,
  validateDecision,
} from "../src/core/decision";
import type { DecisionSpec } from "../src/core/decision";

const decision: DecisionSpec = {
  intent: categorical({
    description: "Which department?",
    values: { billing: "Payments", technical: "Technical issues" },
  }),
  needsHuman: boolean({ description: "Does this need a human?" }),
  urgency: ordinal({
    description: "How urgent?",
    values: [
      { key: "low", description: "Can be handled normally" },
      { key: "high", description: "Requires prompt attention" },
    ],
  }),
};

describe("defineDecision()", () => {
  it("returns the decision untouched", () => {
    expect(defineDecision(decision)).toBe(decision);
  });

  it("performs no runtime validation", () => {
    const broken = { nope: { type: "nonsense" } } as unknown as DecisionSpec;

    // Structural errors surface at evaluation time, not at definition time.
    expect(defineDecision(broken)).toBe(broken);
  });
});

describe("validateDecision()", () => {
  it("accepts a well-formed decision", () => {
    expect(() => {
      validateDecision(decision);
    }).not.toThrow();
  });

  it("rejects a non-object", () => {
    for (const value of [undefined, null, "decision", 42, [decision]]) {
      expect(() => {
        validateDecision(value);
      }).toThrow(ConfigurationError);
    }
  });

  it("rejects an empty decision", () => {
    expect(() => {
      validateDecision({});
    }).toThrow(/at least one question/);
  });

  it("rejects an empty question name", () => {
    expect(() => {
      validateDecision({ "  ": boolean({ description: "d" }) });
    }).toThrow(/cannot be empty/);
  });

  it("rejects an unsupported question type", () => {
    expect(() => {
      validateDecision({ broken: { type: "nonsense" } });
    }).toThrow(/unsupported type/);
  });

  it("rejects a question that is not an object", () => {
    expect(() => {
      validateDecision({ broken: "boolean" });
    }).toThrow(/created by boolean\(\)/);
  });
});

describe("canonicalizeDecision()", () => {
  it("attaches ids and maps every question kind", () => {
    const canonical = canonicalizeDecision(decision);

    expect(canonical).toEqual({
      intent: {
        id: "intent",
        type: "categorical",
        description: "Which department?",
        levels: [
          { key: "billing", description: "Payments" },
          { key: "technical", description: "Technical issues" },
        ],
      },
      needsHuman: {
        id: "needsHuman",
        type: "boolean",
        description: "Does this need a human?",
      },
      urgency: {
        id: "urgency",
        type: "ordinal",
        description: "How urgent?",
        levels: [
          { key: "low", description: "Can be handled normally" },
          { key: "high", description: "Requires prompt attention" },
        ],
      },
    });
  });

  it("preserves categorical declaration order", () => {
    const canonical = canonicalizeDecision({
      reversed: categorical({
        description: "Which?",
        values: { zulu: "Z", alpha: "A", mike: "M" },
      }),
    });

    const question = canonical["reversed"];

    expect(
      question?.type === "categorical" ? question.levels : undefined,
    ).toEqual([
      { key: "zulu", description: "Z" },
      { key: "alpha", description: "A" },
      { key: "mike", description: "M" },
    ]);
  });

  it("preserves ordinal scale order exactly as declared", () => {
    const levels = [
      { key: "5", description: "Terrible" },
      { key: "3", description: "Okay" },
      { key: "1", description: "Great" },
    ];

    const canonical = canonicalizeDecision({
      rating: ordinal({ description: "How was it?", values: levels }),
    });

    const question = canonical["rating"];

    // Integer-like keys must not be re-sorted: a record would lose this order.
    expect(question?.type === "ordinal" ? question.levels : undefined).toEqual(
      levels,
    );
  });

  it("copies levels so later mutation of the source cannot leak in", () => {
    const levels = [
      { key: "low", description: "Low" },
      { key: "high", description: "High" },
    ];
    const source: DecisionSpec = {
      urgency: ordinal({ description: "How urgent?", values: levels }),
    };

    const canonical = canonicalizeDecision(source);
    levels.push({ key: "injected", description: "Injected" });

    const question = canonical["urgency"];

    expect(question?.type === "ordinal" ? question.levels : undefined).toEqual([
      { key: "low", description: "Low" },
      { key: "high", description: "High" },
    ]);
  });
});

describe("prepareDecision()", () => {
  it("validates and canonicalizes in one step", () => {
    expect(prepareDecision(decision)).toEqual(canonicalizeDecision(decision));
  });

  it("rejects an invalid decision before canonicalizing", () => {
    expect(() => {
      prepareDecision({});
    }).toThrow(ConfigurationError);
  });
});
