/**
 * Writing your own provider.
 *
 * A provider only has to implement `evaluate`. It receives the state plus
 * normalized questions and returns provider-neutral answers — no wire format, no
 * HTTP, nothing Decimo-specific to reverse-engineer. This one is a keyword
 * heuristic, which is enough to route a fast first pass before a real model is
 * consulted.
 */

import {
  boolean,
  categorical,
  DecisionEngine,
  defineDecision,
  ordinal,
  type DecisionProvider,
  type ProviderRequest,
  type ProviderResponse,
} from "../src/index";

const intent = categorical({
  description: "Which department does this query belong to?",
  values: {
    billing: "Payments and invoices",
    technical: "Technical problems",
    sales: "Pricing and purchasing",
  },
});

const triageDecision = defineDecision({
  intent,
  needsHuman: boolean({
    description: "Does this query require human intervention?",
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

const KEYWORDS: Record<string, readonly string[]> = {
  billing: ["charged", "invoice", "refund", "payment", "card"],
  technical: ["error", "crash", "bug", "timeout", "broken"],
  sales: ["pricing", "upgrade", "quote", "purchase", "discount"],
};

class KeywordProvider implements DecisionProvider {
  readonly name = "keyword";

  async evaluate(request: ProviderRequest): Promise<ProviderResponse> {
    const answers: ProviderResponse["answers"] = {};

    for (const [id, question] of Object.entries(request.questions)) {
      const text = extractText(request.state).toLowerCase();

      switch (question.type) {
        case "boolean":
          answers[id] = {
            type: "boolean",
            probability: text.includes("nobody") ? 0.9 : 0.1,
          };
          break;
        case "categorical": {
          const values = Object.keys(question.values);
          const scores = values.map((value) => ({
            value,
            score: (KEYWORDS[value] ?? []).filter((keyword) =>
              text.includes(keyword),
            ).length,
          }));
          const total = scores.reduce((sum, entry) => sum + entry.score, 0);
          const probabilities: Record<string, number> = {};

          if (total === 0) {
            for (const value of values) {
              probabilities[value] = 1 / values.length;
            }
          } else {
            for (const entry of scores) {
              probabilities[entry.value] = entry.score / total;
            }
          }

          answers[id] = { type: "categorical", probabilities };
          break;
        }
        case "ordinal": {
          const values = Object.keys(question.values);
          const probabilities: Record<string, number> = {};

          for (const value of values) {
            probabilities[value] = 1 / values.length;
          }

          answers[id] = { type: "ordinal", probabilities };
          break;
        }
      }
    }

    return { answers };
  }
}

function extractText(state: unknown): string {
  if (typeof state === "string") {
    return state;
  }

  if (typeof state === "object" && state !== null) {
    return Object.values(state)
      .filter((value): value is string => typeof value === "string")
      .join(" ");
  }

  return "";
}

const engine = new DecisionEngine(new KeywordProvider());

const result = await engine.evaluate(triageDecision, {
  message: "I was charged twice for my subscription and the invoice is wrong.",
  lastReply: "nobody has replied",
});

// The result is the same typed result the Jev provider produces.
console.log("most likely intent:", result.intent.mostLikely());
console.log("distribution:", result.intent.distribution());
console.log("needs a human:", result.needsHuman.probability);
