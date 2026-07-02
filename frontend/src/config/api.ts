/**
 * API Configuration
 * Dynamically determines API URL based on current hostname for browser requests
 */

// Determine API base URL - prioritize runtime hostname detection for browser environments
export const API_BASE_URL = 
  (typeof window !== 'undefined'
    ? `http://${window.location.hostname}:8080`
    : (import.meta.env.VITE_API_URL || 'http://localhost:8080'));

console.log('[API Config] Using API_BASE_URL:', API_BASE_URL);

export default API_BASE_URL;
