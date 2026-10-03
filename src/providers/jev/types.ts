import type { JsonValue } from "../../types/json";

export type JevQuestionType = "noul" | "choice" | "score";

export interface JevNoulQuestion {
  readonly type: "noul";
  readonly instructions: string;
}

export interface JevChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

export interface JevScoreQuestion {
  readonly type: "score";
  readonly instructions: string;
  readonly criteria: readonly string[];
}

export type JevQuestion =
  JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

export interface JevWireRequest {
  readonly model: string;
  readonly state: JsonValue;
  readonly questions: Readonly<Record<string, JevQuestion>>;
}

export interface JevNoulAnswer {
  readonly type: "noul";
  readonly noul: number;
}

export interface JevChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface JevScoreAnswer {
  readonly type: "score";
  readonly score: number;
  readonly legend?: Readonly<Record<string, string>>;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
}

export interface JevWireResponse {
  readonly model?: string;
  readonly answers: Readonly<Record<string, JevAnswer>>;
  readonly usage?: JevUsage;
}
