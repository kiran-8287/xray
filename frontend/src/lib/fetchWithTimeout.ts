/**
 * Fetch with a timeout to prevent infinite loading spinners
 * if the backend hangs or becomes unreachable.
 */

export async function fetchWithTimeout(
  url: string,
  options: Parameters<typeof fetch>[1] = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms. Please check your connection and try again.`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}