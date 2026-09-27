import type { CategoricalQuestion, CategoryValues } from "./types";
import { requireDescription, requireValues } from "./types";

export interface CategoricalConfig<T extends CategoryValues> {
  readonly description: string;
  readonly values: T;
}

export function categorical<T extends CategoryValues>(
  config: CategoricalConfig<T>,
): CategoricalQuestion<T> {
  return {
    type: "categorical",
    description: requireDescription(config.description, "categorical"),
    values: requireValues(config.values, "categorical", 1) as T,
  };
}
