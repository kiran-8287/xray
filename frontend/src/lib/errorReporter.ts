type ErrorContext = Record<string, unknown>;

function reportError(error: unknown, context?: ErrorContext): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const report: Record<string, unknown> = {
    message,
    ...(stack ? { stack } : {}),
    ...(context || {}),
  };
  if (import.meta.env.DEV) {
    console.error("[ErrorReporter]", report);
  }
}

export { reportError };
