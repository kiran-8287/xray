/**
 * X-ray physics utilities for per-pixel material combination.
 *
 * Uses direct multiplication: result = (I1 * I2) / 65535
 * This preserves full precision — no information is lost.
 */

/**
 * Combine two pixel intensity values (0–65535) using direct multiplication.
 * This represents X-ray attenuation through two overlapping materials.
 */
export function combinePixels(i1: number, i2: number): number {
  return Math.round((i1 * i2) / 65535);
}

/**
 * Convert a 0–255 grayscale value to 0–65535 range.
 */
export function to16Bit(value: number): number {
  return Math.round(value * 257); // 255 * 257 ≈ 65535
}

/**
 * Convert a 0–65535 value to 0–255 grayscale range.
 */
export function to8Bit(value: number): number {
  return Math.round(value / 257);
}