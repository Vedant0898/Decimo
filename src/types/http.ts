/**
 * Provider-neutral HTTP transport shapes.
 *
 * Decimo never calls the network itself: a provider is handed one of these
 * functions so that hosts, proxies and test doubles can be injected. These
 * types are deliberately structural and minimal, so a global `fetch` satisfies
 * them without any adapter.
 */

export interface HttpRequestInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal;
}

export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  text(): Promise<string>;
}

export type HttpFetch = (
  url: string,
  init: HttpRequestInit,
) => Promise<HttpResponse>;
