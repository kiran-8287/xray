/**
 * Frontend sanitization utilities.
 * Prevents XSS by sanitizing user-generated content before rendering.
 */

/**
 * Escape HTML special characters in a string for safe rendering.
 * @param {string} str - The string to escape
 * @returns {string} Escaped string safe for HTML rendering
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, (char) => map[char] || char);
}

/**
 * Sanitize a string for use in HTML attribute values.
 * @param {string} str - The string to sanitize
 * @returns {string} Sanitized string safe for attribute values
 */
export function escapeAttribute(str) {
  if (typeof str !== 'string') return '';
  return escapeHtml(str);
}

/**
 * Sanitize an array of strings for display.
 * @param {string[]} items - Array of strings to sanitize
 * @param {string} separator - Separator to join with
 * @returns {string} Sanitized joined string
 */
export function sanitizeStringArray(items: string[], separator = ', ') {
  if (!Array.isArray(items)) return '';
  return items.map(escapeHtml).join(escapeHtml(separator));
}

/**
 * Validate and sanitize a layout ID or item ID.
 * Only allows alphanumeric characters, hyphens, and underscores.
 * @param {string} id - The ID to sanitize
 * @returns {string} Sanitized ID
 */
export function sanitizeId(id) {
  if (typeof id !== 'string') return '';
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

/**
 * Validate and sanitize a tag string.
 * @param {string} tag - The tag to sanitize
 * @returns {string} Sanitized tag
 */
export function sanitizeTag(tag) {
  if (typeof tag !== 'string') return '';
  return tag.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}
