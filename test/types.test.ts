import { describe, expectTypeOf, it } from "vitest";

import {
  boolean,
  categorical,
  type DecisionEngine,
  defineDecision,
  type BooleanQuestion,
  type CategoricalQuestion,
  type CategoricalResult,
  type DecisionProvider,
  type DecisionResult,
  type JevProvider,
  type MockProvider,
  type OrdinalQuestion,
  type OrdinalResult,
  ordinal,
  type ResultFor,
} from "../src/index";

const decision = defineDecision({
  intent: categorical({
    description: "Which department?",
    values: {
      billing: "Payments",
      technical: "Technical issues",
      sales: "Purchasing",
    },
  }),
  needsHuman: boolean({
    description: "Does this require human intervention?",
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

type IntentQuestion = (typeof decision)["intent"];
type NeedsHumanQuestion = (typeof decision)["needsHuman"];
type UrgencyQuestion = (typeof decision)["urgency"];

type Results = DecisionResult<typeof decision>;
type Intent = Results["intent"];
type NeedsHuman = Results["needsHuman"];
type Urgency = Results["urgency"];

/** Type-only engines: erased at runtime so no type assertion is ever executed. */
declare const engine: DecisionEngine;
declare const mockEngine: DecisionEngine;
declare const jevEngine: DecisionEngine;

/** Type-only: erased at runtime, and only ever read inside `compileTimeOnly`. */
declare const result: Results;

/** Never called: these checks are verified by `tsc`, not at runtime. */
function compileTimeOnly(_check: () => void): void {
  void _check;
}

describe("question types", () => {
  it("keeps each question's declared values", () => {
    expectTypeOf<IntentQuestion>().toExtend<
      CategoricalQuestion<{
        billing: string;
        technical: string;
        sales: string;
      }>
    >();
    expectTypeOf<NeedsHumanQuestion>().toExtend<BooleanQuestion>();
    expectTypeOf<UrgencyQuestion>().toExtend<
      OrdinalQuestion<{ low: string; medium: string; high: string }>
    >();
  });
});

describe("categorical results", () => {
  it("preserves the declared keys as a literal union", () => {
    expectTypeOf<Intent>().toEqualTypeOf<
      CategoricalResult<"billing" | "technical" | "sales">
    >();
    expectTypeOf<Intent["probability"]>()
      .parameter(0)
      .toEqualTypeOf<"billing" | "technical" | "sales">();
    expectTypeOf<Intent["mostLikely"]>().returns.toEqualTypeOf<
      "billing" | "technical" | "sales"
    >();
    expectTypeOf<Intent["distribution"]>().returns.toEqualTypeOf<
      Record<"billing" | "technical" | "sales", number>
    >();
    expectTypeOf<Intent["confidence"]>().toEqualTypeOf<number | undefined>();
  });

  it("rejects an unknown categorical value at compile time", () => {
    compileTimeOnly(() => {
      // @ts-expect-error "unknown" is not a declared value
      result.intent.probability("unknown");
    });
  });
});

describe("ordinal results", () => {
  it("preserves the declared levels as a literal union", () => {
    expectTypeOf<Urgency>().toEqualTypeOf<
      OrdinalResult<"low" | "medium" | "high">
    >();
    expectTypeOf<Urgency["probability"]>()
      .parameter(0)
      .toEqualTypeOf<"low" | "medium" | "high">();
    expectTypeOf<Urgency["mostLikely"]>().returns.toEqualTypeOf<
      "low" | "medium" | "high"
    >();
  });

  it("rejects an unknown ordinal level at compile time", () => {
    compileTimeOnly(() => {
      // @ts-expect-error "critical" is not a declared level
      result.urgency.probability("critical");
    });
  });
});

describe("boolean results", () => {
  it("exposes a probability and an optional confidence", () => {
    expectTypeOf<NeedsHuman["probability"]>().toEqualTypeOf<number>();
    expectTypeOf<NeedsHuman["confidence"]>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<NeedsHuman>().not.toHaveProperty("mostLikely");
  });

  it("distinguishes probability from confidence", () => {
    compileTimeOnly(() => {
      // @ts-expect-error a boolean result has no mostLikely()
      result.needsHuman.mostLikely();
    });
  });
});

describe("ResultFor", () => {
  it("maps each question kind to its result kind", () => {
    expectTypeOf<ResultFor<IntentQuestion>>().toEqualTypeOf<Intent>();
    expectTypeOf<ResultFor<NeedsHumanQuestion>>().toEqualTypeOf<NeedsHuman>();
    expectTypeOf<ResultFor<UrgencyQuestion>>().toEqualTypeOf<Urgency>();
  });
});

describe("DecisionEngine.evaluate()", () => {
  it("returns a result keyed by question name", () => {
    compileTimeOnly(() => {
      expectTypeOf(
        engine.evaluate(decision, { message: "hi" }),
      ).resolves.toEqualTypeOf<Results>();
    });
  });

  it("accepts arbitrary JSON state", () => {
    const state = {
      message: "My card was charged twice",
      customerTier: "premium",
      history: [{ id: 1, ok: true }],
      meta: { attempt: 2, tags: ["billing", null] },
    };

    compileTimeOnly(() => {
      expectTypeOf(
        engine.evaluate(decision, state),
      ).resolves.toEqualTypeOf<Results>();
      expectTypeOf(
        engine.evaluate(decision, "a plain string"),
      ).resolves.toEqualTypeOf<Results>();
      expectTypeOf(
        engine.evaluate(decision, null),
      ).resolves.toEqualTypeOf<Results>();
      expectTypeOf(
        engine.evaluate(decision, [1, "two", false]),
      ).resolves.toEqualTypeOf<Results>();
    });
  });

  it("rejects state that is not JSON serializable", () => {
    compileTimeOnly(() => {
      // @ts-expect-error a function is not valid JSON state
      engine.evaluate(decision, { message: () => "hi" });

      // @ts-expect-error undefined is not valid JSON state
      engine.evaluate(decision, { message: undefined });
    });
  });

  it("rejects a value that is not a question", () => {
    compileTimeOnly(() => {
      // @ts-expect-error a bare object is not a question
      defineDecision({ intent: { type: "categorical" } });
    });
  });
});

describe("provider abstraction", () => {
  it("accepts any DecisionProvider implementation", () => {
    const custom: DecisionProvider = {
      evaluate: () => Promise.resolve({ answers: {} }),
    };

    expectTypeOf(custom).toExtend<DecisionProvider>();
    expectTypeOf<MockProvider>().toExtend<DecisionProvider>();
    expectTypeOf<JevProvider>().toExtend<DecisionProvider>();
  });

  it("keeps the result type identical when the provider is swapped", () => {
    compileTimeOnly(() => {
      expectTypeOf(
        mockEngine.evaluate(decision, "state"),
      ).resolves.toEqualTypeOf<Results>();
      expectTypeOf(
        jevEngine.evaluate(decision, "state"),
      ).resolves.toEqualTypeOf<Results>();
    });
  });
});
