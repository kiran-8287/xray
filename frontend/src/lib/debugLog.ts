const enabled = import.meta.env.DEV;

function info(...args: unknown[]): void {
  if (enabled) {
    console.log("[debug]", ...args);
  }
}

function warn(...args: unknown[]): void {
  if (enabled) {
    console.warn("[debug]", ...args);
  }
}

function error(...args: unknown[]): void {
  if (enabled) {
    console.error("[debug]", ...args);
  }
}

export { enabled, info, warn, error };
