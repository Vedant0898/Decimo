import { describe, expect, it } from "vitest";

import {
  InvalidProviderResponseError,
  type CanonicalQuestion,
} from "../src/index";
import { mapJevAnswers, mapQuestionsToJev } from "../src/providers/jev/mapper";

const questions: Record<string, CanonicalQuestion> = {
  needsHuman: {
    id: "needsHuman",
    type: "boolean",
    description: "Does this require human intervention?",
  },
  intent: {
    id: "intent",
    type: "categorical",
    description: "Which department does this query belong to?",
    levels: [
      { key: "billing", description: "Payments and invoices" },
      { key: "technical", description: "Technical problems" },
      { key: "sales", description: "Pricing and purchasing" },
    ],
  },
  urgency: {
    id: "urgency",
    type: "ordinal",
    description: "How urgent is this request?",
    levels: [
      { key: "low", description: "Can be handled normally" },
      { key: "medium", description: "Should be addressed soon" },
      { key: "high", description: "Requires prompt attention" },
    ],
  },
};

const mapOne = (id: keyof typeof questions) =>
  mapQuestionsToJev({ [id]: questions[id]! });

describe("mapQuestionsToJev()", () => {
  it("maps a boolean question to a noul", () => {
    expect(mapOne("needsHuman").questions.needsHuman).toEqual({
      type: "noul",
      instructions: "Does this require human intervention?",
    });
  });

  it("maps a categorical question to a choice with its level keys", () => {
    const mapped = mapOne("intent");

    expect(mapped.questions.intent).toEqual({
      type: "choice",
      instructions: "Which department does this query belong to?",
      criteria: {
        billing: "Payments and invoices",
        technical: "Technical problems",
        sales: "Pricing and purchasing",
      },
    });
    expect(mapped.levels.intent).toBeUndefined();
  });

  it("maps an ordinal question to an ordered score and records the level keys", () => {
    const mapped = mapOne("urgency");

    expect(mapped.questions.urgency).toEqual({
      type: "score",
      instructions: "How urgent is this request?",
      criteria: [
        "Can be handled normally",
        "Should be addressed soon",
        "Requires prompt attention",
      ],
    });
    expect(mapped.levels.urgency).toEqual(["low", "medium", "high"]);
  });

  it("sends a descending numeric-keyed scale in its declared order", () => {
    const mapped = mapQuestionsToJev({
      rating: {
        id: "rating",
        type: "ordinal",
        description: "How good?",
        levels: [
          { key: "5", description: "Terrible" },
          { key: "3", description: "Okay" },
          { key: "1", description: "Great" },
        ],
      },
    });

    // The rubric must not be reversed by JavaScript's key ordering rules.
    expect(mapped.questions.rating).toMatchObject({
      type: "score",
      criteria: ["Terrible", "Okay", "Great"],
    });
    expect(mapped.levels.rating).toEqual(["5", "3", "1"]);
  });
});

describe("mapJevAnswers()", () => {
  it("maps a noul answer to a boolean answer", () => {
    const answers = mapJevAnswers(mapOne("needsHuman"), {
      needsHuman: { type: "noul", noul: 0.95 },
    });

    expect(answers.needsHuman).toEqual({ type: "boolean", probability: 0.95 });
  });

  it("maps a choice answer to a categorical answer with confidence", () => {
    const answers = mapJevAnswers(mapOne("intent"), {
      intent: {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.88, technical: 0.12, sales: 0 },
        confidence: 0.81,
      },
    });

    expect(answers.intent).toEqual({
      type: "categorical",
      probabilities: { billing: 0.88, technical: 0.12, sales: 0 },
      confidence: 0.81,
    });
  });

  it("remaps score level indexes back onto the declared keys", () => {
    const answers = mapJevAnswers(mapOne("urgency"), {
      urgency: {
        type: "score",
        score: 1.05,
        legend: {
          "0": "Can be handled normally",
          "1": "Should be addressed soon",
          "2": "Requires prompt attention",
        },
        probabilities: { "0": 0, "1": 0.95, "2": 0.05 },
        confidence: 0.92,
      },
    });

    expect(answers.urgency).toEqual({
      type: "ordinal",
      probabilities: { low: 0, medium: 0.95, high: 0.05 },
      confidence: 0.92,
    });
  });

  it("omits confidence when Jev does not send it", () => {
    const answers = mapJevAnswers(mapOne("intent"), {
      intent: {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 1 },
        confidence: undefined as unknown as number,
      },
    });

    expect("confidence" in (answers.intent ?? {})).toBe(false);
  });

  it("passes numbers through without judging them", () => {
    // Range and sum validation belong to the response boundary, not the mapper.
    const answers = mapJevAnswers(mapOne("intent"), {
      intent: {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 7, technical: -1, sales: 0 },
        confidence: 0.5,
      },
    });

    expect(answers.intent).toMatchObject({
      probabilities: { billing: 7, technical: -1, sales: 0 },
    });
  });

  it("rejects a missing answer", () => {
    expect(() => mapJevAnswers(mapOne("intent"), {})).toThrow(
      InvalidProviderResponseError,
    );
  });

  it("rejects a mismatched answer kind", () => {
    expect(() =>
      mapJevAnswers(mapOne("intent"), {
        intent: { type: "noul", noul: 0.5 } as never,
      }),
    ).toThrow(/is a categorical question but Jev answered it as noul/);
  });

  it("rejects a score answer that is missing a level", () => {
    expect(() =>
      mapJevAnswers(mapOne("urgency"), {
        urgency: {
          type: "score",
          score: 0,
          probabilities: { "0": 0.5, "1": 0.5 },
          confidence: 0.5,
        },
      }),
    ).toThrow(/score level "2"/);
  });

  it("rejects a score answer with an unknown level index", () => {
    expect(() =>
      mapJevAnswers(mapOne("urgency"), {
        urgency: {
          type: "score",
          score: 0,
          probabilities: { "0": 0.2, "1": 0.3, "2": 0.3, "3": 0.2 },
          confidence: 0.5,
        },
      }),
    ).toThrow(/unknown score level "3"/);
  });
});
