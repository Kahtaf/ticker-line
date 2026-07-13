export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

function entry(
  level: "info" | "warn" | "error",
  event: string,
  fields: LogFields = {},
): LogFields {
  return {
    ...fields,
    timestamp: new Date().toISOString(),
    schemaVersion: "v1",
    level,
    event,
    message: event,
  };
}

export function errorLogFields(error: unknown): LogFields {
  if (!(error instanceof Error)) {
    return { errorType: "UnknownError", errorMessage: String(error) };
  }
  const cause = error.cause;
  return {
    errorType: error.name,
    errorMessage: error.message,
    causeType: cause instanceof Error ? cause.name : undefined,
    causeMessage:
      cause instanceof Error
        ? cause.message
        : typeof cause === "string"
          ? cause
          : undefined,
  };
}

export const logger: Logger = {
  info(event, fields) {
    console.log(entry("info", event, fields));
  },
  warn(event, fields) {
    console.warn(entry("warn", event, fields));
  },
  error(event, fields) {
    console.error(entry("error", event, fields));
  },
};
