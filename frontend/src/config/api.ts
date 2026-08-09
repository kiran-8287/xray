/**
 * API Configuration
 *
 * Uses the current page hostname so the browser never makes cross-origin requests
 * during local development, regardless of whether the user opened localhost or 127.0.0.1.
 */

const resolvedApiBase =
  (typeof window !== 'undefined' && window.location.hostname) ||
  (import.meta.env.VITE_API_HOST || '127.0.0.1');

export const API_BASE_URL = `http://${resolvedApiBase}:8080`;

console.log('[API Config] Using API_BASE_URL:', API_BASE_URL);

export default API_BASE_URL;
