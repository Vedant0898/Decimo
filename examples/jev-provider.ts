/**
 * The same decision, evaluated by Jev instead of the mock.
 *
 * The only thing that changed from `support-triage.ts` is the provider. The
 * decision, the state and the result types are identical, and nothing about
 * Jev's request or response format appears here.
 *
 * Requires `TYPESAFE_API_KEY` in the environment.
 */

import { DecisionEngine, JevProvider } from "../src/index";
import { supportDecision, supportState } from "./support-decision";

// A provider is chosen by name plus its own configuration. Nothing else about
// it is visible from here. The engine's timeout covers the request: it aborts
// the in-flight call and raises a ProviderTimeoutError.
const engine = new DecisionEngine(
  new JevProvider({
    apiKey: process.env["TYPESAFE_API_KEY"],
    model: "jev-latest",
  }),
  { timeoutMs: 15_000 },
);

const result = await engine.evaluate(supportDecision, supportState);

console.log("most likely intent:", result.intent.mostLikely());
console.log("probability of billing:", result.intent.probability("billing"));

// Confidence is a separate concept from probability, and is only present when
// the provider reports one.
console.log("intent confidence:", result.intent.confidence ?? "not reported");
console.log("needs a human:", result.needsHuman.probability);
console.log("most likely urgency:", result.urgency.mostLikely());
