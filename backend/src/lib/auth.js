/**
 * Authentication and authorization middleware.
 * 
 * Protects write endpoints (POST, PUT, DELETE) using API key validation.
 * Read endpoints (GET) are left open for the frontend to function,
 * but can be locked down by setting REQUIRE_AUTH_FOR_READS=true.
 */

import config from './config.js';

/**
 * Middleware that requires a valid API key for write operations.
 * The API key must be sent in the X-API-Key header.
 * 
 * If API_KEY is not configured (null/empty), auth is disabled
 * and all requests pass through (development mode).
 */
export function requireAuth(req, res, next) {
  // If no API key is configured, skip auth (development mode)
  if (!config.apiKey) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      ok: false,
      error: 'Authentication required. Provide an API key via the X-API-Key header.',
    });
  }

  if (apiKey !== config.apiKey) {
    return res.status(403).json({
      ok: false,
      error: 'Invalid API key.',
    });
  }

  next();
}

/**
 * Middleware that requires auth for ALL endpoints including reads.
 * Use this in production environments where the API should be completely locked down.
 */
export function requireAuthStrict(req, res, next) {
  if (!config.apiKey) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      ok: false,
      error: 'Authentication required. Provide an API key via the X-API-Key header.',
    });
  }

  if (apiKey !== config.apiKey) {
    return res.status(403).json({
      ok: false,
      error: 'Invalid API key.',
    });
  }

  next();
}

/**
 * Apply auth middleware to all write routes.
 * Call this after setting up routes to protect POST/PUT/DELETE endpoints.
 * 
 * @param {import('express').Application} app - Express application instance
 */
export function protectWriteRoutes(app) {
  // Protect all POST, PUT, DELETE routes
  app.post('*', requireAuth);
  app.put('*', requireAuth);
  app.delete('*', requireAuth);
}