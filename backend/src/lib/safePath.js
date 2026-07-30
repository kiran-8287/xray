/**
 * Safe file and path handling utilities.
 * 
 * Prevents path traversal attacks and validates user-controlled path inputs.
 * All file operations that involve user-provided paths should go through these functions.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Sanitize a filename: remove path separators and dangerous characters.
 * Returns only the base filename (no directory components).
 * 
 * @param {string} filename - The raw filename from user input
 * @returns {string} Sanitized filename
 */
export function sanitizeFilename(filename) {
  if (typeof filename !== 'string') return '';
  // Remove all path separators
  let safe = filename.replace(/[/\\]/g, '');
  // Remove null bytes
  safe = safe.replace(/\0/g, '');
  // Remove relative path components
  safe = safe.replace(/\.\./g, '');
  // Trim to reasonable length
  safe = safe.slice(0, 255);
  return safe;
}

/**
 * Validate and resolve a file path, ensuring it stays within the allowed root.
 * 
 * @param {string} userPath - The path provided by the user (from request body/params)
 * @param {string} allowedRoot - The root directory that is allowed
 * @returns {{ safe: boolean, resolved: string, error?: string }}
 */
export function resolveSafePath(userPath, allowedRoot) {
  if (typeof userPath !== 'string' || !userPath.trim()) {
    return { safe: false, resolved: '', error: 'Path is empty or invalid' };
  }

  // Strip null bytes
  const cleaned = userPath.replace(/\0/g, '');

  // Resolve the path relative to the allowed root
  const resolved = path.resolve(allowedRoot, cleaned);

  // Verify the resolved path is within the allowed root
  if (!resolved.startsWith(allowedRoot)) {
    return {
      safe: false,
      resolved,
      error: `Path traversal detected: ${userPath} resolves outside allowed directory`,
    };
  }

  return { safe: true, resolved, error: undefined };
}

/**
 * Validate that a user-provided path component (like a relative path within data directory)
 * does not contain traversal sequences and is safe to use.
 * 
 * @param {string} userPathComponent - A path component from user input (e.g., pixelDataPath)
 * @returns {{ valid: boolean, cleaned: string, error?: string }}
 */
export function validatePathComponent(userPathComponent) {
  if (typeof userPathComponent !== 'string' || !userPathComponent.trim()) {
    return { valid: false, cleaned: '', error: 'Path component is empty' };
  }

  // Remove null bytes
  const cleaned = userPathComponent.replace(/\0/g, '');

  // Check for path traversal
  if (cleaned.includes('..')) {
    return { valid: false, cleaned, error: 'Path traversal (..) is not allowed' };
  }

  // Check for absolute paths (starts with / or drive letter)
  if (cleaned.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(cleaned)) {
    return { valid: false, cleaned, error: 'Absolute paths are not allowed. Use relative paths only.' };
  }

  // Check for dangerous characters
  const dangerous = /[<>"|?*]/;
  if (dangerous.test(cleaned)) {
    return { valid: false, cleaned, error: 'Path contains dangerous characters' };
  }

  return { valid: true, cleaned, error: undefined };
}

/**
 * Safely join a user-provided path component with a root directory,
 * ensuring no path traversal occurs.
 * 
 * @param {string} rootDir - The root directory (must be absolute)
 * @param {string} userComponent - The user-provided path component
 * @returns {{ safe: boolean, fullPath: string, error?: string }}
 */
export function safeJoin(rootDir, userComponent) {
  const validation = validatePathComponent(userComponent);
  if (!validation.valid) {
    return { safe: false, fullPath: '', error: validation.error };
  }

  // Use forward slashes for consistency
  const normalized = validation.cleaned.replace(/\\/g, '/');
  const joined = path.join(rootDir, normalized);
  const resolved = path.resolve(joined);

  // Double-check: resolved path must start with rootDir
  if (!resolved.startsWith(path.resolve(rootDir))) {
    return { safe: false, fullPath: resolved, error: 'Path traversal detected after resolution' };
  }

  return { safe: true, fullPath: resolved, error: undefined };
}

/**
 * Read a file only if it exists within an allowed root directory.
 * 
 * @param {string} userPath - User-provided file path
 * @param {string} allowedRoot - Allowed root directory
 * @returns {Promise<{ ok: boolean, data?: Buffer, error?: string }>}
 */
export async function safeReadFile(userPath, allowedRoot) {
  const { safe, resolved, error } = resolveSafePath(userPath, allowedRoot);
  if (!safe) {
    return { ok: false, error };
  }

  try {
    const data = await fs.readFile(resolved);
    return { ok: true, data };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: false, error: `File not found: ${path.basename(resolved)}` };
    }
    return { ok: false, error: err.message };
  }
}

/**
 * Delete a file only if it exists within an allowed root directory.
 * Silently ignores if the file doesn't exist (ENOENT).
 * 
 * @param {string} userPath - User-provided file path
 * @param {string} allowedRoot - Allowed root directory
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function safeDeleteFile(userPath, allowedRoot) {
  const { safe, resolved, error } = resolveSafePath(userPath, allowedRoot);
  if (!safe) {
    return { ok: false, error };
  }

  try {
    await fs.unlink(resolved);
    return { ok: true };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: true }; // File already gone, that's fine
    }
    return { ok: false, error: err.message };
  }
}