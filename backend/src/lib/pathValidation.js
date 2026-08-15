/**
 * Path validation middleware and utilities for file write endpoints.
 * Ensures all file operations stay within allowed base directories.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import config from './config.js';

// Allowed base directories for file writes
const ALLOWED_WRITE_ROOTS = new Set([
  config.collageImagesRoot,
  config.exportsRoot,
  config.loadLayoutsDir,
  config.libraryImagesRoot,
  config.pixelDataRoot,
  config.tempDir,
]);

/**
 * Validate that a resolved path is within an allowed base directory.
 * @param {string} resolvedPath - The resolved absolute path
 * @returns {{ ok: boolean, error?: string }}
 */
export function isPathWithinAllowedRoots(resolvedPath) {
  const resolved = path.resolve(resolvedPath);
  for (const root of ALLOWED_WRITE_ROOTS) {
    const allowedRoot = path.resolve(root);
    if (resolved.startsWith(allowedRoot + path.sep) || resolved === allowedRoot) {
      return { ok: true };
    }
  }
  return { ok: false, error: `Path ${resolved} is outside allowed write directories` };
}

/**
 * Validate a client-provided output path for file writes.
 * Rejects path traversal, absolute paths outside allowed roots, and symlinks.
 * @param {string} userOutputPath - The path provided by the client
 * @param {string} defaultRoot - The default root to use if no custom path provided
 * @param {string} [relativeAllowedRoot] - If provided, relative paths are resolved against this root
 * @returns {{ safe: boolean, resolvedRoot: string, error?: string }}
 */
export function validateClientOutputPath(userOutputPath, defaultRoot, relativeAllowedRoot) {
  if (!userOutputPath || typeof userOutputPath !== 'string' || !userOutputPath.trim()) {
    return { safe: true, resolvedRoot: path.resolve(defaultRoot) };
  }

  const trimmed = userOutputPath.trim().replace(/[\\/]+$/, '');

  // Reject directory traversal
  if (trimmed.includes('..')) {
    return { safe: false, resolvedRoot: '', error: 'Invalid path — directory traversal ("..") is not allowed.' };
  }

  // Remove dangerous characters
  const sanitized = trimmed.replace(/[<>"|?*]/g, '_');

  if (path.isAbsolute(sanitized)) {
    const resolved = path.resolve(sanitized);
    // Verify the resolved path is within allowed roots
    const rootCheck = isPathWithinAllowedRoots(resolved);
    if (!rootCheck.ok) {
      return { safe: false, resolvedRoot: '', error: rootCheck.error };
    }
    return { safe: true, resolvedRoot: resolved };
  }

  // Relative path: resolve against the allowed relative root or default root
  const baseRoot = relativeAllowedRoot || defaultRoot;
  const resolved = path.resolve(baseRoot, sanitized);
  const rootCheck = isPathWithinAllowedRoots(resolved);
  if (!rootCheck.ok) {
    return { safe: false, resolvedRoot: '', error: rootCheck.error };
  }
  return { safe: true, resolvedRoot: resolved };
}

/**
 * Middleware that validates client-provided output paths in request body.
 * Expects `outputPath` in req.body. If invalid, returns 400.
 * If valid, replaces req.body.outputPath with the resolved safe path.
 */
export function validateOutputPathMiddleware(defaultRoot) {
  return (req, res, next) => {
    if (req.body && typeof req.body.outputPath === 'string') {
      const result = validateClientOutputPath(req.body.outputPath, defaultRoot);
      if (!result.safe) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      req.body.outputPath = result.resolvedRoot;
    }
    next();
  };
}

/**
 * Validate that a combination object has the required structure.
 * @param {any} combo - The combination object to validate
 * @param {number} index - The index in the array (for error messages)
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateCombinationObject(combo, index) {
  if (!combo || typeof combo !== 'object') {
    return { ok: false, error: `Combination at index ${index} is not an object` };
  }

  const objects = combo.objects;
  if (!objects || typeof objects !== 'object') {
    return { ok: false, error: `Combination at index ${index} missing objects` };
  }

  const hasBag = objects.bag && typeof objects.bag === 'object';
  const hasThreats = Array.isArray(objects.threats);
  const hasNonThreats = Array.isArray(objects['non-threats']);

  if (!hasBag && !hasThreats && !hasNonThreats) {
    return { ok: false, error: `Combination at index ${index} must have at least one bag, threat, or non-threat` };
  }

  return { ok: true };
}

/**
 * Validate the combinations array from client request.
 * @param {any[]} combinations - The combinations array
 * @param {number} maxCombinations - Maximum allowed combinations
 * @returns {{ ok: boolean, error?: string, sanitized?: any[] }}
 */
export function validateCombinationsArray(combinations, maxCombinations = 10000) {
  if (!Array.isArray(combinations)) {
    return { ok: false, error: 'combinations must be an array' };
  }

  if (combinations.length === 0) {
    return { ok: false, error: 'combinations array is empty' };
  }

  if (combinations.length > maxCombinations) {
    return { ok: false, error: `Maximum ${maxCombinations} combinations allowed per request` };
  }

  // Validate each combination structure
  for (let i = 0; i < combinations.length; i++) {
    const result = validateCombinationObject(combinations[i], i);
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true, sanitized: combinations };
}
