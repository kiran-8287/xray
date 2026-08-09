/**
 * API Configuration
 * Uses 127.0.0.1 instead of localhost to avoid browser DNS resolution issues
 */

// Determine API base URL - use 127.0.0.1 to avoid localhost resolution issues in browsers
export const API_BASE_URL = 
  (typeof window !== 'undefined'
    ? `http://127.0.0.1:8080`
    : (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8080'));

console.log('[API Config] Using API_BASE_URL:', API_BASE_URL);

export default API_BASE_URL;
