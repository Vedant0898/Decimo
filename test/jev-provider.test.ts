import { describe, expect, it } from "vitest";

import {
  boolean,
  categorical,
  ConfigurationError,
  DecisionEngine,
  defineDecision,
  JevProvider,
  ordinal,
  ProviderError,
  type HttpFetch,
  type HttpRequestInit,
  type HttpResponse,
} from "../src/index";

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
    values: [
      { key: "low", description: "Can be handled normally" },
      { key: "medium", description: "Should be addressed soon" },
      { key: "high", description: "Requires prompt attention" },
    ],
  }),
});

const wireResponse = {
  model: "jev-1.13.0",
  answers: {
    intent: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.88, technical: 0.12, sales: 0 },
      confidence: 0.81,
    },
    needsHuman: { type: "noul", noul: 0.05 },
    urgency: {
      type: "score",
      score: 1.05,
      legend: {
        "0": "Can be handled normally",
        "1": "Should be addressed soon",
        "2": "Requires prompt attention",
      },
      probabilities: { "0": 0.1, "1": 0.3, "2": 0.6 },
      confidence: 0.7,
    },
  },
  usage: { input_tokens: 318, output_tokens: 34 },
};

function recordingFetch(
  body: unknown,
  status = 200,
): { fetch: HttpFetch; bodies: HttpRequestInit[] } {
  const bodies: HttpRequestInit[] = [];

  const fetch: HttpFetch = (_url, init) => {
    bodies.push(init);
    return Promise.resolve({
      ok: status === 200,
      status,
      statusText: status === 200 ? "OK" : "Error",
      text: () => Promise.resolve(JSON.stringify(body)),
    } satisfies HttpResponse);
  };

  return { fetch, bodies };
}

describe("JevProvider", () => {
  it("requires an API key from options or the environment", () => {
    const previous = process.env["TYPESAFE_API_KEY"];
    delete process.env["TYPESAFE_API_KEY"];

    try {
      expect(() => new JevProvider()).toThrow(ConfigurationError);
      expect(() => new JevProvider({})).toThrow(/TYPESAFE_API_KEY/);
    } finally {
      if (previous !== undefined) {
        process.env["TYPESAFE_API_KEY"] = previous;
      }
    }
  });

  it("reads the API key from the environment", async () => {
    const previous = process.env["TYPESAFE_API_KEY"];
    process.env["TYPESAFE_API_KEY"] = "env-key";

    try {
      const { fetch, bodies } = recordingFetch(wireResponse);
      const engine = new DecisionEngine(new JevProvider({ fetch }));

      await engine.evaluate(decision, { message: "My card was charged twice" });

      expect(bodies[0]?.headers.authorization).toBe("Bearer env-key");
    } finally {
      if (previous === undefined) {
        delete process.env["TYPESAFE_API_KEY"];
      } else {
        process.env["TYPESAFE_API_KEY"] = previous;
      }
    }
  });

  it("reads the API key from a custom environment variable", async () => {
    const previous = process.env["CUSTOM_JEV_KEY"];
    process.env["CUSTOM_JEV_KEY"] = "custom-key";

    try {
      const { fetch, bodies } = recordingFetch(wireResponse);
      const provider = new JevProvider({
        apiKeyEnvVar: "CUSTOM_JEV_KEY",
        fetch,
      });

      await new DecisionEngine(provider).evaluate(decision, { message: "hi" });

      expect(bodies[0]?.headers.authorization).toBe("Bearer custom-key");
    } finally {
      if (previous === undefined) {
        delete process.env["CUSTOM_JEV_KEY"];
      } else {
        process.env["CUSTOM_JEV_KEY"] = previous;
      }
    }
  });

  it("maps the decision onto the Jev wire format", async () => {
    const { fetch, bodies } = recordingFetch(wireResponse);
    const provider = new JevProvider({ apiKey: "k", fetch });

    await new DecisionEngine(provider).evaluate(decision, {
      message: "My card was charged twice",
    });

    expect(JSON.parse(bodies[0]?.body ?? "{}")).toEqual({
      model: "jev-latest",
      state: { message: "My card was charged twice" },
      questions: {
        intent: {
          type: "choice",
          instructions: "Which department does this query belong to?",
          criteria: {
            billing: "Payments and invoices",
            technical: "Technical problems",
            sales: "Pricing and purchasing",
          },
        },
        needsHuman: {
          type: "noul",
          instructions: "Does this require human intervention?",
        },
        urgency: {
          type: "score",
          instructions: "How urgent is this request?",
          criteria: [
            "Can be handled normally",
            "Should be addressed soon",
            "Requires prompt attention",
          ],
        },
      },
    });
  });

  it("returns provider-neutral results", async () => {
    const { fetch } = recordingFetch(wireResponse);
    const provider = new JevProvider({ apiKey: "k", fetch });

    const result = await new DecisionEngine(provider).evaluate(decision, {
      message: "My card was charged twice",
    });

    expect(result.intent.mostLikely()).toBe("billing");
    expect(result.intent.probability("billing")).toBeCloseTo(0.88);
    expect(result.intent.confidence).toBe(0.81);
    expect(result.needsHuman.probability).toBe(0.05);
    expect(result.urgency.mostLikely()).toBe("high");
    expect(result.urgency.probability("high")).toBeCloseTo(0.6);
    expect(Object.keys(result.urgency.distribution())).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });

  it("surfaces an HTTP failure as a Decimo error", async () => {
    const { fetch } = recordingFetch({ message: "rate limited" }, 429);
    const provider = new JevProvider({ apiKey: "k", fetch });

    await expect(
      new DecisionEngine(provider).evaluate(decision, { message: "hi" }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("reports its name", () => {
    expect(new JevProvider({ apiKey: "k" }).name).toBe("jev");
  });
});
