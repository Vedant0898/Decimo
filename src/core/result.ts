import {
  InvalidProviderResponseError,
  type InvalidProviderResponseDetails,
} from "./errors";

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

export const DISTRIBUTION_SUM_TOLERANCE = 1e-6;

function details(
  provider: string | undefined,
  questionId: string,
  received: unknown,
): InvalidProviderResponseDetails {
  return provider === undefined
    ? { questionId, received }
    : { provider, questionId, received };
}

export function createBooleanResult(input: {
  readonly questionId: string;
  readonly probability: unknown;
  readonly confidence?: unknown;
  readonly provider?: string;
}): BooleanResult {
  const probability = assertProbability(
    input.probability,
    input.questionId,
    "probability",
    input.provider,
  );
  const confidence = assertOptionalProbability(
    input.confidence,
    input.questionId,
    "confidence",
    input.provider,
  );

  return confidence === undefined
    ? { probability }
    : { probability, confidence };
}

export function createDistributionResult<T extends string>(input: {
  readonly questionId: string;
  readonly values: readonly T[];
  readonly probabilities: unknown;
  readonly confidence?: unknown;
  readonly provider?: string;
}): DistributionResult<T> {
  const { questionId, values, provider } = input;

  if (typeof input.probabilities !== "object" || input.probabilities === null) {
    throw new InvalidProviderResponseError(
      `Question "${questionId}" must be answered with a probability distribution.`,
      { details: details(provider, questionId, input.probabilities) },
    );
  }

  const received = input.probabilities as Record<string, unknown>;
  const declared = new Set(values);
  const accumulated = {} as Record<T, number>;
  let total = 0;

  for (const value of values) {
    const probability = received[value];

    if (probability === undefined) {
      throw new InvalidProviderResponseError(
        `Question "${questionId}" is missing a probability for value "${value}".`,
        { details: details(provider, questionId, input.probabilities) },
      );
    }

    const checked = assertProbability(
      probability,
      questionId,
      `probability for "${value}"`,
      provider,
    );

    total += checked;
    accumulated[value] = checked;
  }

  for (const key of Object.keys(received)) {
    if (!declared.has(key as T)) {
      throw new InvalidProviderResponseError(
        `Question "${questionId}" was answered with the unknown value "${key}".`,
        { details: details(provider, questionId, input.probabilities) },
      );
    }
  }

  if (Math.abs(total - 1) > DISTRIBUTION_SUM_TOLERANCE) {
    throw new InvalidProviderResponseError(
      `Question "${questionId}" probabilities must sum to 1, received ${total}.`,
      { details: details(provider, questionId, input.probabilities) },
    );
  }

  const confidence = assertOptionalProbability(
    input.confidence,
    questionId,
    "confidence",
    provider,
  );

  const probabilityOf = (value: T): number => {
    const probability = accumulated[value];

    if (probability === undefined) {
      throw new InvalidProviderResponseError(
        `Question "${questionId}" has no declared value "${String(value)}".`,
        { details: details(provider, questionId, input.probabilities) },
      );
    }

    return probability;
  };

  const mostLikely = (): T => {
    let best = values[0] as T;

    for (const value of values) {
      if (probabilityOf(value) > probabilityOf(best)) {
        best = value;
      }
    }

    return best;
  };

  const distribution = (): Record<T, number> => ({ ...accumulated });

  return confidence === undefined
    ? { probability: probabilityOf, mostLikely, distribution }
    : { probability: probabilityOf, mostLikely, distribution, confidence };
}

function assertProbability(
  value: unknown,
  questionId: string,
  label: string,
  provider?: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidProviderResponseError(
      `Question "${questionId}" has a non-numeric ${label}.`,
      { details: details(provider, questionId, value) },
    );
  }

  if (value < 0 || value > 1) {
    throw new InvalidProviderResponseError(
      `Question "${questionId}" has a ${label} outside [0, 1]: ${value}.`,
      { details: details(provider, questionId, value) },
    );
  }

  return value;
}

function assertOptionalProbability(
  value: unknown,
  questionId: string,
  label: string,
  provider?: string,
): number | undefined {
  return value === undefined
    ? undefined
    : assertProbability(value, questionId, label, provider);
}
