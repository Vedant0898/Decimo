import {
  ConfigurationError,
  InvalidProviderResponseError,
  isDecimoError,
  ProviderError,
  ProviderTimeoutError,
} from "./errors";
import type { DecisionResult, DecisionSpec } from "./decision";
import { normalizeDecision } from "./decision";
import { createBooleanResult, createDistributionResult } from "./result";
import { assertJsonValue, type JsonValue } from "../types/json";
import type {
  DecisionProvider,
  NormalizedQuestion,
  ProviderAnswer,
  ProviderRequest,
  ProviderResponse,
} from "../providers/provider";

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface DecisionEngineOptions {
  readonly timeoutMs?: number;
  readonly providerName?: string;
}

export class DecisionEngine {
  readonly provider: DecisionProvider;

  private readonly timeoutMs: number | undefined;
  private readonly providerName: string;

  constructor(provider: DecisionProvider, options: DecisionEngineOptions = {}) {
    if (
      typeof provider !== "object" ||
      provider === null ||
      typeof provider.evaluate !== "function"
    ) {
      throw new ConfigurationError(
        "DecisionEngine requires a DecisionProvider with an evaluate() method.",
      );
    }

    this.provider = provider;
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs);
    this.providerName = resolveProviderName(provider, options.providerName);
  }

  async evaluate<D extends DecisionSpec>(
    decision: D,
    state: JsonValue,
  ): Promise<DecisionResult<D>> {
    const questions = normalizeDecision(decision);
    assertJsonValue(state);

    const request: ProviderRequest = { state, questions };
    const response = await this.callProvider(request);

    return buildResults(
      questions,
      response,
      this.providerName,
    ) as DecisionResult<D>;
  }

  private async callProvider(
    request: ProviderRequest,
  ): Promise<ProviderResponse> {
    const controller = new AbortController();
    const timeoutMs = this.timeoutMs;
    const call = Promise.resolve()
      .then(() =>
        this.provider.evaluate(request, {
          signal: controller.signal,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        }),
      )
      .catch((error: unknown) => {
        throw wrapProviderError(error, this.providerName);
      });

    if (timeoutMs === undefined) {
      return unwrap(await call, this.providerName);
    }

    let handle: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      handle = setTimeout(() => {
        // Abort first so the in-flight request is cancelled, then reject so the
        // timeout wins the race against any AbortError the provider observes.
        controller.abort();
        reject(
          new ProviderTimeoutError(
            `Provider "${this.providerName}" timed out after ${timeoutMs}ms.`,
            { provider: this.providerName, timeoutMs },
          ),
        );
      }, timeoutMs);
    });

    try {
      return unwrap(await Promise.race([call, timeout]), this.providerName);
    } finally {
      clearTimeout(handle);
    }
  }
}

function wrapProviderError(error: unknown, providerName: string): unknown {
  if (isDecimoError(error)) {
    return error;
  }

  const reason = error instanceof Error ? error.message : String(error);

  return new ProviderError(`Provider "${providerName}" failed: ${reason}`, {
    provider: providerName,
    cause: error,
  });
}

function unwrap(
  response: ProviderResponse,
  providerName: string,
): ProviderResponse {
  if (typeof response !== "object" || response === null) {
    throw new InvalidProviderResponseError(
      `Provider "${providerName}" did not return a response object.`,
      { details: { provider: providerName, received: response } },
    );
  }

  return response;
}

function buildResults(
  questions: Record<string, NormalizedQuestion>,
  response: ProviderResponse,
  providerName: string,
): Record<string, unknown> {
  const answers = response.answers;

  if (
    typeof answers !== "object" ||
    answers === null ||
    Array.isArray(answers)
  ) {
    throw new InvalidProviderResponseError(
      `Provider "${providerName}" did not return an answers map.`,
      { details: { provider: providerName, received: response } },
    );
  }

  const ids = new Set(Object.keys(questions));
  const results: Record<string, unknown> = {};

  for (const [id, question] of Object.entries(questions)) {
    const answer = (answers as Record<string, ProviderAnswer>)[id];

    if (answer === undefined) {
      throw new InvalidProviderResponseError(
        `Provider "${providerName}" did not answer question "${id}".`,
        {
          details: {
            provider: providerName,
            questionId: id,
            received: answers,
          },
        },
      );
    }

    results[id] = buildResult(question, answer, providerName);
  }

  for (const id of Object.keys(answers)) {
    if (!ids.has(id)) {
      throw new InvalidProviderResponseError(
        `Provider "${providerName}" answered the unrequested question "${id}".`,
        {
          details: {
            provider: providerName,
            questionId: id,
            received: answers,
          },
        },
      );
    }
  }

  return results;
}

function buildResult(
  question: NormalizedQuestion,
  answer: ProviderAnswer,
  providerName: string,
): unknown {
  const id = question.id;

  if (typeof answer !== "object" || answer === null) {
    throw new InvalidProviderResponseError(
      `Question "${id}" was answered with a non-object answer.`,
      { details: { provider: providerName, questionId: id, received: answer } },
    );
  }

  if (answer.type !== question.type) {
    throw new InvalidProviderResponseError(
      `Question "${id}" is a ${question.type} question but was answered as ${String(
        answer.type,
      )}.`,
      { details: { provider: providerName, questionId: id, received: answer } },
    );
  }

  if (question.type === "boolean") {
    const booleanAnswer = answer as Extract<
      ProviderAnswer,
      { type: "boolean" }
    >;
    return createBooleanResult({
      questionId: id,
      probability: booleanAnswer.probability,
      confidence: booleanAnswer.confidence,
      provider: providerName,
    });
  }

  const values = Object.keys(question.values) as string[];

  if (question.type === "categorical") {
    const categoricalAnswer = answer as Extract<
      ProviderAnswer,
      { type: "categorical" }
    >;
    return createDistributionResult({
      questionId: id,
      values,
      probabilities: categoricalAnswer.probabilities,
      confidence: categoricalAnswer.confidence,
      provider: providerName,
    });
  }

  const ordinalAnswer = answer as Extract<ProviderAnswer, { type: "ordinal" }>;
  return createDistributionResult({
    questionId: id,
    values,
    probabilities: ordinalAnswer.probabilities,
    confidence: ordinalAnswer.confidence,
    provider: providerName,
  });
}

function resolveTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }

  if (
    typeof timeoutMs !== "number" ||
    Number.isNaN(timeoutMs) ||
    timeoutMs < 0
  ) {
    throw new ConfigurationError(
      `timeoutMs must be a non-negative number, received ${String(timeoutMs)}.`,
    );
  }

  return timeoutMs === 0 ? undefined : timeoutMs;
}

function resolveProviderName(
  provider: DecisionProvider,
  override: string | undefined,
): string {
  if (override !== undefined) {
    if (typeof override !== "string" || override.trim() === "") {
      throw new ConfigurationError("providerName must be a non-empty string.");
    }
    return override;
  }

  const candidate = (provider as { readonly name?: unknown }).name;

  return typeof candidate === "string" && candidate !== ""
    ? candidate
    : "unknown";
}
