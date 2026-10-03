import { InvalidProviderResponseError } from "../../core/errors";
import type {
  CanonicalAnswer,
  CanonicalQuestion,
  CategoricalAnswer,
  OrdinalAnswer,
} from "../../schema/canonical";
import type { JevAnswer, JevQuestion } from "./types";

const PROVIDER = "jev";

export interface JevMappedRequest {
  readonly questions: Record<string, JevQuestion>;
  /**
   * Ordinal question id to its level keys, positionally aligned with the score
   * criteria array that Jev answers with index keys.
   */
  readonly levels: Readonly<Record<string, readonly string[]>>;
}

/**
 * Translate canonical questions into Jev's wire format.
 *
 * This is the only place Decimo's semantics meet Jev's vocabulary, and the only
 * place `noul`, `choice` and `score` appear.
 */
export function mapQuestionsToJev(
  questions: Readonly<Record<string, CanonicalQuestion>>,
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
          criteria: Object.fromEntries(
            question.levels.map((level) => [level.key, level.description]),
          ),
        };
        break;
      case "ordinal": {
        // The canonical level order is the scale, so it is the criteria order.
        const keys = question.levels.map((level) => level.key);

        mapped[id] = {
          type: "score",
          instructions: question.description,
          criteria: question.levels.map((level) => level.description),
        };
        levels[id] = keys;
        break;
      }
    }
  }

  return { questions: mapped, levels };
}

/**
 * Translate Jev's answers back into canonical answers.
 *
 * Jev keys a score's probabilities by level index, so they are remapped onto the
 * keys this request declared. Numbers are moved as they are: range and
 * distribution validation belong to Decimo's response boundary, not to a
 * provider.
 */
export function mapJevAnswers(
  mapped: JevMappedRequest,
  answers: Readonly<Record<string, JevAnswer>>,
): Record<string, CanonicalAnswer> {
  const result: Record<string, CanonicalAnswer> = {};

  for (const [id, question] of Object.entries(mapped.questions)) {
    const answer = answers[id];

    if (answer === undefined) {
      throw new InvalidProviderResponseError(
        `Jev did not answer question "${id}".`,
        { details: { provider: PROVIDER, questionId: id, received: answers } },
      );
    }

    if (answer.type !== question.type) {
      throw new InvalidProviderResponseError(
        `Question "${id}" is a ${decimoTypeOf(question.type)} question but Jev answered it as ${String(answer.type)}.`,
        { details: { provider: PROVIDER, questionId: id, received: answer } },
      );
    }

    switch (answer.type) {
      // A noul carries a probability and nothing else.
      case "noul":
        result[id] = { type: "boolean", probability: answer.noul };
        break;
      case "choice":
        result[id] = categoricalAnswer(answer.probabilities, answer.confidence);
        break;
      case "score":
        result[id] = ordinalAnswer(
          remapLevelIndexes(id, answer, mapped.levels[id] ?? []),
          answer.confidence,
        );
        break;
    }
  }

  return result;
}

/**
 * Jev reports a score per level *index*; Decimo identifies levels by key.
 */
function remapLevelIndexes(
  id: string,
  answer: { readonly probabilities: Readonly<Record<string, number>> },
  levels: readonly string[],
): Record<string, number> {
  const declared = new Set(levels.map((_key, index) => String(index)));
  const remapped: Record<string, number> = {};

  for (const index of Object.keys(answer.probabilities)) {
    if (!declared.has(index)) {
      throw new InvalidProviderResponseError(
        `Question "${id}" was answered with the unknown score level "${index}".`,
        {
          details: {
            provider: PROVIDER,
            questionId: id,
            received: answer.probabilities,
          },
        },
      );
    }
  }

  levels.forEach((key, index) => {
    const probability = answer.probabilities[String(index)];

    if (probability === undefined) {
      throw new InvalidProviderResponseError(
        `Question "${id}" is missing a probability for score level "${index}".`,
        {
          details: {
            provider: PROVIDER,
            questionId: id,
            received: answer.probabilities,
          },
        },
      );
    }

    remapped[key] = probability;
  });

  return remapped;
}

function categoricalAnswer(
  probabilities: Readonly<Record<string, number>>,
  confidence: number | undefined,
): CategoricalAnswer {
  return confidence === undefined
    ? { type: "categorical", probabilities }
    : { type: "categorical", probabilities, confidence };
}

function ordinalAnswer(
  probabilities: Readonly<Record<string, number>>,
  confidence: number | undefined,
): OrdinalAnswer {
  return confidence === undefined
    ? { type: "ordinal", probabilities }
    : { type: "ordinal", probabilities, confidence };
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
