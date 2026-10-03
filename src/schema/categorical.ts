import type { CategoricalQuestion, CategoryValues } from "./types";
import { requireCategoryValues, requireDescription } from "./types";

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
    values: requireCategoryValues(config.values, "categorical", 1) as T,
  };
}
