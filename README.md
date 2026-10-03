# Decimo

> **Define the question once. Swap providers without changing your application-facing types.**

[![npm](https://img.shields.io/npm/v/decimo)](https://www.npmjs.com/package/decimo)
[![CI](https://github.com/Vedant0898/Decimo/actions/workflows/ci.yml/badge.svg)](https://github.com/Vedant0898/Decimo/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/decimo)](./LICENSE)

A typed probabilistic decision layer for TypeScript.

Applications constantly decide things from fuzzy signals: which team should take this ticket, does
it need a human, how urgent is it, should this request be allowed through. Those answers usually
end up as `if` statements wrapped around a magic threshold. Decimo lets you declare the questions,
hand it your application state, and get back typed probabilities — while the policy stays in your
code.

## From opaque scores to explicit questions

```ts
// Traditional: one opaque score, one path per outcome.
const score = riskScore(ticket);

if (score > 0.82) return escalate();
if (score > 0.4) return review();
return autoResolve();
```

```ts
// with Decimo, the questions are explicit
const decision = defineDecision({
  urgency: ordinal({
    description: "How urgent is this request?",
    values: [
      { key: "low", description: "Can be handled normally" },
      { key: "high", description: "Requires prompt attention" },
    ],
  }),
  needsHuman: boolean({ description: "Does this require a human?" }),
});

const result = await engine.evaluate(decision, state);

if (
  result.urgency.probability("high") > 0.7 &&
  result.needsHuman.probability > 0.5
) {
  return escalate(); // the same result can drive multiple policies
}
if (result.urgency.probability("high") > 0.4) return review();

return autoResolve();
```

The second half is the part worth having. Suppose the provider scores `low` at 0.15 and `high`
at 0.83 — the same signal, read at two thresholds, with no second call:

```ts
result.urgency.probability("high"); // 0.83
result.urgency.probability("low"); // 0.15

result.urgency.distribution(); // { low: number; high: number }
result.urgency.mostLikely(); // "low" | "high" — inferred union

result.urgency.probability("medium"); // ✗ compile error: never declared
```

## How it works

| Concept      | What it is                                                             |
| ------------ | ---------------------------------------------------------------------- |
| **Question** | A typed thing you want to know: `boolean`, `categorical` or `ordinal`. |
| **State**    | Any JSON you already have: a message, a record, an array of log lines. |
| **Provider** | Answers those questions from your state.                               |
| **Engine**   | Validates the decision, calls the provider once, validates the answer. |
| **Result**   | A probability per question, plus lookups over the full distribution.   |

```text
  Question + State
        │
        ▼
  DecisionEngine ──▶ Provider      one call, every question
        │
        ▼
  Probability ──▶ Your policy      thresholds stay in your code
```

Two things follow. The provider is replaceable: the same decision can run against a deterministic mock in tests
and a production provider in your application, with the decision definition and result types unchanged.
And a probability is not a decision - Decimo never calls your functions or takes an
action.

**What "probability" means here.** Compare them against each other and against thresholds you
choose — that is what they are for, and Decimo validates that every one is within `[0, 1]` and that
distributions cover exactly your declared values. Decimo does not calibrate a provider's outputs, so
their interpretation and reliability depend on the provider. See
[scope](./docs/development.md#scope).

## Install

```sh
npm install decimo
```

Requires Node 22+. ESM and CJS are both shipped, with types.

## Quick start

```ts
import {
  boolean,
  categorical,
  DecisionEngine,
  defineDecision,
  MockProvider,
  ordinal,
} from "decimo";

const decision = defineDecision({
  intent: categorical({
    description: "Which team should handle this message?",
    values: {
      billing: "Payments and invoices",
      support: "Technical problems",
    },
  }),
  needsHuman: boolean({ description: "Does this need a human to reply?" }),
  urgency: ordinal({
    description: "How urgent is this message?",
    values: [
      { key: "low", description: "Can wait" },
      { key: "high", description: "Blocking the customer" },
    ],
  }),
});

// Offline and deterministic. Swap in JevProvider for production inference.
const engine = new DecisionEngine(new MockProvider());

// Three questions, One provider call.
const result = await engine.evaluate(decision, {
  message: "Charged twice and nobody has replied",
  customerTier: "premium",
});

if (result.needsHuman.probability > 0.6) {
  await queue.push("human-review");
}

const team =
  result.intent.probability("billing") > 0.7
    ? "billing"
    : result.intent.mostLikely();
await routeTo(team);
```

Full walkthroughs are in [`examples/`](./examples).

## When to use it

- A decision depends on several weak signals at once — text, history, tier, counters.
- You want to preserve how strongly an inference supports each possible outcome.
- You want to compare a heuristic, a rules engine and a model against the same decision.
- You want that decision covered by ordinary unit tests, with no network call.

## When not to use it

- The rule is genuinely deterministic: parsing, validation, permissions.
- You need Decimo itself to train a model or manage its lifecycle.
- You need decisions persisted, audited or replayed. Decimo is stateless.
- You need to change the business rule without deploying. That is a feature flag service.

## Why not `if`/`else`, feature flags, or an ML model?

| Approach            | Best for                                               | Gap it leaves                                          |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `if` / `else`       | Explicit deterministic rules                           | No notion of uncertainty                               |
| Feature flags       | Shipping a known-good variant to a known audience      | Decides which variant, not what the case means         |
| In-process ML model | Tasks with training data and a measurable objective    | Needs labels and a retraining loop                     |
| A general LLM call  | Open-ended generation                                  | Unstructured output requires application-level parsing |
| **Decimo**          | Bounded, typed judgements about state you already have | One decision at a time; no training or storage         |

Decimo is a layer, not a replacement. It can sit alongside existing rules, feature flags, or ML systems.

```ts
if (
  flags.isEnabled("billing-v2") &&
  result.intent.probability("billing") > 0.7
) {
  routeToBillingQueue();
}
```

## Why isn't this just a typed LLM call?

- Questions are declared and typed. Results are validated distributions, not parsed prose.
- The provider can be something other than a model — see
  [`examples/custom-provider.ts`](./examples/custom-provider.ts).
- Provider-specific vocabulary and transport details don't leak into your application logic.
- Every answer is range-checked and distribution-checked before you see it.

## Providers

Decimo is provider-agnostic. A provider answers your questions; it can be a model, a rules engine, a
heuristic, or a mock.

The repository ships two:

- **`MockProvider`** — deterministic, offline, no credentials. Uniform answers, or scripted ones via
  a `responder` for tests.
- **`JevProvider`** — an HTTP provider for [Jev](https://docs.typesafe.ai/api), TypeSafe's decision
  model. Requires an API key.

Swapping providers leaves the decision definition and the result types untouched. It does not make
providers equivalent: a different provider will score differently, and may be slower or cost more.
[How providers work →](./docs/providers.md)

## Documentation

| Document                               | What it covers                                                   |
| -------------------------------------- | ---------------------------------------------------------------- |
| [API reference](./docs/api.md)         | Builders, ordering contract, results, configuration, errors      |
| [Providers](./docs/providers.md)       | The abstraction, `MockProvider`, `JevProvider`, custom providers |
| [Architecture](./docs/architecture.md) | Module responsibilities, the response boundary, layering         |
| [Development](./docs/development.md)   | Gates, CI, contributing, scope                                   |
| [Examples](./examples)                 | Runnable-shaped programs                                         |

## Project status

Current version: `v0.1.1` — the npm badge above tracks the published release. CI runs on every push
and pull request against `main`.

One external provider (`JevProvider`); everything else is `MockProvider` or a provider you write.
There is no caching, persistence or batching — each `evaluate()` is one provider call. See
[scope](./docs/development.md#scope) for what is deliberately not built yet.

## Contributing

Run the gates before opening a pull request — CI runs the same five:

```sh
npm run typecheck && npm test && npm run lint && npm run format:check && npm run build
```

## License

MIT — see [LICENSE](./LICENSE).
