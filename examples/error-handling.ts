/**
 * Error handling.
 *
 * Every failure Decimo can produce is a `DecimoError`, so one `catch` covers
 * provider faults, malformed responses and bad configuration. This example
 * drives the three interesting paths with stub providers.
 */

import {
  categorical,
  ConfigurationError,
  DecisionEngine,
  defineDecision,
  isDecimoError,
  type DecisionProvider,
  InvalidProviderResponseError,
  ProviderTimeoutError,
} from "../src/index";

const moderationDecision = defineDecision({
  verdict: categorical({
    description: "Should this content be published?",
    values: {
      allow: "Publish as is",
      review: "Send to a moderator",
      block: "Reject outright",
    },
  }),
});

const state = { body: "Visit my store for a discount" };

/** Never answers, so the engine's timeout fires. */
const silentProvider: DecisionProvider = {
  name: "silent",
  evaluate: () => new Promise(() => {}),
};

/** Answers with a distribution that does not sum to 1. */
const brokenProvider: DecisionProvider = {
  name: "broken",
  evaluate: () =>
    Promise.resolve({
      answers: {
        verdict: {
          type: "categorical",
          probabilities: { allow: 0.9, review: 0.9, block: 0.9 },
        },
      },
    }),
};

async function describe(label: string, run: () => Promise<unknown>) {
  try {
    await run();
    console.log(`${label}: no error`);
  } catch (error) {
    if (error instanceof ProviderTimeoutError) {
      console.log(`${label}: timed out after ${error.timeoutMs}ms`);
      return;
    }

    if (error instanceof InvalidProviderResponseError) {
      // The offending question and payload are attached for debugging.
      console.log(`${label}: ${error.message}`);
      console.log(`  question: ${error.details.questionId}`);
      return;
    }

    if (error instanceof ConfigurationError) {
      console.log(`${label}: misconfigured — ${error.message}`);
      return;
    }

    if (isDecimoError(error)) {
      console.log(`${label}: ${error.name} — ${error.message}`);
      return;
    }

    throw error;
  }
}

await describe("timeout", () =>
  new DecisionEngine(silentProvider, { timeoutMs: 50 }).evaluate(
    moderationDecision,
    state,
  ));

await describe("malformed response", () =>
  new DecisionEngine(brokenProvider, { timeoutMs: 0 }).evaluate(
    moderationDecision,
    state,
  ));

await describe("non-JSON state", () =>
  new DecisionEngine(brokenProvider).evaluate(moderationDecision, {
    body: undefined,
  } as unknown as Record<string, never>));

await describe("no provider", async () => {
  throw new ConfigurationError(
    "DecisionEngine requires a DecisionProvider with an evaluate() method.",
  );
});
