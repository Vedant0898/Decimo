import { ConfigurationError } from "./errors";
import type { BooleanResult, CategoricalResult, OrdinalResult } from "./result";
import type {
  BooleanQuestion,
  CategoricalQuestion,
  CategoryValues,
  OrdinalQuestion,
  Question,
  ValueOf,
} from "../schema/types";
import { requireDescription, requireValues } from "../schema/types";
import type { NormalizedQuestion } from "../providers/provider";

/** A map of question names to the questions that make up a decision. */
export type DecisionSpec = Record<string, Question>;

/** The result kind produced by a given question kind. */
export type ResultFor<Q> = Q extends BooleanQuestion
  ? BooleanResult
  : Q extends CategoricalQuestion<infer T>
    ? CategoricalResult<ValueOf<T>>
    : Q extends OrdinalQuestion<infer T>
      ? OrdinalResult<ValueOf<T>>
      : never;

/** The evaluation result for a decision, keyed by question name. */
export type DecisionResult<D extends DecisionSpec> = {
  readonly [K in keyof D]: ResultFor<D[K]>;
};

/**
 * Validate a decision and return it with its types preserved, so that
 * `defineDecision` is the single place a decision definition is checked.
 */
export function defineDecision<D extends DecisionSpec>(decision: D): D {
  normalizeDecision(decision);
  return decision;
}

/**
 * Validate a decision and flatten it into the provider-neutral questions a
 * provider receives, keyed by question name.
 */
export function normalizeDecision(
  decision: unknown,
): Record<string, NormalizedQuestion> {
  if (
    typeof decision !== "object" ||
    decision === null ||
    Array.isArray(decision)
  ) {
    throw new ConfigurationError(
      "A decision must be an object mapping question names to questions.",
    );
  }

  const entries = Object.entries(decision as Record<string, unknown>);

  if (entries.length === 0) {
    throw new ConfigurationError(
      "A decision must declare at least one question.",
    );
  }

  const questions: Record<string, NormalizedQuestion> = {};

  for (const [id, question] of entries) {
    if (id.trim() === "") {
      throw new ConfigurationError("Question names cannot be empty.");
    }

    questions[id] = normalizeQuestion(id, question);
  }

  return questions;
}

function normalizeQuestion(id: string, question: unknown): NormalizedQuestion {
  if (typeof question !== "object" || question === null) {
    throw new ConfigurationError(
      `Question "${id}" must be an object created by boolean(), categorical() or ordinal().`,
    );
  }

  const candidate = question as {
    type?: unknown;
    description?: unknown;
    values?: unknown;
  };

  if (candidate.type === "boolean") {
    return {
      id,
      type: "boolean",
      description: requireDescription(candidate.description, "boolean"),
    };
  }

  if (candidate.type === "categorical" || candidate.type === "ordinal") {
    const type = candidate.type;
    const values: CategoryValues = requireValues(
      candidate.values,
      type,
      type === "ordinal" ? 2 : 1,
    );

    return {
      id,
      type,
      description: requireDescription(candidate.description, type),
      values,
    };
  }

  throw new ConfigurationError(
    `Question "${id}" has an unsupported type: ${JSON.stringify(candidate.type)}.`,
  );
}
