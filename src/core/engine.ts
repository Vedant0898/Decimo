import {
  ConfigurationError,
  isDecimoError,
  ProviderError,
  ProviderTimeoutError,
} from "./errors";
import {
  prepareDecision,
  type DecisionResult,
  type DecisionSpec,
} from "./decision";
import { validateProviderResponse } from "./response";
import {
  createBooleanResult,
  createDistributionResult,
  type ValidatedResult,
} from "./result";
import { assertJsonValue, type JsonValue } from "../types/json";
import type { CanonicalDecision, AnswerPair } from "../schema/canonical";
import type {
  DecisionProvider,
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

  /**
   * Validate and canonicalize the decision, hand it to the provider, then
   * validate what comes back. The decision is inspected exactly once, here.
   */
  async evaluate<D extends DecisionSpec>(
    decision: D,
    state: JsonValue,
  ): Promise<DecisionResult<D>> {
    const canonical = prepareDecision(decision);
    assertJsonValue(state);

    const request: ProviderRequest = { state, questions: canonical };
    const response = await this.callProvider(request);

    return buildResults(
      response,
      canonical,
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
      return call;
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
      return await Promise.race([call, timeout]);
    } finally {
      clearTimeout(handle);
    }
  }
}

function buildResults(
  response: unknown,
  decision: CanonicalDecision,
  providerName: string,
): Record<string, ValidatedResult> {
  const results: Record<string, ValidatedResult> = {};

  for (const pair of validateProviderResponse(
    response,
    decision,
    providerName,
  )) {
    results[pair.id] = resultOf(pair);
  }

  return results;
}

/**
 * `pair.kind` discriminates the union, so narrowing it narrows the question and
 * its matching answer together.
 */
function resultOf(pair: AnswerPair): ValidatedResult {
  switch (pair.kind) {
    case "boolean":
      return createBooleanResult(pair.answer);
    case "categorical":
    case "ordinal":
      return createDistributionResult(pair.question.levels, pair.answer);
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

  const candidate: unknown = Reflect.get(provider, "name");

  return typeof candidate === "string" && candidate !== ""
    ? candidate
    : "unknown";
}
