import { ConfigurationError } from "../core/errors";

export type CategoryValues = Record<string, string>;

export interface BooleanQuestion {
  readonly type: "boolean";
  readonly description: string;
}

export interface CategoricalQuestion<
  T extends CategoryValues = CategoryValues,
> {
  readonly type: "categorical";
  readonly description: string;
  readonly values: T;
}

export interface OrdinalQuestion<T extends CategoryValues = CategoryValues> {
  readonly type: "ordinal";
  readonly description: string;
  readonly values: T;
}

export type Question = BooleanQuestion | CategoricalQuestion | OrdinalQuestion;

export type QuestionType = Question["type"];

/** The union of the value keys declared on a categorical or ordinal question. */
export type ValueOf<T extends CategoryValues> = keyof T & string;

export function requireDescription(
  description: unknown,
  questionType: QuestionType,
): string {
  if (typeof description !== "string" || description.trim() === "") {
    throw new ConfigurationError(
      `A ${questionType} question requires a non-empty "description".`,
    );
  }
  return description;
}

export function requireValues(
  values: unknown,
  questionType: QuestionType,
  minimumValues: number,
): CategoryValues {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw new ConfigurationError(
      `A ${questionType} question requires "values" to be an object mapping keys to descriptions.`,
    );
  }

  const entries = Object.entries(values);

  if (entries.length < minimumValues) {
    throw new ConfigurationError(
      `A ${questionType} question requires at least ${minimumValues} value${
        minimumValues === 1 ? "" : "s"
      }, received ${entries.length}.`,
    );
  }

  for (const [key, description] of entries) {
    if (key.trim() === "") {
      throw new ConfigurationError(
        `A ${questionType} question cannot contain an empty value key.`,
      );
    }
    if (typeof description !== "string" || description.trim() === "") {
      throw new ConfigurationError(
        `A ${questionType} question requires a non-empty description for value "${key}".`,
      );
    }
  }

  return values as CategoryValues;
}
