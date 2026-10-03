import type { OrdinalQuestion, OrdinalValue } from "./types";
import { requireDescription, requireOrdinalValues } from "./types";

/**
 * Configuration for an ordered question.
 *
 * `values` must be an ordered array: the order is the scale, so it is the order
 * levels are sent to a provider in and the order `mostLikely()` breaks ties in.
 */
export interface OrdinalConfig<T extends string = string> {
  readonly description: string;
  readonly values: readonly OrdinalValue<T>[];
}

/**
 * `const` keeps each `key` a literal type. Without it, the contextual type from
 * `Question` in a surrounding generic (such as `defineDecision`) widens the keys
 * to `string` and the level union is lost.
 */
export function ordinal<const T extends string>(
  config: OrdinalConfig<T>,
): OrdinalQuestion<T> {
  return {
    type: "ordinal",
    description: requireDescription(config.description, "ordinal"),
    // Every key was validated as a string above, so widening to T is sound.
    values: requireOrdinalValues(config.values) as readonly OrdinalValue<T>[],
  };
}
