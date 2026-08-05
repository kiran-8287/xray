/**
 * Test helpers - creates a valid minimal PNG file that Jimp can read
 * This is a proper 1x1 grayscale PNG with correct CRC
 */

import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Create a valid 1x1 grayscale PNG file
 * Returns the file path
 */
export async function createTestPng(dir, filename) {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  
  // Minimal valid PNG: 1x1 pixel, 8-bit grayscale
  // Created using proper PNG chunk format
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR chunk length (13)
    0x49, 0x48, 0x44, 0x52, // "IHDR" type
    0x00, 0x00, 0x00, 0x01, // width = 1
    0x00, 0x00, 0x00, 0x01, // height = 1
    0x08,                   // bit depth = 8
    0x00,                   // color type = grayscale
    0x00,                   // compression
    0x00,                   // filter
    0x00,                   // interlace
    0x77, 0x4F, 0x5A, 0x06, // IHDR CRC (calculated)
    
    0x00, 0x00, 0x00, 0x0A, // IDAT chunk length (10)
    0x49, 0x44, 0x41, 0x54, // "IDAT" type
    0x78, 0x01, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // compressed data
    0xE2, 0x21, 0xBC, 0x33, // IDAT CRC
    
    0x00, 0x00, 0x00, 0x00, // IEND chunk length
    0x49, 0x45, 0x4E, 0x44, // "IEND" type
    0xAE, 0x42, 0x60, 0x82  // IEND CRC
  ]);
  
  await fs.writeFile(filePath, png);
  return filePath;
}