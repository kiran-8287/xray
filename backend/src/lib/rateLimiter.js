/**
 * Rate Limiter Middleware
 * Prevents abuse by limiting requests per IP address
 */

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 1000; // 1 second window
    this.maxRequests = options.maxRequests || 20; // Max 20 requests per window
    this.maxConcurrent = options.maxConcurrent || 10; // Max 10 concurrent requests
    this.cleanupInterval = options.cleanupInterval || 300000; // Cleanup every 5 minutes
    
    // Store request timestamps per IP: { ip: [timestamp1, timestamp2, ...] }
    this.requests = new Map();
    
    // Store concurrent request counts per IP: { ip: count }
    this.concurrent = new Map();
    
    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Middleware factory
   */
  middleware() {
    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      
      // Check concurrent request limit
      const currentConcurrent = this.concurrent.get(ip) || 0;
      if (currentConcurrent >= this.maxConcurrent) {
        console.warn(`[RateLimiter] Blocked ${ip} - too many concurrent requests (${currentConcurrent})`);
        return res.status(429).json({ 
          ok: false, 
          error: 'Too many concurrent requests. Please try again later.',
          retryAfter: 1
        });
      }
      
      // Increment concurrent counter
      this.concurrent.set(ip, currentConcurrent + 1);
      
      // Check rate limit
      const now = Date.now();
      const timestamps = this.requests.get(ip) || [];
      
      // Remove old timestamps outside the window
      const windowStart = now - this.windowMs;
      const recentRequests = timestamps.filter(ts => ts > windowStart);
      
      // Check if limit exceeded
      if (recentRequests.length >= this.maxRequests) {
        console.warn(`[RateLimiter] Blocked ${ip} - rate limit exceeded (${recentRequests.length + 1} requests in ${this.windowMs}ms)`);
        this.concurrent.set(ip, currentConcurrent); // Decrement back
        return res.status(429).json({ 
          ok: false, 
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 1
        });
      }
      
      // Add current request timestamp
      recentRequests.push(now);
      this.requests.set(ip, recentRequests);
      
      // Decrement concurrent counter when response finishes
      res.on('finish', () => {
        const count = this.concurrent.get(ip) || 0;
        this.concurrent.set(ip, Math.max(0, count - 1));
      });
      
      next();
    };
  }

  /**
   * Periodic cleanup of old entries
   */
  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.windowMs;
      
      // Clean old request timestamps
      for (const [ip, timestamps] of this.requests.entries()) {
        const recent = timestamps.filter(ts => ts > cutoff);
        if (recent.length === 0) {
          this.requests.delete(ip);
        } else {
          this.requests.set(ip, recent);
        }
      }
      
      // Clean old concurrent counters
      for (const [ip, count] of this.concurrent.entries()) {
        if (count === 0) {
          this.concurrent.delete(ip);
        }
      }
      
      // Only log if there are active connections (reduce noise)
      const totalConnections = Array.from(this.concurrent.values()).reduce((a, b) => a + b, 0);
      if (this.requests.size > 0 || totalConnections > 0) {
        console.log(`[RateLimiter] Status: ${this.requests.size} IPs tracked, ${totalConnections} active connections`);
      }
    }, this.cleanupInterval);
  }

  /**
   * Get current stats (for monitoring)
   */
  getStats() {
    return {
      trackedIPs: this.requests.size,
      concurrentConnections: Array.from(this.concurrent.values()).reduce((a, b) => a + b, 0)
    };
  }
}

// Create rate limiter instances for different endpoints
export const generalRateLimiter = new RateLimiter({
  windowMs: 1000,
  maxRequests: 30, // 30 requests per second
  maxConcurrent: 10 // 10 concurrent requests
});

export const publicApiRateLimiter = new RateLimiter({
  windowMs: 1000,
  maxRequests: 50, // 50 requests per second for public APIs
  maxConcurrent: 30 // 30 concurrent requests — raised to prevent 429s during normal multi-page frontend fetches
});

export const strictRateLimiter = new RateLimiter({
  windowMs: 1000,
  maxRequests: 10, // 10 requests per second
  maxConcurrent: 5 // 5 concurrent requests
});

export default RateLimiter;
