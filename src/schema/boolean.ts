import type { BooleanQuestion } from "./types";
import { requireDescription } from "./types";

export interface BooleanConfig {
  readonly description: string;
}

export function boolean(config: BooleanConfig): BooleanQuestion {
  return {
    type: "boolean",
    description: requireDescription(config.description, "boolean"),
  };
}
