import Jimp from 'jimp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libraryImagesRoot = path.resolve(__dirname, "../../data/library_images");
const pixelDataRoot = path.resolve(__dirname, "../../data/pixel_data");
const READ_NPZ_SCRIPT = path.join(__dirname, 'read_npz.py');

async function loadPixelData(filepath) {
  try {
    const pixelDataPath = path.join(pixelDataRoot, filepath);
    
    // Check if it's an .npz file
    if (filepath.endsWith('.npz')) {
      return await loadPixelDataFromNpz(pixelDataPath);
    }
    
    // Legacy JSON format support (for backward compatibility)
    const data = await fs.readFile(pixelDataPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Failed to load pixel data from ${filepath}:`, err);
    return null;
  }
}

async function loadPixelDataFromNpz(npzPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [READ_NPZ_SCRIPT, '--npz-path', npzPath], {
      cwd: __dirname,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      const lines = stdout.trim().split('\n').filter(Boolean);
      const lastLine = lines[lines.length - 1] || '';

      if (code === 0 && lastLine) {
        try {
          const parsed = JSON.parse(lastLine);
          if (parsed.status === 'error') {
            reject(new Error(parsed.reason || 'Python script returned error'));
          } else {
            // Convert to the expected format for getPixelArray
            resolve({
              pixel_data: parsed.pixel_data,
              width: parsed.width,
              height: parsed.height
            });
          }
        } catch {
          reject(new Error(`Invalid JSON from Python: ${lastLine}`));
        }
      } else {
        reject(new Error(stderr.trim() || lastLine || 'Python process failed'));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start Python process: ${err.message}`));
    });
  });
}

function getPixelArray(pixelData) {
  // For .npz format, pixel data is in pixel_data property
  if (pixelData.pixel_data) return pixelData.pixel_data;
  
  // Legacy JSON format support
  if (pixelData.R) return pixelData.R;
  if (pixelData.high) return pixelData.high;
  if (pixelData.high_raw) return pixelData.high_raw;
  return null;
}

/**
 * Load a PNG image and extract its grayscale pixel data as a 2D array.
 * Each pixel value is mapped from 0-255 to the 0-65535 range.
 */
async function loadPngAsPixelArray(filepath) {
  try {
    const fullPath = path.join(libraryImagesRoot, filepath);
    const image = await Jimp.read(fullPath);
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    
    // Build a 2D array of pixel values (0–65535 range)
    const data = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const pixel = Jimp.intToRGBA(image.getPixelColor(x, y));
        // Convert grayscale: average RGB channels, then map 0-255 → 0-65535
        const gray = Math.round((pixel.r + pixel.g + pixel.b) / 3);
        const val = Math.round((gray / 255) * 65535);
        row.push(val);
      }
      data.push(row);
    }
    
    return { data, width, height };
  } catch (err) {
    console.error(`Failed to load PNG as pixel array: ${filepath}`, err);
    return null;
  }
}

function applyAffineTransform(
  srcData, 
  srcWidth, 
  srcHeight,
  dstWidth, 
  dstHeight,
  tx, 
  ty, 
  scaleX, 
  scaleY,
  rotation
) {
  const dstData = new Float32Array(dstWidth * dstHeight);
  
  // Inverse transform parameters
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const invScaleX = 1 / scaleX;
  const invScaleY = 1 / scaleY;
  
  for (let dstY = 0; dstY < dstHeight; dstY++) {
    for (let dstX = 0; dstX < dstWidth; dstX++) {
      // Translate to origin relative to object center
      const x = (dstX - tx);
      const y = (dstY - ty);
      
      // Rotate
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      
      // Scale
      const sx = rx * invScaleX;
      const sy = ry * invScaleY;
      
      // Translate back to source coordinates
      const srcX = sx + srcWidth / 2;
      const srcY = sy + srcHeight / 2;
      
      // Check bounds
      if (srcX >= 0 && srcX < srcWidth && srcY >= 0 && srcY < srcHeight) {
        const sx0 = Math.floor(srcX);
        const sy0 = Math.floor(srcY);
        const sx1 = Math.min(sx0 + 1, srcWidth - 1);
        const sy1 = Math.min(sy0 + 1, srcHeight - 1);
        
        const dx = srcX - sx0;
        const dy = srcY - sy0;
        
        // Bilinear interpolation
        const v00 = srcData[sy0][sx0];
        const v01 = srcData[sy0][sx1];
        const v10 = srcData[sy1][sx0];
        const v11 = srcData[sy1][sx1];
        
        const v0 = v00 * (1 - dx) + v01 * dx;
        const v1 = v10 * (1 - dx) + v11 * dx;
        const v = v0 * (1 - dy) + v1 * dy;
        
        dstData[dstY * dstWidth + dstX] = v;
      }
    }
  }
  
  return dstData;
}

/**
 * Async helper that loads raw pixel arrays and performs per‑pixel attenuation calculation.
 * Returns a PNG buffer of the composited scene.
 */
export async function renderSceneAsync(objects, width = 800, height = 600, energyType = "highenrgy") {
  // Initialize density buffer with 0 (air)
  const densityBuffer = new Float32Array(width * height);

  const sorted = [...objects].sort((a, b) => a.layer - b.layer);
  
  for (const obj of sorted) {
    if (!obj.id) continue;
    
    let srcArray = null;
    let srcWidth = 0;
    let srcHeight = 0;
    
    // Try pixel data first (from raw .dump.pgm / .tip processing)
    let pixelDataFilename = obj.pixel_data_path || null;
    if (pixelDataFilename) {
      // If low energy requested, replace the folder prefix from highenrgy to lowenergy
      if (energyType === "lowenergy") {
        pixelDataFilename = pixelDataFilename.replace(/^highenrgy[\\/]/, "lowenergy/");
      }
      const pixelData = await loadPixelData(pixelDataFilename);
      if (pixelData) {
        srcArray = getPixelArray(pixelData);
        if (srcArray) {
          srcHeight = srcArray.length;
          srcWidth = srcArray[0].length;
        }
      }
    }
    
    // Fallback: load from PNG image (for library items uploaded as regular images)
    if (!srcArray && obj.filepath) {
      const pngResult = await loadPngAsPixelArray(obj.filepath);
      if (pngResult) {
        srcArray = pngResult.data;
        srcWidth = pngResult.width;
        srcHeight = pngResult.height;
      }
    }
    
    // If still no data, skip this object
    if (!srcArray) {
      console.warn(`⚠️  No pixel data or image found for ${obj.name || obj.id}, skipping`);
      continue;
    }
    
    // Calculate transformation
    const scaleX = (obj.transform.width || srcWidth) / srcWidth;
    const scaleY = (obj.transform.height || srcHeight) / srcHeight;
    const rotation = (obj.transform.rotation * Math.PI) / 180;
    const tx = obj.transform.x;
    const ty = obj.transform.y;
    
    // Apply transformation to source data
    const transformedData = applyAffineTransform(
      srcArray,
      srcWidth,
      srcHeight,
      width,
      height,
      tx,
      ty,
      scaleX,
      scaleY,
      rotation
    );
    
    // Update density buffer
    for (let i = 0; i < transformedData.length; i++) {
      const val = transformedData[i];
      if (val > 0 && val < 65535) { // Only add density if pixel has value
        const mu = -Math.log(Math.max(1, val) / 65535);
        densityBuffer[i] += mu;
      }
    }
  }

  // Convert density buffer to final grayscale image using Beer-Lambert Law
  const image = new Jimp(width, height, 0x000000);
  
  for (let i = 0; i < densityBuffer.length; i++) {
    const density = densityBuffer[i];
    const intensity = 65535 * Math.exp(-density);
    const g = Math.round((intensity / 65535) * 255);
    
    const x = i % width;
    const y = Math.floor(i / width);
    image.setPixelColor(Jimp.rgbaToInt(g, g, g, 255), x, y);
  }
  
  return await image.getBufferAsync(Jimp.MIME_PNG);
}