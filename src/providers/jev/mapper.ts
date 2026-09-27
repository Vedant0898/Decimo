import { InvalidProviderResponseError } from "../../core/errors";
import { isJsonObject } from "../../types/json";
import type {
  NormalizedQuestion,
  ProviderAnswer,
  ProviderResponse,
} from "../provider";
import type {
  JevAnswer,
  JevChoiceAnswer,
  JevNoulAnswer,
  JevQuestion,
  JevScoreAnswer,
} from "./types";

const PROVIDER = "jev";

export interface JevMappedRequest {
  readonly questions: Record<string, JevQuestion>;
  readonly levels: Readonly<Record<string, readonly string[]>>;
}

export function mapQuestionsToJev(
  questions: Readonly<Record<string, NormalizedQuestion>>,
): JevMappedRequest {
  const mapped: Record<string, JevQuestion> = {};
  const levels: Record<string, readonly string[]> = {};

  for (const [id, question] of Object.entries(questions)) {
    switch (question.type) {
      case "boolean":
        mapped[id] = { type: "noul", instructions: question.description };
        break;
      case "categorical":
        mapped[id] = {
          type: "choice",
          instructions: question.description,
          criteria: { ...question.values },
        };
        break;
      case "ordinal": {
        const keys = Object.keys(question.values);
        mapped[id] = {
          type: "score",
          instructions: question.description,
          criteria: keys.map((key) => question.values[key] ?? ""),
        };
        levels[id] = keys;
        break;
      }
    }
  }

  return { questions: mapped, levels };
}

export function mapJevAnswers(
  mapped: JevMappedRequest,
  answers: Readonly<Record<string, JevAnswer>>,
): ProviderResponse {
  if (!isJsonObject(answers as unknown)) {
    throw new InvalidProviderResponseError(
      "Jev did not return an answers map.",
      { details: { provider: PROVIDER, received: answers } },
    );
  }

  const result: Record<string, ProviderAnswer> = {};

  for (const [id, question] of Object.entries(mapped.questions)) {
    const answer = (answers as Record<string, JevAnswer>)[id];

    if (answer === undefined) {
      throw new InvalidProviderResponseError(
        `Jev did not answer question "${id}".`,
        { details: { provider: PROVIDER, questionId: id, received: answers } },
      );
    }

    if (!isJsonObject(answer as unknown)) {
      throw new InvalidProviderResponseError(
        `Question "${id}" was answered with a non-object answer.`,
        { details: { provider: PROVIDER, questionId: id, received: answer } },
      );
    }

    const expected = question.type;
    const actual = (answer as { type?: unknown }).type;

    if (actual !== expected) {
      throw new InvalidProviderResponseError(
        `Question "${id}" is a ${decimoTypeOf(expected)} question but Jev answered it as ${String(actual)}.`,
        { details: { provider: PROVIDER, questionId: id, received: answer } },
      );
    }

    result[id] =
      expected === "noul"
        ? mapNoul(id, answer as JevNoulAnswer)
        : expected === "choice"
          ? mapChoice(id, answer as JevChoiceAnswer)
          : mapScore(id, answer as JevScoreAnswer, mapped.levels[id] ?? []);
  }

  return { answers: result };
}

function mapNoul(id: string, answer: JevNoulAnswer): ProviderAnswer {
  const noul = (answer as { noul?: unknown }).noul;

  if (typeof noul !== "number" || !Number.isFinite(noul)) {
    throw new InvalidProviderResponseError(
      `Question "${id}" was answered without a numeric noul value.`,
      { details: { provider: PROVIDER, questionId: id, received: answer } },
    );
  }

  return { type: "boolean", probability: noul };
}

function mapChoice(id: string, answer: JevChoiceAnswer): ProviderAnswer {
  const probabilities = (answer as { probabilities?: unknown }).probabilities;

  if (!isJsonObject(probabilities as unknown)) {
    throw new InvalidProviderResponseError(
      `Question "${id}" was answered without a probability distribution.`,
      { details: { provider: PROVIDER, questionId: id, received: answer } },
    );
  }

  return {
    type: "categorical",
    probabilities: probabilities as Record<string, number>,
    ...optional("confidence", answer),
  };
}

function mapScore(
  id: string,
  answer: JevScoreAnswer,
  levels: readonly string[],
): ProviderAnswer {
  const probabilities = (answer as { probabilities?: unknown }).probabilities;

  if (!isJsonObject(probabilities as unknown)) {
    throw new InvalidProviderResponseError(
      `Question "${id}" was answered without a probability distribution.`,
      { details: { provider: PROVIDER, questionId: id, received: answer } },
    );
  }

  const received = probabilities as Record<string, unknown>;
  const remapped: Record<string, number> = {};
  const declared = new Set(levels.map((_level, index) => String(index)));

  for (const key of Object.keys(received)) {
    if (!declared.has(key)) {
      throw new InvalidProviderResponseError(
        `Question "${id}" was answered with the unknown score level "${key}".`,
        {
          details: {
            provider: PROVIDER,
            questionId: id,
            received: probabilities,
          },
        },
      );
    }
  }

  levels.forEach((level, index) => {
    const probability = received[String(index)];

    if (probability === undefined) {
      throw new InvalidProviderResponseError(
        `Question "${id}" is missing a probability for score level "${index}".`,
        {
          details: {
            provider: PROVIDER,
            questionId: id,
            received: probabilities,
          },
        },
      );
    }

    remapped[level] = probability as number;
  });

  return {
    type: "ordinal",
    probabilities: remapped,
    ...optional("confidence", answer),
  };
}

function optional(
  field: "confidence",
  answer: unknown,
): { confidence?: number } {
  const value = isJsonObject(answer as unknown)
    ? (answer as Record<string, unknown>)[field]
    : undefined;

  return value === undefined ? {} : { confidence: value as number };
}

function decimoTypeOf(jevType: JevQuestion["type"]): string {
  switch (jevType) {
    case "noul":
      return "boolean";
    case "choice":
      return "categorical";
    case "score":
      return "ordinal";
  }
}
