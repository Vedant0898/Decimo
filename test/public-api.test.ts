import { describe, expect, it } from "vitest";

import * as api from "../src/index";

/**
 * The public surface must stay provider-agnostic. A consumer picks a provider
 * and its config; everything behind that boundary belongs to the provider.
 */
const FORBIDDEN_EXPORTS = [
  "JevClient",
  "JevProviderOptions.client",
  "JEV_DEFAULT_BASE_URL",
  "JEV_DEFAULT_MODEL",
  "mapJevAnswers",
  "mapQuestionsToJev",
  "JevMappedRequest",
  "JevEvaluateInput",
  "JevClientOptions",
  "JevAnswer",
  "JevChoiceAnswer",
  "JevChoiceQuestion",
  "JevNoulAnswer",
  "JevNoulQuestion",
  "JevQuestion",
  "JevQuestionType",
  "JevScoreAnswer",
  "JevScoreQuestion",
  "JevUsage",
  "JevWireRequest",
  "JevWireResponse",
  "JevFetchLike",
  "JevHttpRequestInit",
  "JevHttpResponse",
];

const exported = Object.keys(api);

describe("public API", () => {
  it("does not export provider internals", () => {
    for (const name of FORBIDDEN_EXPORTS) {
      expect(exported).not.toContain(name);
    }
  });

  it("exposes Jev only as a configured provider", () => {
    const jev = exported.filter((name) => name.includes("Jev"));

    expect(jev.sort()).toEqual(["JevProvider"]);
  });

  it("exposes no wire-level concept from any provider", () => {
    for (const leak of ["noul", "choice", "score", "criteria", "legend"]) {
      expect(exported.some((name) => name.toLowerCase().includes(leak))).toBe(
        false,
      );
    }
  });

  it("keeps the decision surface", () => {
    expect(exported).toEqual(
      expect.arrayContaining([
        "VERSION",
        "boolean",
        "categorical",
        "ordinal",
        "defineDecision",
        "DecisionEngine",
        "MockProvider",
        "JevProvider",
        "DecimoError",
        "ProviderError",
        "ProviderTimeoutError",
        "InvalidProviderResponseError",
        "ConfigurationError",
        "isDecimoError",
      ]),
    );
  });

  it("lets the user choose a provider with only its config", () => {
    expect(typeof new api.JevProvider({ apiKey: "k" })).toBe("object");
    expect(typeof new api.MockProvider()).toBe("object");
    expect(typeof new api.DecisionEngine(new api.MockProvider())).toBe(
      "object",
    );
  });
});
