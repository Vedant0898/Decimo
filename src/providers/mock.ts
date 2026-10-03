import type { CanonicalAnswer, CanonicalLevel } from "../schema/canonical";
import type {
  DecisionProvider,
  ProviderContext,
  ProviderRequest,
  ProviderResponse,
} from "./provider";

export type MockResponder = (
  request: ProviderRequest,
  context?: ProviderContext,
) => ProviderResponse | Promise<ProviderResponse>;

export interface MockProviderOptions {
  readonly responder?: MockResponder;
}

export class MockProvider implements DecisionProvider {
  readonly name = "mock";

  private readonly responder: MockResponder | undefined;

  constructor(options: MockProviderOptions = {}) {
    this.responder = options.responder;
  }

  evaluate(
    request: ProviderRequest,
    context?: ProviderContext,
  ): Promise<ProviderResponse> {
    if (this.responder !== undefined) {
      return Promise.resolve(this.responder(request, context));
    }

    return Promise.resolve({ answers: uniformAnswers(request) });
  }
}

function uniformAnswers(
  request: ProviderRequest,
): Record<string, CanonicalAnswer> {
  const answers: Record<string, CanonicalAnswer> = {};

  for (const [id, question] of Object.entries(request.questions)) {
    switch (question.type) {
      case "boolean":
        answers[id] = { type: "boolean", probability: 0.5 };
        break;
      case "categorical":
        answers[id] = {
          type: "categorical",
          probabilities: uniform(question.levels),
        };
        break;
      case "ordinal":
        answers[id] = {
          type: "ordinal",
          probabilities: uniform(question.levels),
        };
        break;
    }
  }

  return answers;
}

function uniform(levels: readonly CanonicalLevel[]): Record<string, number> {
  const probability = 1 / levels.length;
  const probabilities: Record<string, number> = {};

  for (const level of levels) {
    probabilities[level.key] = probability;
  }

  return probabilities;
}
