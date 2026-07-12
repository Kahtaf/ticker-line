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
): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
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
