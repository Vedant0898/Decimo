import { ConfigurationError } from "../core/errors";

/** Key-to-description map used by unordered (categorical) questions. */
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

/** One labelled level of an ordinal scale. */
export interface OrdinalValue<T extends string = string> {
  readonly key: T;
  readonly description: string;
}

/**
 * An ordered question. `values` is an ordered array, and `T` is the union of its
 * keys in scale order — the order sent to a provider and used to break ties in
 * `mostLikely()`.
 */
export interface OrdinalQuestion<T extends string = string> {
  readonly type: "ordinal";
  readonly description: string;
  readonly values: readonly OrdinalValue<T>[];
}

export type Question = BooleanQuestion | CategoricalQuestion | OrdinalQuestion;

export type QuestionType = Question["type"];

/** The union of the value keys declared on a categorical question. */
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

export function requireCategoryValues(
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

export function requireOrdinalValues(values: unknown): readonly OrdinalValue[] {
  if (!Array.isArray(values)) {
    throw new ConfigurationError(
      'An ordinal question requires "values" to be an ordered array of { key, description }, in ascending scale order.',
    );
  }

  if (values.length < 2) {
    throw new ConfigurationError(
      `An ordinal question requires at least 2 levels, received ${values.length}.`,
    );
  }

  const seen = new Set<string>();
  const levels: OrdinalValue[] = [];

  for (const entry of values) {
    if (typeof entry !== "object" || entry === null) {
      throw new ConfigurationError(
        'Each ordinal level must be an object with a "key" and a "description".',
      );
    }

    const { key, description } = entry as {
      key?: unknown;
      description?: unknown;
    };

    if (typeof key !== "string" || key.trim() === "") {
      throw new ConfigurationError(
        'Each ordinal level requires a non-empty string "key".',
      );
    }

    if (typeof description !== "string" || description.trim() === "") {
      throw new ConfigurationError(
        `Ordinal level "${key}" requires a non-empty "description".`,
      );
    }

    if (seen.has(key)) {
      throw new ConfigurationError(
        `Ordinal level "${key}" is declared more than once.`,
      );
    }

    seen.add(key);
    levels.push({ key, description });
  }

  return levels;
}
