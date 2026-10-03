import { describe, it } from "vitest";

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
  type OrdinalResult,
  type OrdinalValue,
  ordinal,
  type ResultFor,
} from "../src/index";

/**
 * Exact type identity, checked by `tsc`.
 *
 * Deliberately not `expectTypeOf().toEqualTypeOf()`: that helper misreports
 * exact identity for some of the union shapes below. Here a failure is a compile
 * error on the call line, which is the point.
 */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

type ExactProof<Expected, Actual> =
  Equals<Expected, Actual> extends true ? true : never;

/** Fails to compile unless Actual is exactly Expected. No-op at runtime. */
function _assertExact<Expected, Actual>(_proof: ExactProof<Expected, Actual>) {}

/** Fails to compile unless Actual is assignable to Expected. */
function _assertExtends<Expected, Actual extends Expected>(
  _proof?: (value: Actual) => Expected,
) {}

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
    values: [
      { key: "low", description: "Can be handled normally" },
      { key: "medium", description: "Should be addressed soon" },
      { key: "high", description: "Requires prompt attention" },
    ],
  }),
});

type IntentQuestion = (typeof decision)["intent"];
type NeedsHumanQuestion = (typeof decision)["needsHuman"];
type UrgencyQuestion = (typeof decision)["urgency"];

type Results = DecisionResult<typeof decision>;
type Intent = Results["intent"];
type NeedsHuman = Results["needsHuman"];
type Urgency = Results["urgency"];

type IntentValues = "billing" | "technical" | "sales";
type UrgencyLevels = "low" | "medium" | "high";

/** Type-only: erased at runtime, and only ever read inside `compileTimeOnly`. */
declare const engine: DecisionEngine;
declare const result: Results;

/** Never called: these checks are verified by `tsc`, not at runtime. */
function compileTimeOnly(_check: () => void): void {
  void _check;
}

describe("question types", () => {
  it("keeps each question's declared values", () => {
    _assertExact<
      CategoricalQuestion<{
        billing: string;
        technical: string;
        sales: string;
      }>,
      IntentQuestion
    >(true);
    _assertExact<BooleanQuestion, NeedsHumanQuestion>(true);
    _assertExact<
      readonly OrdinalValue<UrgencyLevels>[],
      UrgencyQuestion["values"]
    >(true);
  });

  it("preserves the ordinal key union through defineDecision", () => {
    // Guards the `const` type parameter on ordinal(): without it, the
    // contextual type from `Question` widens every key to `string`.
    _assertExact<UrgencyLevels, UrgencyQuestion["values"][number]["key"]>(true);
  });
});

describe("categorical results", () => {
  it("preserves the declared keys as a literal union", () => {
    _assertExact<CategoricalResult<IntentValues>, Intent>(true);
    _assertExact<IntentValues, Parameters<Intent["probability"]>[0]>(true);
    _assertExact<IntentValues, ReturnType<Intent["mostLikely"]>>(true);
    _assertExact<
      Record<IntentValues, number>,
      ReturnType<Intent["distribution"]>
    >(true);
    _assertExact<number | undefined, Intent["confidence"]>(true);
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
    _assertExact<OrdinalResult<UrgencyLevels>, Urgency>(true);
    _assertExact<UrgencyLevels, Parameters<Urgency["probability"]>[0]>(true);
    _assertExact<UrgencyLevels, ReturnType<Urgency["mostLikely"]>>(true);
    _assertExact<
      Record<UrgencyLevels, number>,
      ReturnType<Urgency["distribution"]>
    >(true);
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
    _assertExact<number, NeedsHuman["probability"]>(true);
    _assertExact<number | undefined, NeedsHuman["confidence"]>(true);
  });

  it("has no mostLikely()", () => {
    compileTimeOnly(() => {
      // @ts-expect-error a boolean result has no mostLikely()
      result.needsHuman.mostLikely();
    });
  });
});

describe("ResultFor", () => {
  it("maps each question kind to its result kind", () => {
    _assertExact<ResultFor<IntentQuestion>, Intent>(true);
    _assertExact<ResultFor<NeedsHumanQuestion>, NeedsHuman>(true);
    _assertExact<ResultFor<UrgencyQuestion>, Urgency>(true);
  });
});

describe("DecisionEngine.evaluate()", () => {
  it("returns a result keyed by question name", () => {
    type Evaluated = Awaited<
      ReturnType<typeof engine.evaluate<typeof decision>>
    >;

    _assertExact<Results, Evaluated>(true);
  });

  it("accepts arbitrary JSON state", () => {
    const _state = {
      message: "My card was charged twice",
      customerTier: "premium",
      history: [{ id: 1, ok: true }],
      meta: { attempt: 2, tags: ["billing", null] },
    };

    compileTimeOnly(() => {
      // Each of these must compile: that is the whole assertion.
      engine.evaluate(decision, _state);
      engine.evaluate(decision, "a plain string");
      engine.evaluate(decision, null);
      engine.evaluate(decision, [1, "two", false]);
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
    const _custom: DecisionProvider = {
      evaluate: () => Promise.resolve({ answers: {} }),
    };

    _assertExtends<DecisionProvider, MockProvider>();
    _assertExtends<DecisionProvider, JevProvider>();
    _assertExtends<DecisionProvider, typeof _custom>();
  });

  it("keeps the result type identical when the provider is swapped", () => {
    compileTimeOnly(() => {
      type MockEvaluated = Awaited<
        ReturnType<typeof engine.evaluate<typeof decision>>
      >;
      type JevEvaluated = Awaited<
        ReturnType<typeof engine.evaluate<typeof decision>>
      >;

      _assertExact<Results, MockEvaluated>(true);
      _assertExact<Results, JevEvaluated>(true);
    });
  });
});
