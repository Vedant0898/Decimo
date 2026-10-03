import { ConfigurationError } from "./errors";
import type { BooleanResult, CategoricalResult, OrdinalResult } from "./result";
import type {
  CanonicalCategoricalQuestion,
  CanonicalDecision,
  CanonicalLevel,
  CanonicalOrdinalQuestion,
  CanonicalQuestion,
} from "../schema/canonical";
import type {
  BooleanQuestion,
  CategoricalQuestion,
  OrdinalQuestion,
  Question,
  ValueOf,
} from "../schema/types";
import { requireCategoryValues, requireDescription } from "../schema/types";

/** A map of question names to the questions that make up a decision. */
export type DecisionSpec = Record<string, Question>;

/** The result kind produced by a given question kind. */
export type ResultFor<Q> = Q extends BooleanQuestion
  ? BooleanResult
  : Q extends CategoricalQuestion<infer T>
    ? CategoricalResult<ValueOf<T>>
    : Q extends OrdinalQuestion<infer T>
      ? OrdinalResult<T>
      : never;

/** The evaluation result for a decision, keyed by question name. */
export type DecisionResult<D extends DecisionSpec> = {
  readonly [K in keyof D]: ResultFor<D[K]>;
};

/**
 * Anchor a decision's types without touching it at runtime.
 *
 * Validation happens once, where untrusted input enters the system: in
 * `DecisionEngine.evaluate()`. Builder arguments are already checked eagerly
 * by `boolean()`, `categorical()` and `ordinal()`.
 */
export function defineDecision<D extends DecisionSpec>(decision: D): D {
  return decision;
}

/**
 * The single entry point the engine uses: validate, then canonicalize.
 *
 * This is the only place a decision is inspected, so a decision cannot be
 * evaluated without having been checked.
 */
export function prepareDecision(decision: unknown): CanonicalDecision {
  validateDecision(decision);
  return canonicalizeDecision(decision);
}

/**
 * Is this a well-formed decision? A no-op once it has returned; it only exists
 * to narrow `unknown` to `DecisionSpec`.
 */
export function validateDecision(
  decision: unknown,
): asserts decision is DecisionSpec {
  if (
    typeof decision !== "object" ||
    decision === null ||
    Array.isArray(decision)
  ) {
    throw new ConfigurationError(
      "A decision must be an object mapping question names to questions.",
    );
  }

  const entries = Object.entries(decision);

  if (entries.length === 0) {
    throw new ConfigurationError(
      "A decision must declare at least one question.",
    );
  }

  for (const [id, question] of entries) {
    if (id.trim() === "") {
      throw new ConfigurationError("Question names cannot be empty.");
    }

    assertQuestionShape(id, question);
  }
}

/**
 * Convert a validated decision into the canonical representation providers
 * receive: ids attached, and an explicit ordered list of levels per question.
 */
export function canonicalizeDecision(
  decision: DecisionSpec,
): CanonicalDecision {
  const canonical: Record<string, CanonicalQuestion> = {};

  for (const [id, question] of Object.entries(decision)) {
    canonical[id] = canonicalizeQuestion(id, question);
  }

  return canonical;
}

function assertQuestionShape(id: string, question: unknown): void {
  if (typeof question !== "object" || question === null) {
    throw new ConfigurationError(
      `Question "${id}" must be an object created by boolean(), categorical() or ordinal().`,
    );
  }

  const type: unknown = Reflect.get(question, "type");

  if (type !== "boolean" && type !== "categorical" && type !== "ordinal") {
    throw new ConfigurationError(
      `Question "${id}" has an unsupported type: ${JSON.stringify(type)}.`,
    );
  }
}

function canonicalizeQuestion(
  id: string,
  question: Question,
): CanonicalQuestion {
  switch (question.type) {
    case "boolean":
      return {
        id,
        type: "boolean",
        description: requireDescription(question.description, "boolean"),
      };
    case "categorical":
      return canonicalizeCategorical(id, question);
    case "ordinal":
      return canonicalizeOrdinal(id, question);
  }
}

function canonicalizeCategorical(
  id: string,
  question: CategoricalQuestion,
): CanonicalCategoricalQuestion {
  return {
    id,
    type: "categorical",
    description: requireDescription(question.description, "categorical"),
    levels: levelsFromRecord(
      requireCategoryValues(question.values, "categorical", 1),
    ),
  };
}

function canonicalizeOrdinal(
  id: string,
  question: OrdinalQuestion,
): CanonicalOrdinalQuestion {
  // The array order is the scale. It is preserved exactly as declared, so it can
  // never be reshuffled by JavaScript's key ordering rules.
  const levels: CanonicalLevel[] = question.values.map((value) => ({
    key: value.key,
    description: value.description,
  }));

  return {
    id,
    type: "ordinal",
    description: requireDescription(question.description, "ordinal"),
    levels,
  };
}

function levelsFromRecord(values: Record<string, string>): CanonicalLevel[] {
  const levels: CanonicalLevel[] = [];

  for (const [key, description] of Object.entries(values)) {
    levels.push({ key, description });
  }

  return levels;
}
