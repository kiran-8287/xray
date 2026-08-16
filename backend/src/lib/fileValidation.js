/**
 * File validation utilities for upload endpoints.
 * Validates file content (magic numbers) to prevent malicious uploads.
 */

import fs from 'node:fs/promises';

// Magic number signatures for supported file types
const MAGIC_SIGNATURES = {
  // PNG
  png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  // JPEG
  jpeg: [0xFF, 0xD8, 0xFF],
  // TIFF (little-endian)
  tiff_le: [0x49, 0x49, 0x2A, 0x00],
  // TIFF (big-endian)
  tiff_be: [0x4D, 0x4D, 0x00, 0x2A],
  // NPZ (ZIP-based, starts with PK)
  zip: [0x50, 0x4B, 0x03, 0x04],
  // PGM (ASCII starts with P2, binary starts with P5)
  pgm_ascii: [0x50, 0x32],
  pgm_binary: [0x50, 0x35],
  // TIP (custom format, starts with TIP)
  tip: [0x54, 0x49, 0x50],
};

/**
 * Read the first N bytes of a file.
 * @param {string} filePath - Path to the file
 * @param {number} length - Number of bytes to read
 * @returns {Promise<Buffer>}
 */
export async function readFileHeader(filePath, length = 16) {
  try {
    const fd = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      await fd.read(buffer, 0, length, 0);
      return buffer;
    } finally {
      await fd.close();
    }
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Check if a buffer matches a magic signature.
 * @param {Buffer} buffer - The file header buffer
 * @param {number[]} signature - The expected magic bytes
 * @returns {boolean}
 */
function matchesSignature(buffer, signature) {
  if (buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Detect file type from magic numbers.
 * @param {string} filePath - Path to the file
 * @returns {Promise<string|null>} Detected file type or null if unknown
 */
export async function detectFileType(filePath) {
  const header = await readFileHeader(filePath, 16);
  if (header.length === 0) return null;

  if (matchesSignature(header, MAGIC_SIGNATURES.png)) return 'png';
  if (matchesSignature(header, MAGIC_SIGNATURES.jpeg)) return 'jpeg';
  if (matchesSignature(header, MAGIC_SIGNATURES.tiff_le) || matchesSignature(header, MAGIC_SIGNATURES.tiff_be)) return 'tiff';
  if (matchesSignature(header, MAGIC_SIGNATURES.zip)) return 'zip';
  if (matchesSignature(header, MAGIC_SIGNATURES.pgm_ascii) || matchesSignature(header, MAGIC_SIGNATURES.pgm_binary)) return 'pgm';
  if (matchesSignature(header, MAGIC_SIGNATURES.tip)) return 'tip';

  return null;
}

/**
 * Allowed file extensions mapped to expected magic number types.
 */
const ALLOWED_EXTENSIONS = {
  '.png': ['png'],
  '.jpg': ['jpeg'],
  '.jpeg': ['jpeg'],
  '.tiff': ['tiff'],
  '.tif': ['tiff'],
  '.npz': ['zip'],
  '.pgm': ['pgm'],
  '.dump.pgm': ['pgm'],
  '.tip': ['pgm', 'tip'],
  '.dump': ['pgm', 'tip'],
};

/**
 * Validate a file's magic number matches its extension.
 * @param {string} filePath - Path to the file
 * @param {string} extension - The file extension (e.g., '.png', '.npz')
 * @returns {{ ok: boolean, error?: string, detectedType?: string }}
 */
export async function validateFileMagicNumber(filePath, extension) {
  const expectedTypes = ALLOWED_EXTENSIONS[extension.toLowerCase()];
  if (!expectedTypes) {
    return { ok: false, error: `Unsupported file extension: ${extension}` };
  }

  const detectedType = await detectFileType(filePath);
  if (!detectedType) {
    return { ok: false, error: `Unknown file format - file may be corrupted or malicious` };
  }

  if (!expectedTypes.includes(detectedType)) {
    return {
      ok: false,
      error: `File type mismatch: expected ${expectedTypes.join('/')} but detected ${detectedType}`,
      detectedType,
    };
  }

  return { ok: true, detectedType };
}

/**
 * Validate file size is within reasonable limits.
 * @param {number} fileSize - Size of the file in bytes
 * @param {number} maxSize - Maximum allowed size in bytes
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateFileSize(fileSize, maxSize) {
  if (typeof fileSize !== 'number' || fileSize < 0) {
    return { ok: false, error: 'Invalid file size' };
  }
  if (fileSize > maxSize) {
    return { ok: false, error: `File size ${fileSize} bytes exceeds maximum allowed size ${maxSize} bytes` };
  }
  if (fileSize === 0) {
    return { ok: false, error: 'File is empty' };
  }
  return { ok: true };
}
