import type { CategoryValues } from "../schema/types";
import type { JsonValue } from "../types/json";

export interface NormalizedBooleanQuestion {
  readonly id: string;
  readonly type: "boolean";
  readonly description: string;
}

export interface NormalizedCategoricalQuestion {
  readonly id: string;
  readonly type: "categorical";
  readonly description: string;
  readonly values: CategoryValues;
}

export interface NormalizedOrdinalQuestion {
  readonly id: string;
  readonly type: "ordinal";
  readonly description: string;
  readonly values: CategoryValues;
}

export type NormalizedQuestion =
  | NormalizedBooleanQuestion
  | NormalizedCategoricalQuestion
  | NormalizedOrdinalQuestion;

export interface ProviderRequest {
  readonly state: JsonValue;
  readonly questions: Readonly<Record<string, NormalizedQuestion>>;
}

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

export type ProviderAnswer = BooleanAnswer | CategoricalAnswer | OrdinalAnswer;

export interface ProviderResponse {
  readonly answers: Readonly<Record<string, ProviderAnswer>>;
  readonly raw?: unknown;
}

export interface ProviderContext {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface DecisionProvider {
  evaluate(
    request: ProviderRequest,
    context?: ProviderContext,
  ): Promise<ProviderResponse>;
}
