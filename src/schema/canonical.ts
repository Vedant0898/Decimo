/**
 * Decimo's provider-facing canonical representation.
 *
 * A canonical question is the normalized representation passed across
 * Decimo's provider boundary. It is deliberately not the public builder
 * output and never represents a provider's wire format.
 */

/** One labelled level of a categorical or ordinal question. */
export interface CanonicalLevel {
  readonly key: string;
  readonly description: string;
}

export interface CanonicalBooleanQuestion {
  readonly id: string;
  readonly type: "boolean";
  readonly description: string;
}

export interface CanonicalCategoricalQuestion {
  readonly id: string;
  readonly type: "categorical";
  readonly description: string;
  /** Declaration order. Affects only tie-breaking and `distribution()` key order. */
  readonly levels: readonly CanonicalLevel[];
}

export interface CanonicalOrdinalQuestion {
  readonly id: string;
  readonly type: "ordinal";
  readonly description: string;
  /** Ascending scale order. This is the order sent to a provider. */
  readonly levels: readonly CanonicalLevel[];
}

export type CanonicalQuestion =
  | CanonicalBooleanQuestion
  | CanonicalCategoricalQuestion
  | CanonicalOrdinalQuestion;

export type CanonicalQuestionType = CanonicalQuestion["type"];

/** A validated decision, keyed by question name. */
export type CanonicalDecision = Readonly<Record<string, CanonicalQuestion>>;

export interface BooleanAnswer {
  readonly type: "boolean";
  readonly probability: number;
  readonly confidence?: number;
}

export interface CategoricalAnswer {
  readonly type: "categorical";
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence?: number;
}

export interface OrdinalAnswer {
  readonly type: "ordinal";
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence?: number;
}

export type CanonicalAnswer = BooleanAnswer | CategoricalAnswer | OrdinalAnswer;

/**
 * A question paired with its answer of the matching kind.
 *
 * `kind` is the discriminant, directly on the pair: TypeScript only narrows the
 * other properties of a union member from a *direct* discriminant, so putting it
 * on `question` would not narrow `answer` and every consumer would need an
 * assertion. The boundary guarantees `kind` matches `question.type`.
 */
export type AnswerPair =
  | {
      readonly id: string;
      readonly kind: "boolean";
      readonly question: CanonicalBooleanQuestion;
      readonly answer: BooleanAnswer;
    }
  | {
      readonly id: string;
      readonly kind: "categorical";
      readonly question: CanonicalCategoricalQuestion;
      readonly answer: CategoricalAnswer;
    }
  | {
      readonly id: string;
      readonly kind: "ordinal";
      readonly question: CanonicalOrdinalQuestion;
      readonly answer: OrdinalAnswer;
    };
