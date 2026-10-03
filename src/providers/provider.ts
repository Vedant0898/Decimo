import type { CanonicalAnswer, CanonicalDecision } from "../schema/canonical";
import type { JsonValue } from "../types/json";

/**
 * The provider contract, expressed entirely in Decimo's canonical vocabulary.
 *
 * A provider receives canonical questions — an id and an explicit ordered list
 * of levels — plus the state, and returns canonical answers. It maps between
 * that and its own wire format; nothing provider-specific crosses this boundary.
 */
export interface ProviderRequest {
  readonly state: JsonValue;
  readonly questions: CanonicalDecision;
}

export interface ProviderResponse {
  readonly answers: Readonly<Record<string, CanonicalAnswer>>;
  /** The provider's untouched payload, for debugging. Never interpreted. */
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
