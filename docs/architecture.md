# Architecture

How the pieces fit, and why they are split this way.

- [The pipeline](#the-pipeline)
- [Module responsibilities](#module-responsibilities)
- [The canonical representation](#the-canonical-representation)
- [Validation happens once, at `evaluate()`](#validation-happens-once-at-evaluate)
- [The response boundary](#the-response-boundary)
- [Type narrowing without assertions](#type-narrowing-without-assertions)
- [Layering](#layering)

---

## The pipeline

```text
defineDecision(...)                 pure; anchors types, no runtime work
        │
DecisionEngine.evaluate(decision, state)
        │
        ├─ 1. prepareDecision()        validate → canonicalize  (core/decision.ts)
        ├─ 2. assertJsonValue(state)   reject non-JSON state    (types/json.ts)
        ├─ 3. provider.evaluate()      one call, all questions  (providers/*)
        ├─ 4. validateProviderResponse()  everything the provider sent (core/response.ts)
        └─ 5. build results            pure construction         (core/result.ts)
        ▼
DecisionResult<D>
```

## Module responsibilities

### `src/schema/types.ts`

The public question types — `BooleanQuestion`, `CategoricalQuestion<T>`,
`OrdinalQuestion<T>`, `OrdinalValue<T>` — plus the argument validators the builders call
(`requireDescription`, `requireCategoryValues`, `requireOrdinalValues`). Also `ValueOf<T>`, which
extracts a categorical's key union.

### `src/schema/canonical.ts`

Decimo's own representation: canonical questions, answers, and `AnswerPair`. Belongs to neither the
builder API nor any provider.

### `src/core/decision.ts`

`DecisionSpec`, `ResultFor`, `DecisionResult`, and the two distinct steps:

- `validateDecision()` — is this definition well-formed? narrows `unknown` to `DecisionSpec`.
- `canonicalizeDecision()` — convert a validated decision into the canonical form.

`prepareDecision()` runs both. `defineDecision()` does neither.

### `src/core/response.ts`

The single boundary where provider output is treated as untrusted. See
[below](#the-response-boundary).

### `src/core/result.ts`

Builds the objects consumers use. Takes already-validated `number`s and performs no checks, which is
what keeps it pure.

### `src/core/engine.ts`

Orchestration only: the five steps above, the `AbortController` timeout, and wrapping any provider
rejection in a `DecimoError`.

### `src/providers/provider.ts`

The port: `DecisionProvider`, `ProviderRequest`, `ProviderResponse`, `ProviderContext`, written
entirely in canonical terms.

### `src/providers/jev/`

`client.ts` (HTTP), `mapper.ts` (translation both ways), `types.ts` (wire types), `index.ts`
(`JevProvider`). All Jev vocabulary is confined to this directory — enforced by
`test/public-api.test.ts`.

## The canonical representation

A provider receives canonical questions, not the builder output:

```ts
interface CanonicalCategoricalQuestion {
  readonly id: string;
  readonly type: "categorical";
  readonly description: string;
  readonly levels: readonly CanonicalLevel[];
}
```

Three properties follow:

- **Ids are attached at canonicalization**, so a provider never has to invent them.
- **Levels are an ordered array**, never a `Record`. Order is therefore explicit all the way from the
  builder to the wire, and `Object.keys` reordering cannot corrupt an ordinal scale. See the
  [ordering contract](./api.md#ordering-contract).
- **Nothing provider-specific appears**, so the same canonical form serves a mock, Jev, or a
  hand-written provider.

## Validation happens once, at `evaluate()`

There is a single validation point, deliberately.

`defineDecision()` does no runtime work. Builder _arguments_ are still checked eagerly, inside
`boolean()`, `categorical()` and `ordinal()` — so a malformed question throws at the call site. What
is deferred is the _structural_ check: is this a well-formed decision at all, are the question names
valid, is every value a known question.

Two reasons to validate at `evaluate()` rather than at both ends:

1. **No double work.** Validating twice would mean two code paths that can disagree.
2. **No trust boundary.** A decision can be assembled by hand, spread from another module, or
   mutated after definition. Validating only at definition would let all of that through
   uninspected. `evaluate()` is where untrusted input enters, so that is where the check belongs.

The cost is that a structural mistake surfaces on first evaluation rather than at import time. The
benefit is that it cannot be bypassed.

## The response boundary

`validateProviderResponse()` is the only place provider output is inspected. It checks:

1. the response is an object with an `answers` map;
2. no unrequested question was answered — checked _before_ any value is inspected, so an unrequested
   answer cannot be misreported as a bad number;
3. every requested question was answered, with an answer of the matching kind;
4. every probability and confidence is a finite number in `[0, 1]`;
5. each distribution covers exactly the declared levels and sums to `1` within
   `DISTRIBUTION_SUM_TOLERANCE`.

It returns `AnswerPair[]` whose numbers are known good, which is the precondition that lets
`core/result.ts` contain no validation at all. A malformed response never silently produces a
result.

## Type narrowing without assertions

Pairing a question with its answer naively does not typecheck usefully:

```ts
// ✗ answer is still the full union inside this branch
if (question.type === "categorical") {
  answer.probabilities; // error: possibly BooleanAnswer
}
```

TypeScript correlates properties of a union member only from a **direct** discriminant. Putting the
discriminant on `question` does not narrow `answer`. So the pair carries its own `kind`:

```ts
export type AnswerPair =
  | {
      id: string;
      kind: "boolean";
      question: CanonicalBooleanQuestion;
      answer: BooleanAnswer;
    }
  | {
      id: string;
      kind: "categorical";
      question: CanonicalCategoricalQuestion;
      answer: CategoricalAnswer;
    }
  | {
      id: string;
      kind: "ordinal";
      question: CanonicalOrdinalQuestion;
      answer: OrdinalAnswer;
    };
```

`switch (pair.kind)` then narrows the question and the answer together, with no assertion.

The boundary builds those pairs by indexing answers **by the kind the question expects** — three
`Map`s, filled by a `switch` over a genuine discriminated union, which narrows for free. The one
assertion left in the codebase is the `as DecisionResult<D>` in `evaluate()`: the seam where runtime
data meets the type-level result, and not avoidable without changing the public signature.

## Layering

Dependencies flow one way:

```text
types/json.ts, types/http.ts
        ↑
schema/types.ts → schema/{boolean,categorical,ordinal}.ts
        ↑              ↑
schema/canonical.ts ──┘          ids, ordered levels, answers, AnswerPair
        ↑              ↑
core/{errors,decision,response,result,engine}.ts
        ↑              ↑
providers/{provider,mock}.ts → providers/jev/*
        ↑──────────────┘
                     src/index.ts
```

`core` imports only the `DecisionProvider` port from `providers`. No provider implementation and no
canonical representation lives in the provider layer — the canonical representation is a shared
vocabulary, not a provider concern.
