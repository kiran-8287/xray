/**
 * API Configuration
 * Supports both local development (localhost:8080) and Docker deployment (backend:8080)
 */

// Determine API base URL from environment or infer from current host
export const API_BASE_URL = 
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8080'
    : `http://${window.location.hostname}:8080`);

console.log('[API Config] Using API_BASE_URL:', API_BASE_URL);

export default API_BASE_URL;
