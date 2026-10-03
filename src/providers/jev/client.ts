import {
  ConfigurationError,
  InvalidProviderResponseError,
  ProviderError,
  ProviderTimeoutError,
} from "../../core/errors";
import type { HttpFetch, HttpResponse } from "../../types/http";
import {
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "../../types/json";
import type { ProviderContext } from "../provider";
import type { JevQuestion, JevWireRequest, JevWireResponse } from "./types";

export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-latest";

const PROVIDER = "jev";

export interface JevClientOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetch?: HttpFetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface JevEvaluateInput {
  readonly state: JsonValue;
  readonly questions: Readonly<Record<string, JevQuestion>>;
}

export class JevClient {
  readonly baseUrl: string;
  readonly model: string;

  private readonly apiKey: string;
  private readonly fetchImpl: HttpFetch;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly timeoutMs: number | undefined;

  constructor(options: JevClientOptions = {}) {
    this.apiKey = resolveApiKey(options.apiKey);
    this.baseUrl = resolveBaseUrl(options.baseUrl);
    this.model = resolveModel(options.model);
    this.timeoutMs = resolveTimeout(options.timeoutMs);
    this.fetchImpl = resolveFetch(options.fetch);
    this.headers = { ...options.headers };
  }

  async evaluate(
    input: JevEvaluateInput,
    context: ProviderContext = {},
  ): Promise<JevWireResponse> {
    const payload: JevWireRequest = {
      model: this.model,
      state: input.state,
      questions: input.questions,
    };

    const controller = new AbortController();
    const callerSignal = context.signal;
    const timeoutMs = context.timeoutMs ?? this.timeoutMs;

    if (callerSignal !== undefined) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener(
          "abort",
          () => {
            controller.abort();
          },
          { once: true },
        );
      }
    }

    let timedOut = false;
    let handle: ReturnType<typeof setTimeout> | undefined;

    if (timeoutMs !== undefined) {
      handle = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    let response: HttpResponse;

    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...this.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      throw this.toTransportError(error, timedOut, timeoutMs, callerSignal);
    } finally {
      clearTimeout(handle);
    }

    if (!response.ok) {
      throw await this.toHttpError(response);
    }

    return parseResponse(response);
  }

  private toTransportError(
    error: unknown,
    timedOut: boolean,
    timeoutMs: number | undefined,
    callerSignal: AbortSignal | undefined,
  ): unknown {
    if (timedOut) {
      return new ProviderTimeoutError(
        `Jev did not respond within ${String(timeoutMs)}ms.`,
        { provider: PROVIDER, timeoutMs: timeoutMs ?? 0, cause: error },
      );
    }

    if (callerSignal?.aborted === true || isAbortError(error)) {
      return new ProviderError("The Jev request was aborted.", {
        provider: PROVIDER,
        cause: error,
      });
    }

    const reason = error instanceof Error ? error.message : String(error);

    return new ProviderError(`The Jev request failed: ${reason}`, {
      provider: PROVIDER,
      cause: error,
    });
  }

  private async toHttpError(response: HttpResponse): Promise<ProviderError> {
    const body = await readText(response);
    const detail = extractMessage(body);

    return new ProviderError(
      `Jev responded with ${response.status}${
        response.statusText === undefined || response.statusText === ""
          ? ""
          : ` ${response.statusText}`
      }${detail === undefined ? "." : `: ${detail}`}`,
      { provider: PROVIDER, cause: new Error(body) },
    );
  }
}

async function readText(response: HttpResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function parseResponse(response: HttpResponse): Promise<JevWireResponse> {
  const body = await readText(response);

  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new InvalidProviderResponseError(
      "Jev returned a response that is not valid JSON.",
      { details: { provider: PROVIDER, received: body }, cause: error },
    );
  }

  if (!isJsonObject(parsed)) {
    throw new InvalidProviderResponseError(
      "Jev returned a response that is not a JSON object.",
      { details: { provider: PROVIDER, received: parsed } },
    );
  }

  if (!isJsonObject((parsed as JsonObject).answers as unknown)) {
    throw new InvalidProviderResponseError(
      "Jev returned a response without an answers map.",
      { details: { provider: PROVIDER, received: parsed } },
    );
  }

  return parsed as unknown as JevWireResponse;
}

function extractMessage(body: string): string | undefined {
  if (body === "") {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(body);

    if (isJsonObject(parsed)) {
      for (const key of ["message", "error", "detail"]) {
        const value = (parsed as Record<string, unknown>)[key];

        if (typeof value === "string" && value !== "") {
          return value;
        }
      }
    }
  } catch {
    return body;
  }

  return body;
}

function resolveApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey === "") {
    throw new ConfigurationError(
      "JevProvider requires an API key. Pass `apiKey` or set TYPESAFE_API_KEY.",
    );
  }

  if (typeof apiKey !== "string") {
    throw new ConfigurationError("The Jev API key must be a string.");
  }

  return apiKey;
}

function resolveBaseUrl(baseUrl: string | undefined): string {
  if (baseUrl === undefined) {
    return JEV_DEFAULT_BASE_URL;
  }

  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new ConfigurationError("baseUrl must be a non-empty string.");
  }

  return baseUrl.replace(/\/+$/, "");
}

function resolveModel(model: string | undefined): string {
  if (model === undefined) {
    return JEV_DEFAULT_MODEL;
  }

  if (typeof model !== "string" || model.trim() === "") {
    throw new ConfigurationError("model must be a non-empty string.");
  }

  return model;
}

function resolveTimeout(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined) {
    return undefined;
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

function resolveFetch(fetchImpl: HttpFetch | undefined): HttpFetch {
  if (fetchImpl !== undefined) {
    if (typeof fetchImpl !== "function") {
      throw new ConfigurationError("fetch must be a function.");
    }

    return fetchImpl;
  }

  const globalFetch = (globalThis as { fetch?: unknown }).fetch;

  if (typeof globalFetch !== "function") {
    throw new ConfigurationError(
      "No global fetch is available; pass a `fetch` implementation to JevProvider.",
    );
  }

  return globalFetch.bind(globalThis) as HttpFetch;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
