export interface ErrorOptions {
  readonly cause?: unknown;
}

export class DecimoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export interface ProviderErrorOptions extends ErrorOptions {
  readonly provider?: string;
}

export class ProviderError extends DecimoError {
  readonly provider: string;

  constructor(message: string, options?: ProviderErrorOptions) {
    super(message, options);
    this.provider = options?.provider ?? "unknown";
  }
}

export interface ProviderTimeoutErrorOptions extends ProviderErrorOptions {
  readonly timeoutMs: number;
}

export class ProviderTimeoutError extends ProviderError {
  readonly timeoutMs: number;

  constructor(message: string, options: ProviderTimeoutErrorOptions) {
    super(message, options);
    this.timeoutMs = options.timeoutMs;
  }
}

export interface InvalidProviderResponseDetails {
  readonly provider?: string;
  readonly questionId?: string;
  readonly received?: unknown;
}

export interface InvalidProviderResponseErrorOptions extends ErrorOptions {
  readonly details?: InvalidProviderResponseDetails;
}

export class InvalidProviderResponseError extends ProviderError {
  readonly details: InvalidProviderResponseDetails;

  constructor(message: string, options?: InvalidProviderResponseErrorOptions) {
    super(message, {
      ...(options?.details?.provider !== undefined
        ? { provider: options.details.provider }
        : {}),
      ...(options?.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.details = options?.details ?? {};
  }
}

export type ConfigurationErrorOptions = ErrorOptions;

export class ConfigurationError extends DecimoError {
  constructor(message: string, options?: ConfigurationErrorOptions) {
    super(message, options);
  }
}

export function isDecimoError(value: unknown): value is DecimoError {
  return value instanceof DecimoError;
}
