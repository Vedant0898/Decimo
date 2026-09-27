/**
 * Support triage — the whole loop, with no network and no API key.
 *
 * Installed as a package, the imports below read `from "decimo"`.
 */

import { DecisionEngine, MockProvider } from "../src/index";
import { supportDecision, supportState } from "./support-decision";

// Choose a provider. `MockProvider` returns deterministic uniform
// probabilities, which is all you need for tests and local development.
const engine = new DecisionEngine(new MockProvider());

// Evaluate the decision against application state.
const result = await engine.evaluate(supportDecision, supportState);

console.log("distribution:", result.intent.distribution());
console.log("most likely intent:", result.intent.mostLikely());
console.log("probability of billing:", result.intent.probability("billing"));
console.log("needs a human:", result.needsHuman.probability);
console.log("urgency:", result.urgency.distribution());

// `probability` only accepts declared values, so a typo is a compile error:
//   result.intent.probability("unknown");  ✗

// Probabilities are not decisions. Branch on a threshold you control.
if (result.needsHuman.probability > 0.5) {
  console.log("routing to a human agent");
}
