import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConfigurationError,
  InvalidProviderResponseError,
  ProviderError,
  ProviderTimeoutError,
  type HttpFetch,
  type HttpRequestInit,
  type HttpResponse,
} from "../src/index";
import {
  JevClient,
  JEV_DEFAULT_BASE_URL,
  JEV_DEFAULT_MODEL,
} from "../src/providers/jev/client";

const questions = {
  needsHuman: { type: "noul", instructions: "Does this need a human?" },
} as const;

interface StubCall {
  readonly url: string;
  readonly init: HttpRequestInit;
}

function stubFetch(
  body: string,
  status = 200,
): { fetch: HttpFetch; calls: StubCall[] } {
  const calls: StubCall[] = [];

  const fetch: HttpFetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      text: () => Promise.resolve(body),
    } satisfies HttpResponse);
  };

  return { fetch, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JevClient", () => {
  it("requires an API key", () => {
    expect(() => new JevClient()).toThrow(ConfigurationError);
    expect(() => new JevClient({ apiKey: "" })).toThrow(ConfigurationError);
  });

  it("exposes the default endpoint and model", () => {
    const client = new JevClient({ apiKey: "test-key" });

    expect(client.baseUrl).toBe(JEV_DEFAULT_BASE_URL);
    expect(client.model).toBe(JEV_DEFAULT_MODEL);
  });

  it("posts the state and questions with bearer auth", async () => {
    const { fetch, calls } = stubFetch(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: { needsHuman: { type: "noul", noul: 0.95 } },
      }),
    );

    const client = new JevClient({ apiKey: "test-key", fetch });
    const response = await client.evaluate({
      state: { message: "My card was charged twice" },
      questions,
    });

    const call = calls[0];

    expect(call?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers.authorization).toBe("Bearer test-key");
    expect(call?.init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(call?.init.body ?? "{}")).toEqual({
      model: "jev-latest",
      state: { message: "My card was charged twice" },
      questions: {
        needsHuman: { type: "noul", instructions: "Does this need a human?" },
      },
    });
    expect(response.answers.needsHuman).toEqual({ type: "noul", noul: 0.95 });
  });

  it("surfaces HTTP failures as ProviderError with the server message", async () => {
    const { fetch } = stubFetch(
      JSON.stringify({ message: "invalid api key" }),
      401,
    );
    const client = new JevClient({ apiKey: "bad", fetch });

    await expect(
      client.evaluate({ state: "hi", questions }),
    ).rejects.toBeInstanceOf(ProviderError);
    await expect(client.evaluate({ state: "hi", questions })).rejects.toThrow(
      /401.*invalid api key/,
    );
  });

  it("treats a 429 rate limit as a ProviderError", async () => {
    const { fetch } = stubFetch(JSON.stringify({ message: "slow down" }), 429);

    await expect(
      new JevClient({ apiKey: "k", fetch }).evaluate({
        state: "hi",
        questions,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("rejects a response that is not JSON", async () => {
    const { fetch } = stubFetch("<html>gateway</html>");

    await expect(
      new JevClient({ apiKey: "k", fetch }).evaluate({
        state: "hi",
        questions,
      }),
    ).rejects.toBeInstanceOf(InvalidProviderResponseError);
  });

  it("rejects a response without an answers map", async () => {
    const { fetch } = stubFetch(JSON.stringify({ model: "jev-1.13.0" }));

    await expect(
      new JevClient({ apiKey: "k", fetch }).evaluate({
        state: "hi",
        questions,
      }),
    ).rejects.toThrow(/without an answers map/);
  });

  it("rejects a response that is not a JSON object", async () => {
    const { fetch } = stubFetch("[1,2,3]");

    await expect(
      new JevClient({ apiKey: "k", fetch }).evaluate({
        state: "hi",
        questions,
      }),
    ).rejects.toThrow(/not a JSON object/);
  });

  it("wraps transport failures in a ProviderError", async () => {
    const fetch: HttpFetch = () => Promise.reject(new Error("ECONNREFUSED"));

    await expect(
      new JevClient({ apiKey: "k", fetch }).evaluate({
        state: "hi",
        questions,
      }),
    ).rejects.toThrow(/The Jev request failed: ECONNREFUSED/);
  });

  it("times out and reports ProviderTimeoutError", async () => {
    let aborted = false;

    const fetch: HttpFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true;
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const client = new JevClient({ apiKey: "k", fetch, timeoutMs: 5 });

    try {
      await client.evaluate({ state: "hi", questions });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderTimeoutError);
      expect((error as ProviderTimeoutError).provider).toBe("jev");
    }

    expect(aborted).toBe(true);
  });

  it("honours an already aborted caller signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const fetch: HttpFetch = (_url, init) => {
      expect(init.signal?.aborted).toBe(true);
      const error = new Error("aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    };

    await expect(
      new JevClient({ apiKey: "k", fetch }).evaluate(
        { state: "hi", questions },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/was aborted/);
  });

  it("validates the base url, model and timeout", () => {
    expect(() => new JevClient({ apiKey: "k", baseUrl: "" })).toThrow(
      ConfigurationError,
    );
    expect(() => new JevClient({ apiKey: "k", model: "" })).toThrow(
      ConfigurationError,
    );
    expect(() => new JevClient({ apiKey: "k", timeoutMs: -5 })).toThrow(
      ConfigurationError,
    );
  });

  it("strips a trailing slash from the base url", () => {
    expect(
      new JevClient({
        apiKey: "k",
        baseUrl: "https://example.com/v1/systemone/",
      }).baseUrl,
    ).toBe("https://example.com/v1/systemone");
  });
});
