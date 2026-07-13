export const PUBLIC_ERROR_CODES = [
  "INVALID_REQUEST",
  "TICKER_NOT_FOUND",
  "INSUFFICIENT_DATA",
  "RATE_LIMITED",
  "PROVIDER_ERROR",
  "SERVICE_UNAVAILABLE",
] as const;

export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

export type PublicError = Readonly<{
  code: PublicErrorCode;
  status: 400 | 404 | 405 | 422 | 429 | 502 | 503;
  message: string;
  retryAfterSeconds?: number;
}>;

export abstract class DomainError extends Error {
  abstract readonly category: string;
  readonly retryAfterSeconds: number | undefined;

  protected constructor(
    message: string,
    options?: ErrorOptions & { retryAfterSeconds?: number },
  ) {
    super(message, options);
    this.name = new.target.name;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export class InvalidRequestError extends DomainError {
  readonly category = "invalid_request";
  constructor(message = "The request is invalid.", options?: ErrorOptions) {
    super(message, options);
  }
}

export class MethodNotAllowedError extends DomainError {
  readonly category = "method_not_allowed";
  constructor(
    message = "The HTTP method is not supported for this endpoint.",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class TickerNotFoundError extends DomainError {
  readonly category = "ticker_not_found";
  constructor(
    message = "No market data was found for the requested ticker.",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class ProviderNotFoundError extends TickerNotFoundError {}

export class InsufficientDataError extends DomainError {
  readonly category = "insufficient_data";
  constructor(
    message = "There is not enough market data to render this chart.",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class RateLimitedError extends DomainError {
  readonly category = "rate_limited";
  constructor(
    message = "Too many requests. Please try again later.",
    options?: ErrorOptions & { retryAfterSeconds?: number },
  ) {
    super(message, options);
  }
}

export class ProviderRateLimitError extends RateLimitedError {}

export class ProviderError extends DomainError {
  readonly category = "provider_error";
  readonly providerStatus: number | undefined;
  readonly attempt: number | undefined;
  constructor(
    message = "The market data provider is temporarily unavailable.",
    options?: ErrorOptions & {
      retryAfterSeconds?: number;
      providerStatus?: number;
      attempt?: number;
    },
  ) {
    super(message, options);
    this.providerStatus = options?.providerStatus;
    this.attempt = options?.attempt;
  }
}

export class ProviderTimeoutError extends ProviderError {}
export class ProviderSchemaError extends ProviderError {}
export class ProviderAuthenticationError extends ProviderError {}

export class ServiceUnavailableError extends DomainError {
  readonly category = "service_unavailable";
  constructor(
    message = "The service is temporarily unavailable.",
    options?: ErrorOptions & { retryAfterSeconds?: number },
  ) {
    super(message, options);
  }
}

function withRetryAfter(
  error: DomainError,
  value: Omit<PublicError, "retryAfterSeconds">,
): PublicError {
  return error.retryAfterSeconds === undefined
    ? value
    : { ...value, retryAfterSeconds: error.retryAfterSeconds };
}

export function toPublicError(error: unknown): PublicError {
  if (error instanceof MethodNotAllowedError) {
    return { code: "INVALID_REQUEST", status: 405, message: error.message };
  }
  if (error instanceof InvalidRequestError) {
    return { code: "INVALID_REQUEST", status: 400, message: error.message };
  }
  if (error instanceof TickerNotFoundError) {
    return { code: "TICKER_NOT_FOUND", status: 404, message: error.message };
  }
  if (error instanceof InsufficientDataError) {
    return { code: "INSUFFICIENT_DATA", status: 422, message: error.message };
  }
  if (error instanceof RateLimitedError) {
    return withRetryAfter(error, {
      code: "RATE_LIMITED",
      status: 429,
      message: error.message,
    });
  }
  if (error instanceof ProviderError) {
    return withRetryAfter(error, {
      code: "PROVIDER_ERROR",
      status: 502,
      message: "The market data provider is temporarily unavailable.",
    });
  }
  if (error instanceof ServiceUnavailableError) {
    return withRetryAfter(error, {
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      message: error.message,
    });
  }
  return {
    code: "SERVICE_UNAVAILABLE",
    status: 503,
    message: "The service is temporarily unavailable.",
  };
}
