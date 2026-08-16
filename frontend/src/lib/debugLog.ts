const enabled = import.meta.env.DEV;

const debugLog = {
  info: (...args: unknown[]): void => {
    if (enabled) {
      console.log("[debug]", ...args);
    }
  },
  warn: (...args: unknown[]): void => {
    if (enabled) {
      console.warn("[debug]", ...args);
    }
  },
  error: (...args: unknown[]): void => {
    if (enabled) {
      console.error("[debug]", ...args);
    }
  },
};

export { enabled, debugLog };
