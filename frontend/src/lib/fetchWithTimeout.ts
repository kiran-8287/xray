/**
 * Fetch with a timeout to prevent infinite loading spinners.
 *
 * For long-running workflows such as uploads, collage rendering, and
 * bulk saves, we allow a larger timeout window and one automatic retry
 * after an abort so the user can recover without manually restarting.
 */

export async function fetchWithTimeout(
  url: string,
  options: Parameters<typeof fetch>[1] = {},
  timeoutMs = 30000,
  retries = 0,
  retryDelayMs = 1000
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (err: any) {
      lastError = err;
      if (err.name === "AbortError") {
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
          attempt += 1;
          continue;
        }
        throw new Error(`Request timed out after ${timeoutMs}ms. Please check your connection and try again.`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export const LONG_REQUEST_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const MEDIUM_REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes