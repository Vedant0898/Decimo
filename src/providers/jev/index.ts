import { ConfigurationError } from "../../core/errors";
import type { HttpFetch } from "../../types/http";
import type {
  DecisionProvider,
  ProviderContext,
  ProviderRequest,
  ProviderResponse,
} from "../provider";
import { JevClient } from "./client";
import { mapJevAnswers, mapQuestionsToJev } from "./mapper";

/**
 * Configuration for {@link JevProvider}.
 *
 * This is the entire Jev surface: a provider name, a credential and optional
 * transport overrides. No Jev request or response shape is exposed.
 */
export interface JevProviderOptions {
  /** API key. Falls back to `apiKeyEnvVar`, then `TYPESAFE_API_KEY`. */
  readonly apiKey?: string;
  /** Environment variable to read the API key from. Defaults to `TYPESAFE_API_KEY`. */
  readonly apiKeyEnvVar?: string;
  /** Endpoint to POST to. Defaults to the Jev evaluation endpoint. */
  readonly baseUrl?: string;
  /** Model identifier to request. */
  readonly model?: string;
  /** Extra headers merged into every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Client-side timeout. `0` disables it. Defaults to the engine's timeout. */
  readonly timeoutMs?: number;
  /** Transport to use. Defaults to the global `fetch`. */
  readonly fetch?: HttpFetch;
}

export class JevProvider implements DecisionProvider {
  readonly name = "jev";

  private readonly client: JevClient;

  constructor(options: JevProviderOptions = {}) {
    this.client = new JevClient(toClientOptions(options));
  }

  async evaluate(
    request: ProviderRequest,
    context?: ProviderContext,
  ): Promise<ProviderResponse> {
    const mapped = mapQuestionsToJev(request.questions);

    const response = await this.client.evaluate(
      { state: request.state, questions: mapped.questions },
      context ?? {},
    );

    return { ...mapJevAnswers(mapped, response.answers), raw: response };
  }
}

function toClientOptions(
  options: JevProviderOptions,
): ConstructorParameters<typeof JevClient>[0] {
  const { apiKey, apiKeyEnvVar: envVar, ...rest } = options;
  const resolved = resolveApiKey(apiKey, envVar);

  return resolved === undefined ? rest : { ...rest, apiKey: resolved };
}

function resolveApiKey(
  apiKey: string | undefined,
  envVar: string | undefined,
): string | undefined {
  if (apiKey !== undefined && apiKey !== "") {
    return apiKey;
  }

  const name = envVar ?? "TYPESAFE_API_KEY";
  const fromEnv = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.[name];

  if (fromEnv === undefined || fromEnv === "") {
    throw new ConfigurationError(
      `JevProvider requires an API key. Pass \`apiKey\` or set ${name}.`,
    );
  }

  return fromEnv;
}
