# Providers

A provider answers questions. That is the whole interface.

```ts
interface DecisionProvider {
  evaluate(
    request: ProviderRequest,
    context?: ProviderContext,
  ): Promise<ProviderResponse>;
}
```

- [What a provider receives](#what-a-provider-receives)
- [What a provider returns](#what-a-provider-returns)
- [MockProvider](#mockprovider)
- [JevProvider](#jevprovider)
- [Writing your own](#writing-your-own)
- [Rules every provider must follow](#rules-every-provider-must-follow)

---

## What a provider receives

```ts
interface ProviderRequest {
  readonly state: JsonValue;
  readonly questions: CanonicalDecision; // keyed by question name
}
```

Each canonical question carries an `id`, a `description`, and — for `categorical` and `ordinal` —
an ordered `levels` array:

```ts
interface CanonicalLevel {
  readonly key: string;
  readonly description: string;
}

interface CanonicalOrdinalQuestion {
  readonly id: string;
  readonly type: "ordinal";
  readonly description: string;
  readonly levels: readonly CanonicalLevel[]; // the scale, in order
}
```

Levels are an array rather than a `Record` so that order is explicit end to end. See the
[ordering contract](./api.md#ordering-contract).

`context` carries an `AbortSignal` and the effective `timeoutMs`, so a provider can cancel its
in-flight work.

## What a provider returns

```ts
interface ProviderResponse {
  readonly answers: Readonly<Record<string, CanonicalAnswer>>;
  readonly raw?: unknown; // the untouched payload, never interpreted
}

type CanonicalAnswer = BooleanAnswer | CategoricalAnswer | OrdinalAnswer;

interface BooleanAnswer {
  readonly type: "boolean";
  readonly probability: number;
  readonly confidence?: number;
}

interface CategoricalAnswer {
  readonly type: "categorical";
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence?: number;
}
```

`OrdinalAnswer` mirrors `CategoricalAnswer` with `type: "ordinal"`.

## Why the abstraction exists

The same decision should run against different providers without touching application
code: a deterministic mock in unit tests, a real model in production, a hand-written heuristic as a
fallback. Everything provider-specific — wire formats, prompts, transport — stays inside the
provider's module. `JevProvider` is one implementation, not the design.

That also means Decimo is not an LLM wrapper. A provider can be a rules engine or a keyword
heuristic; [`examples/custom-provider.ts`](../examples/custom-provider.ts) is one.

## `MockProvider`

Deterministic uniform answers: `0.5` for booleans, `1 / n` across declared values. No network, no
credentials, no clock. It also reports no `confidence`, which keeps that field honestly optional.

```ts
import { MockProvider } from "decimo";

new MockProvider();
```

Script specific answers with a `responder`:

```ts
const provider = new MockProvider({
  responder: (request) => ({
    answers: {
      intent: {
        type: "categorical",
        probabilities: { billing: 0.7, support: 0.3 },
        confidence: 0.75,
      },
      needsHuman: { type: "boolean", probability: 0.08 },
    },
  }),
});
```

The responder may be async, and receives the same `(request, context)` pair as a real provider —
which makes it useful for exercising error paths:

```ts
new MockProvider({
  responder: async () => {
    throw new Error("simulated outage");
  },
});
```

## `JevProvider`

An HTTP provider for [Jev](https://docs.typesafe.ai/api), TypeSafe's decision model. It POSTs to
`https://api.typesafe.ai/v1/systemone` by default, authenticates with a bearer token, and sends every
question in one request.

```ts
import { DecisionEngine, JevProvider } from "decimo";

const engine = new DecisionEngine(
  new JevProvider({ apiKey: process.env.TYPESAFE_API_KEY }),
  { timeoutMs: 15_000 },
);
```

The API key is read from `apiKey`, then the variable named by `apiKeyEnvVar` (default
`TYPESAFE_API_KEY`). If none is set, the constructor throws `ConfigurationError`.

### Translation

Decimo's question types map onto Jev's vocabulary entirely inside `src/providers/jev/`. None of it
reaches your code.

| Decimo        | Jev      | Note                                                                                               |
| ------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `boolean`     | `noul`   | probability in `[0, 1]`                                                                            |
| `categorical` | `choice` | declared level keys pass straight through as `criteria`                                            |
| `ordinal`     | `score`  | ordered `levels` become the rubric; the answer's index keys are remapped back onto your level keys |

Answers are mapped back into canonical answers and then handed to Decimo's boundary, which does all
range and distribution validation. A provider does not need to defend its input, and does not need
to validate its own output either.

`fetch`, `baseUrl`, `headers`, `model` and `timeoutMs` are all injectable. See the
[`JevProviderOptions` table](./api.md#jevprovideroptions). Injecting `fetch` is how this repository's
own tests exercise the full provider stack without a key or a network call.

### Errors

| Situation                     | Result                                                  |
| ----------------------------- | ------------------------------------------------------- |
| Non-2xx status                | `ProviderError` including the status and server message |
| `401`                         | `ProviderError` — check the credential                  |
| `429` / `529`                 | `ProviderError` — back off and retry                    |
| Non-JSON or missing `answers` | `InvalidProviderResponseError`                          |
| Timeout                       | `ProviderTimeoutError`                                  |

Retries and backoff are deliberately not handled for you; `429` and `529` are worth a retry policy
that matches your traffic.

## Writing your own

Implement `evaluate` and you get the same typed results. A complete worked example is in
[`examples/custom-provider.ts`](../examples/custom-provider.ts).

```ts
import type {
  CanonicalAnswer,
  DecisionProvider,
  ProviderRequest,
  ProviderResponse,
} from "decimo";

class KeywordProvider implements DecisionProvider {
  readonly name = "keyword";

  async evaluate(request: ProviderRequest): Promise<ProviderResponse> {
    const answers: Record<string, CanonicalAnswer> = {};

    for (const [id, question] of Object.entries(request.questions)) {
      switch (question.type) {
        case "boolean":
          answers[id] = { type: "boolean", probability: 0.5 };
          break;
        case "categorical":
          answers[id] = {
            type: "categorical",
            probabilities: uniform(question.levels.map((level) => level.key)),
          };
          break;
        case "ordinal":
          answers[id] = {
            type: "ordinal",
            probabilities: uniform(question.levels.map((level) => level.key)),
          };
          break;
      }
    }

    return { answers };
  }
}

function uniform(values: string[]): Record<string, number> {
  return Object.fromEntries(values.map((value) => [value, 1 / values.length]));
}
```

A `name` property is optional but useful: it appears in error messages, so `DecisionEngine` falls
back to `"unknown"` without one.

The engine reads the provider's `name` reflectively, so any object literal works — no base class or
interface implementation required beyond the method itself.

## Rules every provider must follow

Decimo validates everything below and raises `InvalidProviderResponseError` on a breach:

1. Answer **every** requested question, keyed by the same question name.
2. Answer **only** requested questions.
3. Match each answer's `type` to its question's kind.
4. Supply finite probabilities within `[0, 1]`; omit `confidence` rather than guessing it.
5. Supply a distribution covering **exactly** the declared levels, summing to `1` within
   `DISTRIBUTION_SUM_TOLERANCE`.
