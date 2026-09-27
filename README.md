# Decimo

**Typed questions + application state → provider-independent probabilistic results.**

Decimo is a type-safe probabilistic decision layer for AI applications. You declare what you
want to know, hand it the state of your application, and get back typed probabilities — never
free-form text.

```ts
const decision = defineDecision({
  intent: categorical({
    description: "Which department does this query belong to?",
    values: {
      billing: "Payments and invoices",
      technical: "Technical problems",
      sales: "Pricing and purchasing",
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

const result = await engine.evaluate(decision, {
  message: "My payment failed",
});

result.intent.mostLikely(); // "billing"
result.intent.probability("billing"); // 0.91
result.needsHuman.probability; // 0.08
```

TypeScript rejects values you never declared:

```ts
result.intent.probability("unknown"); // ✗ compile error
```

## Install

```sh
npm install decimo
```

Requires Node 18+ (or any runtime with a global `fetch`).

## Core concepts

### Question types

| Builder                                | Result                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| `boolean({ description })`             | `{ probability: number, confidence?: number }`                        |
| `categorical({ description, values })` | `probability(value)`, `mostLikely()`, `distribution()`, `confidence?` |
| `ordinal({ description, values })`     | same shape as categorical; the declared order is the scale            |

`categorical` and `ordinal` take `values` as a `Record<key, description>`. The **keys** become
the typed value union, and for `ordinal` their insertion order is the scale order.

Probability and confidence are separate concepts and stay that way: a confidence is only present
when the provider reports one.

### State

`state` is any JSON value — a string, an array, or a nested object. It is validated before the
provider is called, so `undefined`, functions, `Date`s, `BigInt`s and circular references fail
fast with a `ConfigurationError` instead of becoming a confusing provider error.

### Providers

Decimo owns the question types; a provider owns the inference. No provider-specific concepts
(`noul`, `choice`, `score`) appear in the public API.

| Provider       | Use                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `MockProvider` | Unit tests and local development. Deterministic uniform probabilities, with an optional `responder` for scripted answers. No network, no key. |
| `JevProvider`  | [Jev](https://docs.typesafe.ai/api) inference.                                                                                                |

A provider is a name plus its own configuration. Nothing else about it is reachable: no wire
types, no HTTP client, no mapping helpers. `JevProvider` is the entire Jev surface.

Swapping a provider never changes the decision:

```ts
new DecisionEngine(new MockProvider());
new DecisionEngine(new JevProvider({ apiKey: process.env.TYPESAFE_API_KEY }));
```

#### MockProvider

```ts
const provider = new MockProvider({
  responder: (request) => ({
    answers: {
      intent: {
        type: "categorical",
        probabilities: { billing: 0.7, technical: 0.2, sales: 0.1 },
        confidence: 0.75,
      },
    },
  }),
});
```

Without a `responder` it returns uniform probabilities (`0.5` for booleans, `1 / n` for n-way
distributions).

#### JevProvider

```ts
new JevProvider({
  apiKey: process.env.TYPESAFE_API_KEY, // or the TYPESAFE_API_KEY env var
  baseUrl, // endpoint override
  model, // model override
  headers, // extra request headers
  timeoutMs, // client-side timeout; the engine's timeout also applies
  fetch, // transport override
});
```

`JevProvider` translates Decimo's question types into Jev's vocabulary internally and translates
the answers back, so your code never handles a Jev request or response. The API key is read from
`apiKey`, from the variable named by `apiKeyEnvVar`, or from `TYPESAFE_API_KEY`. `fetch` is
injectable, which is how the test suite exercises the whole provider stack without a key.

#### Your own provider

Implement `DecisionProvider` and you get the same typed results. See
[`examples/custom-provider.ts`](examples/custom-provider.ts).

### Errors

```text
DecimoError
├── ProviderError
│   ├── ProviderTimeoutError
│   └── InvalidProviderResponseError
└── ConfigurationError
```

- HTTP and transport failures surface as `ProviderError`.
- Timeouts are `ProviderTimeoutError` and carry `timeoutMs`; the in-flight request is aborted.
- Missing answers, unrequested answers, answer-type mismatches, unknown or missing distribution
  values, non-numeric probabilities and distributions that do not sum to `1` all raise
  `InvalidProviderResponseError` — a malformed response never silently produces a result.
- `ConfigurationError` covers invalid questions, non-JSON state and missing credentials.

```ts
import { isDecimoError, ProviderTimeoutError } from "decimo";

try {
  await engine.evaluate(decision, state);
} catch (error) {
  if (error instanceof ProviderTimeoutError) {
    console.error(`inference timed out after ${error.timeoutMs}ms`);
  } else if (isDecimoError(error)) {
    console.error(error.name, error.message);
  }
}
```

## API

| Export                                                                                           | Purpose                                                                                             |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `defineDecision(definition)`                                                                     | Validates and returns the decision, preserving types                                                |
| `DecisionEngine(provider, options?)`                                                             | `evaluate(decision, state)`; `options`: `timeoutMs` (default `30000`, `0` disables), `providerName` |
| `boolean` / `categorical` / `ordinal`                                                            | Question builders                                                                                   |
| `MockProvider` / `JevProvider`                                                                   | Providers, each configured by its own options                                                       |
| `DecisionResult<D>`, `ResultFor<Q>`, `BooleanResult`, `CategoricalResult<T>`, `OrdinalResult<T>` | Result types                                                                                        |
| `DecimoError` and subclasses                                                                     | Error types                                                                                         |
| `DecisionProvider`, `ProviderRequest`, `ProviderResponse`, `NormalizedQuestion`                  | The provider contract, for writing your own provider                                                |
| `JsonValue`, `JsonObject`                                                                        | State types                                                                                         |
| `HttpFetch`, `HttpRequestInit`, `HttpResponse`                                                   | Transport shapes, for injecting a `fetch`                                                           |

## Development

```sh
npm install
npm test          # vitest, no API key required
npm run typecheck # tsc over src, test and examples, including the type-level tests
npm run lint
npm run build
```

Type inference is a product feature, so it is tested explicitly in `test/types.test.ts` with
`expectTypeOf` and `@ts-expect-error`; `npm run typecheck` fails if the key unions are ever
widened or if an invalid value stops being rejected. `test/public-api.test.ts` similarly fails if
provider internals are ever re-exported.

See [`examples/`](examples/) for runnable-shaped usage: the support-triage loop, the same decision
driven by Jev, a hand-written provider, and the error paths.

## License

MIT
