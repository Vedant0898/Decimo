import type { CategoryValues, OrdinalQuestion } from "./types";
import { requireDescription, requireValues } from "./types";

export interface OrdinalConfig<T extends CategoryValues> {
  readonly description: string;
  readonly values: T;
}

export function ordinal<T extends CategoryValues>(
  config: OrdinalConfig<T>,
): OrdinalQuestion<T> {
  return {
    type: "ordinal",
    description: requireDescription(config.description, "ordinal"),
    values: requireValues(config.values, "ordinal", 2) as T,
  };
}
