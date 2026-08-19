/**
 * Audit logging middleware for sensitive operations.
 * Logs all mutation operations with request context for security auditing.
 */

import pino from 'pino';
import config from './config.js';

const logger = pino({ level: config.logLevel === 'info' ? 'warn' : config.logLevel });

/**
 * Middleware that logs mutation operations for audit trail.
 * @param {string} operation - The operation name (e.g., 'delete_item', 'update_layout')
 */
export function auditLog(operation) {
  return (req, res, next) => {
    const originalSend = res.json.bind(res);
    res.json = function(body) {
      // Log successful mutations
      if (res.statusCode >= 200 && res.statusCode < 300 && req.body) {
        const apiKey = req.headers['x-api-key'];
        const keyId = apiKey ? apiKey.slice(0, 8) + '...' : 'none';
        logger.info({
          operation,
          method: req.method,
          path: req.path,
          keyId,
          status: res.statusCode,
          body: typeof body === 'object' ? JSON.stringify(body).slice(0, 500) : String(body).slice(0, 500)
        }, `audit_${operation}`);
      }
      return originalSend(body);
    };
    next();
  };
}
