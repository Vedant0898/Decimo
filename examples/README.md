# Examples

Each file is a self-contained demonstration, type-checked by `npm run typecheck`.

| File                  | Shows                                                                     |
| --------------------- | ------------------------------------------------------------------------- |
| `support-decision.ts` | The decision and state shared by the examples below                       |
| `support-triage.ts`   | The whole loop with `MockProvider` — no network, no API key               |
| `jev-provider.ts`     | The same decision driven by `JevProvider`; only the provider line differs |
| `custom-provider.ts`  | Implementing `DecisionProvider` yourself                                  |
| `error-handling.ts`   | Timeouts, malformed responses and configuration errors                    |

> Installed as a package, every import below reads `from "decimo"`. They import
> `from "../src/index"` here so that `npm run typecheck` works without a build
> step and the examples always match the current source.

## The shape of it

```ts
// 1. Define what you want to know.
const decision = defineDecision({
  intent: categorical({
    description: "…",
    values: { billing: "…", sales: "…" },
  }),
  needsHuman: boolean({ description: "…" }),
  urgency: ordinal({ description: "…", values: { low: "…", high: "…" } }),
});

// 2. Choose a provider and its config.
const engine = new DecisionEngine(
  new JevProvider({ apiKey: process.env.TYPESAFE_API_KEY }),
);

// 3. Provide application state, read typed results.
const result = await engine.evaluate(decision, {
  message: "My card was charged twice",
});

result.intent.mostLikely(); // inferred as "billing" | "sales"
result.intent.probability("billing"); // number
result.intent.probability("unknown"); // ✗ compile error
```

Step 1 and step 3 never change when you swap providers. That is the whole
point: the decision is Decimo's, the inference is the provider's, and the
boundary between them is the only place provider vocabulary appears.

## Expected output

`support-triage.ts` and `custom-provider.ts` print the same shape:

```text
distribution:      { billing: 0.333…, technical: 0.333…, sales: 0.333… }
most likely intent: billing
probability of billing: 0.333…
needs a human: 0.5
```

`custom-provider.ts` reports a real distribution rather than a uniform one,
because the heuristic actually scores the keywords in the message.

`error-handling.ts` prints one line per failure path:

```text
timeout: timed out after 50ms
malformed response: Question "verdict" probabilities must sum to 1, received 2.7.
  question: verdict
non-JSON state: misconfigured — "state.body" is undefined; state must be valid JSON.
no provider: misconfigured — DecisionEngine requires a DecisionProvider with an evaluate() method.
```

`jev-provider.ts` is the only one that needs a credential: set `TYPESAFE_API_KEY`.
