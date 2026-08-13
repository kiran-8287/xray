/**
 * Fetch with a timeout to prevent infinite loading spinners.
 *
 * For long-running workflows such as uploads, collage rendering, and
 * bulk saves, we allow a larger timeout window and one automatic retry
 * after an abort so the user can recover without manually restarting.
 *
 * Supports an optional external AbortSignal passed via `options.signal`.
 * When that external signal fires (e.g. a user clicked a "Stop Saving"
 * button), the fetch is aborted immediately and the original DOMException
 * "AbortError" is re-thrown so callers can distinguish a user-initiated
 * cancellation from a network timeout.
 */

export async function fetchWithTimeout(
  url: string,
  options: Parameters<typeof fetch>[1] = {},
  timeoutMs = 30000,
  retries = 0,
  retryDelayMs = 1000,
  retryOnStatus?: number[]
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;

  // The caller may pass their own AbortSignal (e.g. via AbortController)
  // so they can cancel a long-running request programmatically.
  const externalSignal = options.signal instanceof AbortSignal ? options.signal : null;

  while (attempt <= retries) {
    const controller = new AbortController();

    // If the external signal aborts, propagate that abort to our controller.
    const onExternalAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) {
        // Already aborted before the request even started.
        const err = new DOMException("The operation was aborted.", "AbortError");
        throw err;
      }
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        // Our internal controller is the source of truth for the timeout.
        signal: controller.signal,
      });

      if (retryOnStatus && retryOnStatus.includes(response.status) && attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        attempt += 1;
        continue;
      }

      return response;
    } catch (err: any) {
      lastError = err;
      if (err.name === "AbortError") {
        // If the user explicitly aborted via the external signal, re-throw
        // the original abort error instead of turning it into a timeout.
        if (externalSignal?.aborted) {
          throw err;
        }
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
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export const LONG_REQUEST_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const MEDIUM_REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes