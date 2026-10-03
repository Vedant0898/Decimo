# Decimo

![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=18](https://img.shields.io/badge/node-%3E%3D18-5FA04E)

**Probabilistic decision middleware for TypeScript.**

Applications constantly make decisions from fuzzy signals: is this message billing or technical?
Should we escalate to a human? Is this request urgent? Today those answers usually become a
scattering of `if` statements wrapped around magic thresholds, duplicated across services and
impossible to test at the boundaries. Decimo lets you declare the questions once, hand it your
application state, and get back **typed probabilities** instead of a bare boolean.

```ts
import {
  boolean,
  categorical,
  DecisionEngine,
  defineDecision,
  MockProvider,
} from "decimo";

const triage = defineDecision({
  intent: categorical({
    description: "Which team should handle this message?",
    values: {
      billing: "Payments and invoices",
      support: "Technical problems",
    },
  }),
  needsHuman: boolean({ description: "Does this need a human to reply?" }),
});

const engine = new DecisionEngine(new MockProvider());

const result = await engine.evaluate(triage, {
  message: "Charged twice and nobody has replied",
});

result.intent.probability("billing"); // number
result.intent.mostLikely(); // typed: "billing" | "support"
result.intent.distribution(); // { billing: number; support: number }
result.needsHuman.probability; // number

result.intent.probability("unknown"); // ✗ compile error
```

Replace `new MockProvider()` with `new JevProvider()` and the same code runs against a real
decision model. The decision, the state, and the result types are identical.

```sh
npm install decimo     # not published yet — see Quick start for running from source
```

> **Status:** `v0.1.0`, not yet published to npm and without CI. See
> [Project Status](#13-project-status).

---

## Table of contents

1. [Why Decimo?](#1-why-decimo)
2. [Core concept](#2-core-concept)
3. [Quick start](#3-quick-start)
4. [Ordering contract](#4-ordering-contract)
5. [Example use cases](#5-example-use-cases)
6. [Why not just if/else?](#6-why-not-just-ifelse)
7. [Architecture](#7-architecture)
8. [Providers](#8-providers)
9. [API reference](#9-api-reference)
10. [Configuration](#10-configuration)
11. [Error handling](#11-error-handling)
12. [Testing and development](#12-testing-and-development)
13. [Project status](#13-project-status)
14. [Scope and roadmap](#14-scope-and-roadmap)
15. [Contributing](#15-contributing)
16. [License](#16-license)

---

## 1. Why Decimo?

Consider a triage rule that has grown over time:

```ts
if (score > 0.82) escalate();
else if (message.includes("refund") && tier === "premium") escalate();
else if (keywords.length > 3 && !recentlyContacted) escalate();
```

This is not bad code — it is what most systems end up with. But notice what it cannot do:

- **It hides near-misses.** `score` of `0.81` and `0.83` behave identically. You cannot route the
  `0.81` case differently, ask for a second opinion, or send it to a cheaper path.
- **It has no testable surface.** The rules are scattered across the codebase, and exercising the
  boundary means constructing exactly the state that produces `0.82`.
- **It mixes the question with the policy.** "How billing is this?" and "what do we do about it?"
  end up in the same function, so you cannot change one without touching the other.

Decimo separates the two. You declare the _question_; the provider answers it with a probability;
_you_ keep the policy:

```ts
const triage = defineDecision({
  intent: categorical({
    description: "Which team should handle this message?",
    values: { billing: "Payments", support: "Technical problems" },
  }),
  escalationRisk: ordinal({
    description: "How risky is escalating this to a human?",
    values: [
      { key: "low", description: "An agent can resolve this" },
      { key: "high", description: "Only a specialist should respond" },
    ],
  }),
});

const result = await engine.evaluate(triage, state);

// The policy stays in your code, where you can reason about it and change it freely.
if (result.intent.probability("billing") > 0.7) {
  routeToBillingQueue();
}

// A different threshold, a different policy, off the same probability.
if (
  result.escalationRisk.probability("high") > 0.5 &&
  result.intent.mostLikely() !== "billing"
) {
  assignSpecialist();
}
```

Nothing about `if/else` is forbidden. The difference is that the condition now reads as a
statement about _uncertainty_, and the same probability can drive several different policies —
a strict threshold for one route, a lenient one for a fallback, a review queue in between.

---

## 2. Core concept

Decimo has five ideas. That is the whole model.

| Concept      | What it is                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| **Question** | A typed thing you want to know: `boolean`, `categorical`, or `ordinal`.                                 |
| **State**    | Arbitrary JSON you already have — a message, a record, an array of log lines.                           |
| **Provider** | Something that answers the questions, turning state into probabilities.                                 |
| **Engine**   | Validates the decision, calls the provider once, validates the answer, returns results.                 |
| **Result**   | A probability per question, with `probability()`, `mostLikely()` and `distribution()` where applicable. |

The flow:

```text
your code
   │
   │  1. decision (declared once, types preserved)
   │  2. state      (any JSON)
   ▼
DecisionEngine
   │  validates the decision → canonical form
   │  calls the provider once, with every question
   ▼
DecisionProvider  ── MockProvider    (uniform, offline, for tests)
   │               └─ JevProvider    (HTTP, real model)
   │
   │  3. validated probabilities
   ▼
typed results  →  your code decides what to do
```

Three properties follow from that diagram, and they are the point of the library:

1. **Questions are typed, and the types survive.** `probability()` only accepts the values you
   declared. A renamed option is a compile error, not a silently-zero runtime branch.
2. **The provider is replaceable.** The same decision runs against a deterministic mock in tests
   and a real model in production. Nothing provider-specific appears in your code — no `noul`,
   no `choice`, no prompt strings, no HTTP.
3. **Probabilities are not decisions.** Decimo never calls your functions, never takes an action.
   The threshold stays in your code, where the business rule belongs.

---

## 3. Quick start

### Install

```sh
npm install decimo
```

> The package is **not published yet**, so `npm install decimo` will not resolve today. To work
> against the source:
>
> ```sh
> git clone https://github.com/Vedant0898/Decimo.git
> cd Decimo
> npm install
> npm run build
> ```
>
> Then import from the build output, or from `src/index.ts` if you are developing inside the repo
> (that is what [`examples/`](examples/) does).

### Smallest working example

Define the questions, choose a provider, evaluate:

```ts
import {
  boolean,
  categorical,
  DecisionEngine,
  defineDecision,
  MockProvider,
} from "decimo";

// 1. What do you want to know?
const decision = defineDecision({
  intent: categorical({
    description: "Which team should handle this message?",
    values: {
      billing: "Payments and invoices",
      support: "Technical problems",
    },
  }),
  needsHuman: boolean({ description: "Does this need a human to reply?" }),
});

// 2. Which provider answers it?
const engine = new DecisionEngine(new MockProvider());

// 3. Hand it state; read the typed probabilities.
const result = await engine.evaluate(decision, {
  message: "Charged twice and nobody has replied",
  customerTier: "premium",
});

result.intent.mostLikely(); // "billing" | "support"
result.intent.distribution(); // { billing: number, support: number }
result.needsHuman.probability; // number in [0, 1]

// Branch on a threshold you control.
if (result.needsHuman.probability > 0.6) {
  queue.push("human-review");
}
```

`MockProvider` returns uniform probabilities (`0.5` for booleans, `1 / n` across declared values),
so it is deterministic and offline — ideal for tests and local development. To script specific
answers:

```ts
import { MockProvider } from "decimo";

const provider = new MockProvider({
  responder: () => ({
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

To run against a real model, swap in `JevProvider` — the decision and result code are unchanged:

```ts
import { DecisionEngine, JevProvider } from "decimo";

const engine = new DecisionEngine(
  new JevProvider({ apiKey: process.env.TYPESAFE_API_KEY }),
  { timeoutMs: 15_000 },
);
```

---

## 4. Ordering contract

Ordering is semantic for `ordinal` and cosmetic for `categorical`, so the two builders take
different shapes.

**`categorical` — unordered.** `values` is a `Record<key, description>`. The keys become your typed
value union. Declaration order only affects which key wins a tie in `mostLikely()` and how
`distribution()` orders its keys.

**`ordinal` — ordered.** `values` is an **ordered array** of `{ key, description }`, and the array
order _is_ the scale: the order levels reach the provider, the order `mostLikely()` breaks ties
in, and the order `distribution()` reports keys in.

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

A `Record` cannot express this safely, because JavaScript reorders integer-like keys ahead of
declaration order:

```ts
Object.keys({ 5: "terrible", 1: "great" }); // → [ "1", "5" ] — declaration order lost
```

A record-based ordinal could therefore hand a provider a **reversed rubric**. An array cannot be
reordered, so the ordering contract is structural. `ordinal()` rejects duplicate keys, fewer than
two levels, and empty keys or descriptions.

One caveat: `distribution()` returns a plain object, and JavaScript renders integer-like keys
numerically. Read it by key rather than iterating its entries if your level keys are numeric
strings.

---

## 5. Example use cases

Decimo is a thin decision layer, so these are _decisions it can carry_, not products it provides.
It has no rules engine, no memory, and no training loop — it turns state into typed probabilities
and gets out of the way.

**Moderation and review queues.** Decide whether content should publish, go to review, or be
blocked, and how confident that call is. See
[`examples/error-handling.ts`](examples/error-handling.ts), which defines exactly this decision.

```ts
const decision = defineDecision({
  verdict: categorical({
    description: "Should this content be published?",
    values: {
      allow: "Publish as is",
      review: "Send to a moderator",
      block: "Reject outright",
    },
  }),
});
// result.verdict.mostLikely() === "review", with the full distribution behind it.
```

**Routing and provider selection.** Pick a queue, a region, or an upstream model from several
candidates, then let cost or availability rules in your code override a close call.

**Escalation and risk gating.** Ask a boolean "does this need a human?" and keep the threshold
where you can tune it per account tier or per environment.

**Support triage.** Multiple questions — which department, how urgent, does it need a human — over
the same state, answered in a single provider call. See
[`examples/support-triage.ts`](examples/support-triage.ts).

**Rollout and retry policy.** Use an ordinal question to place a request on a scale, then branch on
how confident you are rather than on a single opaque score.

---

## 6. Why not just if/else?

| Approach               | Best suited for                                             | Limitation                                                                  |
| ---------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `if` / `else`          | Deterministic business rules you can enumerate              | One path per outcome; no notion of "probably"; hard to test at edges        |
| Feature flags          | Deploying a known-good variant to a known audience          | Decides _which variant_, not _what the situation means_                     |
| An ML model in-process | Tasks with training data, labels and a measurable objective | Requires labelled data and a retraining loop; returns a task-specific label |
| A general LLM call     | Open-ended generation and reasoning                         | Prose output needs parsing, and prompts become a hidden dependency          |
| **Decimo**             | Bounded, typed judgements about the state you already have  | One decision at a time; no training, caching, or orchestration of its own   |

Decimo is **middleware, not a replacement**. It does not replace your feature-flag service or your
fraud model. It replaces the ad-hoc decision logic that sits _around_ them, with a typed interface
that is cheap to test and easy to swap an inference backend for.

The distinction that matters: a feature flag answers "which variant should this user get?" — a
decision you already made. Decimo answers "what does this situation look like?" — a decision you
are deferring. Those compose well:

```ts
if (
  flags.isEnabled("billing-v2") &&
  result.intent.probability("billing") > 0.7
) {
  routeToBillingQueue();
}
```

---

## 7. Architecture

```text
src/
├── index.ts               public surface; provider internals stay private
├── core/
│   ├── decision.ts        decision/result types; validate → canonicalize
│   ├── response.ts        the provider-response boundary (all validation)
│   ├── result.ts          pure result construction
│   ├── engine.ts          orchestration: prepare → call → validate → build
│   └── errors.ts          the error hierarchy
├── schema/
│   ├── types.ts           public question types + builder argument validation
│   ├── canonical.ts       Decimo's canonical questions/answers
│   ├── boolean.ts  categorical.ts  ordinal.ts
├── providers/
│   ├── provider.ts        the provider port
│   ├── mock.ts            MockProvider
│   └── jev/               client, mapper, wire types, JevProvider
└── types/
    ├── json.ts            JSON state types + runtime checks
    └── http.ts            injectable fetch transport types
```

**`core/decision.ts`** — holds `DecisionSpec`, `ResultFor` and `DecisionResult`. Two distinct
steps: `validateDecision()` asks whether a definition is well-formed, `canonicalizeDecision()`
converts it into the representation providers receive (ids attached, an explicit ordered level
list). `prepareDecision()` runs both, and it is the only place a decision is ever inspected.
`defineDecision()` does no runtime work — it exists to anchor types.

**`core/response.ts`** — the single boundary where provider output is treated as untrusted. It
checks response shape, that every requested question was answered and nothing else was, that each
answer matches its question's kind, and that every probability is a finite number in `[0, 1]`.
Distributions must cover exactly the declared values and sum to `1`. It returns question/answer
pairs with numbers already known good, which is what lets `core/result.ts` be pure.

**`core/result.ts`** — builds the objects you consume. Ties in `mostLikely()` resolve to the
earliest declared level, because the canonical level list is ordered.

**`core/engine.ts`** — orchestration only: `prepareDecision` → `assertJsonValue` → call the
provider → validate → build results. It enforces the timeout with an `AbortController`, wrapping
any provider rejection in a `DecimoError`.

**`schema/canonical.ts`** — the representation that crosses the provider boundary. Questions carry
an `id` and an ordered `levels` array, never a `Record`, so order is explicit end to end. This
type is Decimo's own: it belongs neither to your builder call nor to any provider's wire format.

**`schema/types.ts`** — the public question types, plus the argument validators the builders call.
`categorical` keeps its `Record`; `ordinal` takes an ordered array (see
[Ordering contract](#4-ordering-contract)).

**Dependency direction:** `core` depends on `schema` and `types`, and imports only the
`DecisionProvider` port from `providers`. No provider implementation and no canonical
representation lives in the provider layer.

---

## 8. Providers

A provider answers questions. That is the entire interface:

```ts
interface DecisionProvider {
  evaluate(
    request: ProviderRequest,
    context?: ProviderContext,
  ): Promise<ProviderResponse>;
}
```

It receives the application `state` plus the canonical questions (keyed by question name, each
with an ordered `levels` list) and returns answers keyed the same way. Decimo validates what comes
back, so a provider never has to defend itself — and never has to trust its input either.

### MockProvider

Deterministic uniform answers: `0.5` for booleans, `1 / n` across declared values. No network, no
credentials, no clock. This is what makes the rest of the library testable:

```ts
import { MockProvider, type ProviderResponse } from "decimo";

const provider = new MockProvider();

// Script specific answers…
new MockProvider({
  responder: (request) => {
    // request.state and request.questions describe what was asked
    return { answers: {/* … */} };
  },
});

// …or fail deliberately, to exercise your error paths.
new MockProvider({
  responder: () => ({
    answers: { intent: { type: "boolean", probability: 0.5 } },
  }),
});
```

### JevProvider

An HTTP provider for [Jev](https://docs.typesafe.ai/api), TypeSafe's decision model. It POSTs to
`https://api.typesafe.ai/v1/systemone` by default and maps Decimo's three question types onto Jev's
vocabulary internally:

| Decimo        | Jev      | Note                                                        |
| ------------- | -------- | ----------------------------------------------------------- |
| `boolean`     | `noul`   | probability in `[0, 1]`                                     |
| `categorical` | `choice` | declared value keys pass straight through                   |
| `ordinal`     | `score`  | ordered `levels` become the rubric; index keys are remapped |

```ts
import { DecisionEngine, JevProvider } from "decimo";

const engine = new DecisionEngine(
  new JevProvider({
    apiKey: process.env.TYPESAFE_API_KEY, // or the TYPESAFE_API_KEY env var
    model: "jev-latest",
  }),
);
```

`fetch`, `baseUrl`, `headers` and `timeoutMs` are all injectable — which is how the test suite
exercises the full provider stack without a key or a network call. All questions in one decision
are sent in a single request.

### Writing your own

Implement `evaluate` and you get the same typed results. A full worked example is in
[`examples/custom-provider.ts`](examples/custom-provider.ts):

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

Providers must answer every requested question, use the same keys, match each question's kind, and
give distributions that sum to `1`. Anything else is rejected at the boundary with an
`InvalidProviderResponseError`.

---

## 9. API reference

### Question builders

```ts
boolean(config: { description: string }): BooleanQuestion

categorical<T extends Record<string, string>>(config: {
  description: string;
  values: T;
}): CategoricalQuestion<T>

ordinal<T extends string>(config: {
  description: string;
  values: readonly OrdinalValue<T>[];
}): OrdinalQuestion<T>
```

All three validate their arguments eagerly and throw `ConfigurationError` on bad input (empty
description, empty value record, fewer than two levels, duplicate ordinal keys). `T` is inferred
from the literal keys, which is what preserves your value union.

### `defineDecision`

```ts
defineDecision<D extends DecisionSpec>(decision: D): D
```

Returns the decision unchanged. It exists to anchor types, so the value union survives; it performs
**no runtime validation**. Structural problems surface at `evaluate()` time instead — one
validation point rather than two.

### `DecisionEngine`

```ts
new DecisionEngine(provider: DecisionProvider, options?: DecisionEngineOptions)

evaluate<D extends DecisionSpec>(
  decision: D,
  state: JsonValue,
): Promise<DecisionResult<D>>
```

`state` is any JSON value — a string, an array, a nested object. It is validated before the provider
is called, so `undefined`, functions, `Date`s, `BigInt`s and circular references fail fast as
`ConfigurationError`. One `evaluate()` call means exactly one provider call.

### Results

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

- `mostLikely()` breaks ties toward the earliest declared value.
- `distribution()` returns a copy; mutating it does not affect the result.
- `confidence` is a separate concept from `probability`, and is only present when the provider
  reports one. `MockProvider` does not.

```ts
result.intent.probability("billing"); // number
result.intent.mostLikely(); // "billing" | "support"
result.intent.distribution(); // { billing: number; support: number }
result.needsHuman.probability; // number
result.needsHuman.confidence; // number | undefined

result.intent.probability("unknown"); // ✗ compile error
```

### Types

| Type                                                                         | Purpose                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------- |
| `DecisionSpec`                                                               | `Record<string, Question>` — what a decision is |
| `DecisionResult<D>`                                                          | Results for `D`, keyed by question name         |
| `ResultFor<Q>`                                                               | The result kind a question kind produces        |
| `BooleanResult`, `CategoricalResult<T>`, `OrdinalResult<T>`                  | Result shapes                                   |
| `BooleanAnswer`, `CategoricalAnswer`, `OrdinalAnswer`, `CanonicalAnswer`     | What a provider returns                         |
| `CanonicalQuestion`, `CanonicalLevel`, `CanonicalDecision`                   | What a provider receives                        |
| `DecisionProvider`, `ProviderRequest`, `ProviderResponse`, `ProviderContext` | The provider port                               |
| `JsonValue`, `JsonObject`                                                    | State types                                     |
| `HttpFetch`, `HttpRequestInit`, `HttpResponse`                               | Transport types for injecting `fetch`           |

---

## 10. Configuration

There is no global configuration and no config file. Everything is passed explicitly.

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

| Option         | Type                     | Default                                | Purpose                                                          |
| -------------- | ------------------------ | -------------------------------------- | ---------------------------------------------------------------- |
| `apiKey`       | `string`                 | `TYPESAFE_API_KEY` env                 | Bearer credential; throws `ConfigurationError` if neither is set |
| `apiKeyEnvVar` | `string`                 | `"TYPESAFE_API_KEY"`                   | Which environment variable to read                               |
| `baseUrl`      | `string`                 | `https://api.typesafe.ai/v1/systemone` | Endpoint override                                                |
| `model`        | `string`                 | `"jev-latest"`                         | Model identifier                                                 |
| `headers`      | `Record<string, string>` | —                                      | Extra headers merged into every request                          |
| `timeoutMs`    | `number`                 | engine's timeout                       | Client-side timeout; `0` disables                                |
| `fetch`        | `HttpFetch`              | global `fetch`                         | Transport override for tests and proxies                         |

### Tolerance

`DISTRIBUTION_SUM_TOLERANCE` (`1e-6`) is the maximum deviation a provider's distribution may have
from summing to `1`. Custom providers do not need to hit it exactly.

---

## 11. Error handling

Every failure Decimo raises is a `DecimoError`:

```text
DecimoError
├── ProviderError                  transport or HTTP failure; carries .provider
│   ├── ProviderTimeoutError       the timeout elapsed; carries .timeoutMs
│   └── InvalidProviderResponseError  the payload was unusable; carries .details
└── ConfigurationError             bad question, non-JSON state, missing credentials
```

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
    throw error; // not ours
  }
}
```

What the boundary rejects, all as `InvalidProviderResponseError`:

- the response is not an object, or has no `answers` map
- a requested question was not answered
- an answer arrived for a question that was never asked
- an answer's kind does not match its question
- a probability or confidence is non-numeric, non-finite, or outside `[0, 1]`
- a distribution omits a declared value, contains an undeclared value, or does not sum to `1`

`details` carries `{ provider, questionId, received }` for debugging. A malformed provider response
never silently produces a result — and a non-Decimo error thrown by a provider is wrapped in a
`ProviderError` with the original as `cause`.

---

## 12. Testing and development

```sh
npm install

npm test           # vitest run — 143 tests, no credentials or network needed
npm run test:watch # vitest in watch mode
npm run typecheck  # tsc over src, test and examples, including the type-level tests
npm run lint       # eslint
npm run format     # prettier --write .
npm run format:check
npm run build      # tsup → dist (ESM, CJS, .d.ts)
npm run dev        # tsup --watch
```

Type inference is treated as a product feature, so it is tested explicitly in
[`test/types.test.ts`](test/types.test.ts) with `@ts-expect-error` and exact-identity assertions
checked by `tsc`. `npm run typecheck` fails if a value union is ever widened or if an invalid value
stops being rejected. [`test/public-api.test.ts`](test/public-api.test.ts) fails if provider
internals or engine internals are ever re-exported.

### Examples

[`examples/`](examples/) contains five runnable-shaped programs:

| File                                                  | Shows                                               |
| ----------------------------------------------------- | --------------------------------------------------- |
| [`support-decision.ts`](examples/support-decision.ts) | The decision and state shared by the other examples |
| [`support-triage.ts`](examples/support-triage.ts)     | The full loop with `MockProvider`                   |
| [`jev-provider.ts`](examples/jev-provider.ts)         | The same decision with `JevProvider`                |
| [`custom-provider.ts`](examples/custom-provider.ts)   | Implementing `DecisionProvider` yourself            |
| [`error-handling.ts`](examples/error-handling.ts)     | Timeouts, malformed responses, configuration errors |

They are type-checked by `npm run typecheck`, which is why they import from `../src/index` rather
than `"decimo"` — so they always match the current source without a build step. They are not
wired into a run script.

---

## 13. Project status

**Decimo is under active development. APIs may change before the first stable release.**

Concretely, today:

- **Not published to npm.** `npm install decimo` will not resolve; use the source for now.
- **`v0.1.0`.** No stability guarantee.
- **No CI.** The quality gates above run locally.
- **One external provider.** `JevProvider`. Everything else is `MockProvider` or a provider you
  write. `JevProvider` also depends on a third-party API, so it is only exercised against a stub
  `fetch` in this repo's own tests.
- **No persistence, caching, batching or streaming.** Each `evaluate()` is one provider call.

---

## 14. Scope and roadmap

### Deliberately out of scope

The product requirements document lists these as non-goals for the current version, and none of
them exist today:

- policy or rules engine
- model routing logic
- calibration
- an evaluation dashboard
- persistent caching
- an observability platform
- multiple external providers
- distributed infrastructure
- a prompt or DSL system

If you need one of these today, build it above Decimo. The engine's narrow surface is designed to
be composed with them.

### Potential directions

Not committed, and not scheduled — just the directions the current design points toward:

- batching several decisions into one provider call
- a decision-composition layer over the existing single-question primitives
- more provider adapters
- runtime result inspection / debugging tooling

---

## 15. Contributing

There is no `CONTRIBUTING.md` yet; this section is the short version.

- **Report bugs and propose features** via
  [GitHub issues](https://github.com/Vedant0898/Decimo/issues).
- **Before opening a pull request**, make sure these pass:

  ```sh
  npm run typecheck
  npm test
  npm run lint
  npm run format:check
  npm run build
  ```

- **Add tests.** New behaviour needs coverage in `test/`, and any change to inference or the public
  surface needs a matching change in `test/types.test.ts` or `test/public-api.test.ts`.
- **Keep the provider boundary clean.** Provider wire formats belong in
  `src/providers/<name>/`; the public surface should expose only the provider's constructor and
  options.
- **Format with Prettier** (`npm run format`) rather than hand-editing style.

---

## 16. License

MIT — see [LICENSE](LICENSE).
