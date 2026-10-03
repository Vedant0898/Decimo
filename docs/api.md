# API reference

Everything exported from `decimo`, plus the configuration and error surface.

- [Question builders](#question-builders)
- [defineDecision](#definedecision)
- [DecisionEngine](#decisionengine)
- [Results](#results)
- [Ordering contract](#ordering-contract)
- [State](#state)
- [Configuration](#configuration)
- [Errors](#errors)
- [Types](#types)

---

## Question builders

### `boolean`

```ts
boolean(config: { description: string }): BooleanQuestion
```

A yes/no judgement. Produces a single probability in `[0, 1]`.

```ts
const needsHuman = boolean({ description: "Does this require a human?" });
```

### `categorical`

```ts
categorical<T extends Record<string, string>>(config: {
  description: string;
  values: T;
}): CategoricalQuestion<T>
```

One value out of a fixed set. The keys of `values` become the inferred value union.

```ts
const intent = categorical({
  description: "Which team should handle this message?",
  values: { billing: "Payments and invoices", support: "Technical problems" },
});

intent.probability; // no — the *result* is what carries probabilities
```

### `ordinal`

```ts
ordinal<T extends string>(config: {
  description: string;
  values: readonly { key: T; description: string }[];
}): OrdinalQuestion<T>
```

A position on an ordered scale. `values` is an ordered array — see the
[ordering contract](#ordering-contract).

```ts
const urgency = ordinal({
  description: "How urgent is this request?",
  values: [
    { key: "low", description: "Can be handled normally" },
    { key: "medium", description: "Should be addressed soon" },
    { key: "high", description: "Requires prompt attention" },
  ],
});
```

All three builders validate eagerly and throw `ConfigurationError` on bad input: an empty
description, an empty value record, fewer than two ordinal levels, a duplicate ordinal key, or an
empty key or description.

`ordinal` is declared with a `const` type parameter. Without it, the contextual type from
`DecisionSpec` would widen every level key to `string` and silently destroy the inferred union.

## `defineDecision`

```ts
defineDecision<D extends DecisionSpec>(decision: D): D
```

Returns the decision unchanged, with its types preserved. It performs no runtime validation — see
[why validation happens at `evaluate()`](./architecture.md#validation-happens-once-at-evaluate).
Its job is to give TypeScript something to anchor inference on.

## `DecisionEngine`

```ts
new DecisionEngine(provider: DecisionProvider, options?: DecisionEngineOptions)

evaluate<D extends DecisionSpec>(
  decision: D,
  state: JsonValue,
): Promise<DecisionResult<D>>
```

`state` is any JSON value and is validated before the provider is called. One `evaluate()` call
means exactly one provider call, with every question in it.

Throws `ConfigurationError` if the argument is not an object with an `evaluate` method.

```ts
const engine = new DecisionEngine(new MockProvider(), { timeoutMs: 5_000 });
const result = await engine.evaluate(decision, { message: "Charged twice" });
```

## Results

```ts
interface BooleanResult {
  readonly probability: number; // [0, 1]
  readonly confidence?: number;
}

interface DistributionResult<T extends string> {
  probability(value: T): number;
  mostLikely(): T;
  distribution(): Record<T, number>;
  readonly confidence?: number;
}
```

`CategoricalResult<T>` and `OrdinalResult<T>` are both `DistributionResult<T>`.

| Member           | Behaviour                                                                |
| ---------------- | ------------------------------------------------------------------------ |
| `probability(v)` | The probability for one declared value.                                  |
| `mostLikely()`   | Highest probability. Ties resolve to the **earliest declared value**.    |
| `distribution()` | A copy of the full distribution. Mutating it does not affect the result. |
| `confidence`     | Only present when the provider reports one. Absent otherwise, not `0`.   |

`confidence` is a separate concept from `probability` and is never derived from it.

```ts
result.intent.probability("billing"); // number
result.intent.mostLikely(); // "billing" | "support"
result.intent.distribution(); // { billing: number; support: number }
result.needsHuman.probability; // number
result.needsHuman.confidence; // number | undefined

result.intent.probability("unknown"); // ✗ compile error
```

## Ordering contract

Ordering is semantic for `ordinal` and cosmetic for `categorical`, so the two take different shapes.

**`categorical` — unordered.** `values` is a `Record<key, description>`. The keys become your value
union. Declaration order affects only which key wins a tie in `mostLikely()` and how
`distribution()` orders its keys.

**`ordinal` — ordered.** `values` is an ordered array and the array order _is_ the scale:

- the order levels reach the provider,
- the order `mostLikely()` breaks ties in,
- the order `distribution()` reports keys in.

```ts
ordinal({
  description: "How good was it?",
  values: [
    { key: "5", description: "Terrible" },
    { key: "3", description: "Okay" },
    { key: "1", description: "Great" },
  ],
});
// The provider receives [ "Terrible", "Okay", "Great" ] — in that order.
```

### Why not a record

JavaScript reorders integer-like keys ahead of declaration order:

```ts
Object.keys({ 5: "terrible", 1: "great" }); // → [ "1", "5" ] — declaration order lost
```

A record-based ordinal could therefore hand a provider a **reversed rubric**. An array cannot be
reordered, so the ordering contract is structural rather than a convention.

### Caveat

`distribution()` returns a plain object, and JavaScript renders integer-like keys numerically. Read
it by key rather than iterating its entries if your level keys are numeric strings. The values, and
the order used by `mostLikely()` and by providers, are unaffected.

## State

`state` is `JsonValue`: a primitive, an array, or an object of JSON. It is validated before the
provider is called, so these fail fast as `ConfigurationError` rather than surfacing as a confusing
provider error: `undefined`, functions, symbols, `BigInt`, `Date`, non-finite numbers, circular
references, and class instances such as `Map`.

```ts
await engine.evaluate(decision, "a plain string");
await engine.evaluate(decision, {
  message: "Charged twice",
  history: [{ id: 1 }],
});
await engine.evaluate(decision, [1, "two", false]);
```

## Configuration

No global configuration and no config file. Everything is passed explicitly.

### `DecisionEngineOptions`

| Option         | Type     | Default           | Purpose                                                              |
| -------------- | -------- | ----------------- | -------------------------------------------------------------------- |
| `timeoutMs`    | `number` | `30000`           | Provider timeout. `0` disables it. The in-flight request is aborted. |
| `providerName` | `string` | provider's `name` | Label used in error messages.                                        |

### `MockProviderOptions`

| Option      | Type            | Default         | Purpose                                                 |
| ----------- | --------------- | --------------- | ------------------------------------------------------- |
| `responder` | `MockResponder` | uniform answers | Return scripted answers; receives `(request, context)`. |

### `JevProviderOptions`

| Option         | Type                     | Default                                | Purpose                                                           |
| -------------- | ------------------------ | -------------------------------------- | ----------------------------------------------------------------- |
| `apiKey`       | `string`                 | `TYPESAFE_API_KEY` env var             | Bearer credential. Throws `ConfigurationError` if neither is set. |
| `apiKeyEnvVar` | `string`                 | `"TYPESAFE_API_KEY"`                   | Which environment variable to read                                |
| `baseUrl`      | `string`                 | `https://api.typesafe.ai/v1/systemone` | Endpoint override                                                 |
| `model`        | `string`                 | `"jev-latest"`                         | Model identifier                                                  |
| `headers`      | `Record<string, string>` | —                                      | Extra headers merged into every request                           |
| `timeoutMs`    | `number`                 | the engine's timeout                   | Client-side timeout; `0` disables                                 |
| `fetch`        | `HttpFetch`              | global `fetch`                         | Transport override for tests and proxies                          |

### Tolerance

`DISTRIBUTION_SUM_TOLERANCE` (`1e-6`) is the largest deviation a provider's distribution may have from
summing to `1`. Custom providers do not need to hit it exactly.

## Errors

```text
DecimoError
├── ProviderError                     transport or HTTP failure; carries .provider
│   ├── ProviderTimeoutError          the timeout elapsed; carries .timeoutMs
│   └── InvalidProviderResponseError  the payload was unusable; carries .details
└── ConfigurationError                bad question, non-JSON state, missing credentials
```

`isDecimoError(value)` narrows to `DecimoError`.

```ts
import { isDecimoError, ProviderTimeoutError } from "decimo";

try {
  const result = await engine.evaluate(decision, state);
  if (result.needsHuman.probability > 0.7) escalate();
} catch (error) {
  if (error instanceof ProviderTimeoutError) {
    console.error(`inference timed out after ${error.timeoutMs}ms`);
  } else if (isDecimoError(error)) {
    console.error(error.name, error.message);
  } else {
    throw error;
  }
}
```

### What the boundary rejects

All of these raise `InvalidProviderResponseError`:

- the response is not an object, or has no `answers` map
- a requested question was not answered
- an answer arrived for a question that was never asked
- an answer's kind does not match its question
- a probability or confidence is non-numeric, non-finite, or outside `[0, 1]`
- a distribution omits a declared value, contains an undeclared value, or does not sum to `1`

`details` carries `{ provider, questionId, received }` for debugging. A malformed response never
silently produces a result, and a non-Decimo error thrown by a provider is wrapped in a
`ProviderError` with the original as `cause`.

## Types

| Type                                                                                 | Purpose                                         |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `DecisionSpec`                                                                       | `Record<string, Question>` — what a decision is |
| `DecisionResult<D>`                                                                  | Results for `D`, keyed by question name         |
| `ResultFor<Q>`                                                                       | The result kind a question kind produces        |
| `BooleanResult`, `CategoricalResult<T>`, `OrdinalResult<T>`, `DistributionResult<T>` | Result shapes                                   |
| `BooleanQuestion`, `CategoricalQuestion<T>`, `OrdinalQuestion<T>`, `OrdinalValue<T>` | Public question shapes                          |
| `BooleanAnswer`, `CategoricalAnswer`, `OrdinalAnswer`, `CanonicalAnswer`             | What a provider returns                         |
| `CanonicalQuestion`, `CanonicalLevel`, `CanonicalDecision`                           | What a provider receives                        |
| `DecisionProvider`, `ProviderRequest`, `ProviderResponse`, `ProviderContext`         | The provider port                               |
| `CategoryValues`, `ValueOf<T>`, `Question`, `QuestionType`                           | Schema helpers                                  |
| `JsonValue`, `JsonObject`, `JsonPrimitive`                                           | State types                                     |
| `HttpFetch`, `HttpRequestInit`, `HttpResponse`                                       | Transport types for injecting `fetch`           |
| `assertJsonValue`, `isJsonValue`                                                     | Runtime checks over state                       |

### Transport types

```ts
interface HttpRequestInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal;
}

interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  text(): Promise<string>;
}

type HttpFetch = (url: string, init: HttpRequestInit) => Promise<HttpResponse>;
```

They are structural and minimal, so the global `fetch` satisfies `HttpFetch` with no adapter.
