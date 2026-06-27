import Jimp from 'jimp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libraryImagesRoot = path.resolve(__dirname, "../../data/library_images");
const pixelDataRoot = path.resolve(__dirname, "../../data/pixel_data");

async function loadPixelData(filepath) {
  try {
    const pixelDataPath = path.join(pixelDataRoot, filepath);
    const data = await fs.readFile(pixelDataPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

function getPixelArray(pixelData) {
  // For dump files, use R or high
  if (pixelData.R) return pixelData.R;
  if (pixelData.high) return pixelData.high;
  if (pixelData.high_raw) return pixelData.high_raw;
  return null;
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
export async function renderSceneAsync(objects, width = 800, height = 600) {
  // Initialize density buffer with 0 (air)
  const densityBuffer = new Float32Array(width * height);

  const sorted = [...objects].sort((a, b) => a.layer - b.layer);
  
  for (const obj of sorted) {
    if (!obj.id) continue;
    
    // Try to load pixel data first
    const pixelDataFilename = obj.pixel_data_path || null;
    let pixelData = null;
    let srcArray = null;
    let srcWidth = 0;
    let srcHeight = 0;
    
    if (pixelDataFilename) {
      pixelData = await loadPixelData(pixelDataFilename);
      if (pixelData) {
        srcArray = getPixelArray(pixelData);
        if (srcArray) {
          srcHeight = srcArray.length;
          srcWidth = srcArray[0].length;
        }
      }
    }
    
    // If no pixel data, use fallback method (PNG image)
    if (!srcArray) {
      console.warn(`⚠️  No pixel data found for ${obj.name || obj.id}, using fallback PNG rendering`);
      // ... (keep existing fallback logic if needed, but we can skip for now)
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
    
    // Get attenuation coefficient
    const pixelVal = typeof obj.originalPixelValue === 'number' 
      ? obj.originalPixelValue 
      : (typeof obj.pixel_value === 'number' ? obj.pixel_value : 32767);
    
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

