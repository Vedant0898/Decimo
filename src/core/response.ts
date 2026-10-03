import { InvalidProviderResponseError } from "./errors";
import { DISTRIBUTION_SUM_TOLERANCE } from "./result";
import type {
  AnswerPair,
  BooleanAnswer,
  CanonicalDecision,
  CanonicalLevel,
  CategoricalAnswer,
  OrdinalAnswer,
} from "../schema/canonical";
import { isJsonObject } from "../types/json";

/**
 * The provider-response boundary.
 *
 * Provider output is untrusted, so it is validated here, in one place, before
 * anything downstream sees it: shape, coverage, answer-kind agreement, and every
 * number. On success it yields question/answer pairs whose numbers are known
 * good, which is what lets result construction stay pure.
 *
 * Nothing below this line re-checks anything.
 */
export function validateProviderResponse(
  response: unknown,
  decision: CanonicalDecision,
  providerName: string,
): AnswerPair[] {
  const answers = readAnswers(response, providerName);

  // Checked before any value is inspected, so an unrequested answer cannot be
  // reported as a bad number.
  for (const id of Object.keys(answers)) {
    if (!Object.hasOwn(decision, id)) {
      throw new InvalidProviderResponseError(
        `Provider "${providerName}" answered the unrequested question "${id}".`,
        {
          details: {
            provider: providerName,
            questionId: id,
            received: answers,
          },
        },
      );
    }
  }

  const { boolean, categorical, ordinal } = partitionAnswers(
    answers,
    providerName,
  );

  const pairs: AnswerPair[] = [];

  for (const [id, question] of Object.entries(decision)) {
    // Answers are indexed by the kind the question expects, which is what lets
    // the pair below be built without an assertion.
    switch (question.type) {
      case "boolean": {
        const answer = boolean.get(id);

        if (answer === undefined) {
          throw missing(id, "boolean", answers, providerName);
        }

        pairs.push({ id, kind: "boolean", question, answer });
        break;
      }
      case "categorical": {
        const answer = categorical.get(id);

        if (answer === undefined) {
          throw missing(id, "categorical", answers, providerName);
        }

        checkDistribution(
          id,
          question.levels,
          answer.probabilities,
          providerName,
        );
        pairs.push({ id, kind: "categorical", question, answer });
        break;
      }
      case "ordinal": {
        const answer = ordinal.get(id);

        if (answer === undefined) {
          throw missing(id, "ordinal", answers, providerName);
        }

        checkDistribution(
          id,
          question.levels,
          answer.probabilities,
          providerName,
        );
        pairs.push({ id, kind: "ordinal", question, answer });
        break;
      }
    }
  }

  return pairs;
}

function readAnswers(
  response: unknown,
  providerName: string,
): Record<string, unknown> {
  if (!isJsonObject(response)) {
    throw new InvalidProviderResponseError(
      `Provider "${providerName}" did not return a response object.`,
      { details: { provider: providerName, received: response } },
    );
  }

  const answers: unknown = response["answers"];

  if (!isJsonObject(answers)) {
    throw new InvalidProviderResponseError(
      `Provider "${providerName}" did not return an answers map.`,
      { details: { provider: providerName, received: response } },
    );
  }

  const copied: Record<string, unknown> = {};

  for (const [id, answer] of Object.entries(answers)) {
    // An explicit `undefined` means the question went unanswered.
    if (answer !== undefined) {
      copied[id] = answer;
    }
  }

  return copied;
}

/**
 * Read and range-check every answer, grouped by kind.
 *
 * A genuine discriminated union is narrowed by `switch` for free, and each
 * answer is rebuilt from numbers that have already been checked, so the maps
 * below hold validated values rather than whatever the provider sent.
 */
function partitionAnswers(
  answers: Record<string, unknown>,
  providerName: string,
): {
  boolean: Map<string, BooleanAnswer>;
  categorical: Map<string, CategoricalAnswer>;
  ordinal: Map<string, OrdinalAnswer>;
} {
  const boolean = new Map<string, BooleanAnswer>();
  const categorical = new Map<string, CategoricalAnswer>();
  const ordinal = new Map<string, OrdinalAnswer>();

  for (const [id, raw] of Object.entries(answers)) {
    if (!isJsonObject(raw)) {
      throw invalid(
        id,
        "was answered with a non-object answer",
        raw,
        providerName,
      );
    }

    const kind: unknown = raw["type"];

    switch (kind) {
      case "boolean": {
        const probability = readProbability(
          raw["probability"],
          id,
          "probability",
          raw,
          providerName,
        );
        const confidence = readConfidence(id, raw, providerName);

        boolean.set(
          id,
          confidence === undefined
            ? { type: "boolean", probability }
            : { type: "boolean", probability, confidence },
        );
        break;
      }
      case "categorical": {
        const probabilities = readProbabilities(id, raw, providerName);
        const confidence = readConfidence(id, raw, providerName);

        categorical.set(
          id,
          confidence === undefined
            ? { type: "categorical", probabilities }
            : { type: "categorical", probabilities, confidence },
        );
        break;
      }
      case "ordinal": {
        const probabilities = readProbabilities(id, raw, providerName);
        const confidence = readConfidence(id, raw, providerName);

        ordinal.set(
          id,
          confidence === undefined
            ? { type: "ordinal", probabilities }
            : { type: "ordinal", probabilities, confidence },
        );
        break;
      }
      default:
        throw invalid(
          id,
          `has an unsupported answer type: ${JSON.stringify(kind)}`,
          raw,
          providerName,
        );
    }
  }

  return { boolean, categorical, ordinal };
}

function readProbabilities(
  id: string,
  answer: Record<string, unknown>,
  providerName: string,
): Record<string, number> {
  const raw: unknown = answer["probabilities"];

  if (!isJsonObject(raw)) {
    throw invalid(
      id,
      "must be answered with a probability distribution",
      answer,
      providerName,
    );
  }

  const probabilities: Record<string, number> = {};

  for (const [key, value] of Object.entries(raw)) {
    probabilities[key] = readProbability(
      value,
      id,
      `probability for "${key}"`,
      answer,
      providerName,
    );
  }

  return probabilities;
}

/** The question-dependent half of distribution validation. */
function checkDistribution(
  id: string,
  levels: readonly CanonicalLevel[],
  probabilities: Readonly<Record<string, number>>,
  providerName: string,
): void {
  const declared = new Set(levels.map((level) => level.key));
  let total = 0;

  for (const level of levels) {
    const probability = probabilities[level.key];

    if (probability === undefined) {
      throw invalid(
        id,
        `is missing a probability for value "${level.key}"`,
        probabilities,
        providerName,
      );
    }

    total += probability;
  }

  for (const key of Object.keys(probabilities)) {
    if (!declared.has(key)) {
      throw invalid(
        id,
        `was answered with the unknown value "${key}"`,
        probabilities,
        providerName,
      );
    }
  }

  if (Math.abs(total - 1) > DISTRIBUTION_SUM_TOLERANCE) {
    throw invalid(
      id,
      `probabilities must sum to 1, received ${total}`,
      probabilities,
      providerName,
    );
  }
}

function readProbability(
  value: unknown,
  id: string,
  label: string,
  received: unknown,
  providerName: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(id, `has a non-numeric ${label}`, received, providerName);
  }

  if (value < 0 || value > 1) {
    throw invalid(
      id,
      `has a ${label} outside [0, 1]: ${value}`,
      received,
      providerName,
    );
  }

  return value;
}

function readConfidence(
  id: string,
  answer: Readonly<Record<string, unknown>>,
  providerName: string,
): number | undefined {
  const value: unknown = answer["confidence"];

  return value === undefined
    ? undefined
    : readProbability(value, id, "confidence", answer, providerName);
}

function missing(
  id: string,
  expected: string,
  answers: Record<string, unknown>,
  providerName: string,
): InvalidProviderResponseError {
  const received: unknown = answers[id];

  if (received === undefined) {
    return new InvalidProviderResponseError(
      `Provider "${providerName}" did not answer question "${id}".`,
      {
        details: { provider: providerName, questionId: id, received: answers },
      },
    );
  }

  return new InvalidProviderResponseError(
    `Question "${id}" is a ${expected} question but was answered as ${describeKind(
      received,
    )}.`,
    { details: { provider: providerName, questionId: id, received } },
  );
}

function describeKind(answer: unknown): string {
  if (!isJsonObject(answer)) {
    return "a non-object";
  }

  const kind: unknown = answer["type"];

  return typeof kind === "string" ? kind : "an unknown kind";
}

function invalid(
  id: string,
  problem: string,
  received: unknown,
  providerName: string,
): InvalidProviderResponseError {
  return new InvalidProviderResponseError(`Question "${id}" ${problem}.`, {
    details: { provider: providerName, questionId: id, received },
  });
}
