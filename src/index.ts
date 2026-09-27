export const VERSION = "0.1.0";

export { boolean, type BooleanConfig } from "./schema/boolean";
export { categorical, type CategoricalConfig } from "./schema/categorical";
export { ordinal, type OrdinalConfig } from "./schema/ordinal";
export type {
  BooleanQuestion,
  CategoricalQuestion,
  CategoryValues,
  OrdinalQuestion,
  Question,
  QuestionType,
  ValueOf,
} from "./schema/types";

export {
  defineDecision,
  normalizeDecision,
  type DecisionResult,
  type DecisionSpec,
  type ResultFor,
} from "./core/decision";

export {
  DecisionEngine,
  DEFAULT_TIMEOUT_MS,
  type DecisionEngineOptions,
} from "./core/engine";

export {
  createBooleanResult,
  createDistributionResult,
  DISTRIBUTION_SUM_TOLERANCE,
  type BooleanResult,
  type CategoricalResult,
  type DistributionResult,
  type OrdinalResult,
} from "./core/result";

export {
  ConfigurationError,
  DecimoError,
  InvalidProviderResponseError,
  isDecimoError,
  ProviderError,
  ProviderTimeoutError,
} from "./core/errors";

export type {
  BooleanAnswer,
  CategoricalAnswer,
  DecisionProvider,
  NormalizedBooleanQuestion,
  NormalizedCategoricalQuestion,
  NormalizedOrdinalQuestion,
  NormalizedQuestion,
  OrdinalAnswer,
  ProviderAnswer,
  ProviderContext,
  ProviderRequest,
  ProviderResponse,
} from "./providers/provider";

export {
  MockProvider,
  type MockProviderOptions,
  type MockResponder,
} from "./providers/mock";

/**
 * Providers are configured here and nowhere else. Provider-internal request and
 * response shapes stay inside each provider's module.
 */
export { JevProvider, type JevProviderOptions } from "./providers/jev";

export type { JsonObject, JsonPrimitive, JsonValue } from "./types/json";
export { assertJsonValue, isJsonValue } from "./types/json";
export type { HttpFetch, HttpRequestInit, HttpResponse } from "./types/http";
