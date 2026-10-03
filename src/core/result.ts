/**
 * Result construction.
 *
 * Inputs here are already validated by the provider-response boundary, so this
 * module only builds. It contains no `unknown` inputs and performs no provider
 * checks — there is exactly one validation path in Decimo.
 */

import type {
  BooleanAnswer,
  CanonicalLevel,
  CategoricalAnswer,
  OrdinalAnswer,
} from "../schema/canonical";

export interface BooleanResult {
  readonly probability: number;
  readonly confidence?: number;
}

export interface DistributionResult<T extends string> {
  probability(value: T): number;
  mostLikely(): T;
  distribution(): Record<T, number>;
  readonly confidence?: number;
}

export type CategoricalResult<T extends string> = DistributionResult<T>;
export type OrdinalResult<T extends string> = DistributionResult<T>;

/** How far a provider's distribution may deviate from summing to 1. */
export const DISTRIBUTION_SUM_TOLERANCE = 1e-6;

export type ValidatedResult = BooleanResult | DistributionResult<string>;

export function createBooleanResult(answer: BooleanAnswer): BooleanResult {
  return answer.confidence === undefined
    ? { probability: answer.probability }
    : { probability: answer.probability, confidence: answer.confidence };
}

export function createDistributionResult(
  levels: readonly CanonicalLevel[],
  answer: CategoricalAnswer | OrdinalAnswer,
): DistributionResult<string> {
  const first = levels[0];

  if (first === undefined) {
    throw new Error("A distribution result requires at least one level.");
  }

  const accumulated: Record<string, number> = {};

  for (const level of levels) {
    const probability = answer.probabilities[level.key];

    // The boundary guarantees this; absent a bug it is unreachable.
    if (probability === undefined) {
      throw new Error(`Value "${level.key}" was not answered.`);
    }

    accumulated[level.key] = probability;
  }

  const probabilityOf = (value: string): number => {
    const probability = accumulated[value];

    if (probability === undefined) {
      throw new TypeError(
        `"${value}" is not a declared value of this question.`,
      );
    }

    return probability;
  };

  // Ties resolve to the earliest declared level, because `levels` is ordered.
  let best = first.key;

  for (const level of levels) {
    if (probabilityOf(level.key) > probabilityOf(best)) {
      best = level.key;
    }
  }

  const mostLikely = (): string => best;
  const distribution = (): Record<string, number> => ({ ...accumulated });

  return answer.confidence === undefined
    ? { probability: probabilityOf, mostLikely, distribution }
    : {
        probability: probabilityOf,
        mostLikely,
        distribution,
        confidence: answer.confidence,
      };
}
