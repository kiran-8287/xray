import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import zlib from 'zlib';

import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libraryImagesRoot = config.libraryImagesRoot;
const pixelDataRoot = config.pixelDataRoot;
const READ_NPZ_SCRIPT = path.join(__dirname, 'read_npz.py');

function crc32(data) {
  let crc = 0xFFFFFFFF;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encode16BitGrayscalePNG(width, height, pixels) {
  const rowBytes = 1 + width * 2;
  const rawData = Buffer.allocUnsafe(height * rowBytes);

  for (let y = 0; y < height; y++) {
    rawData[y * rowBytes] = 0;
    const rowStart = y * rowBytes + 1;
    for (let x = 0; x < width; x++) {
      const val = pixels[y * width + x];
      rawData[rowStart + x * 2] = (val >>> 8) & 0xFF;
      rawData[rowStart + x * 2 + 1] = val & 0xFF;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

async function loadPixelData(filepath) {
  try {
    const pixelDataPath = path.join(pixelDataRoot, filepath);
    
    if (filepath.endsWith('.npz')) {
      return await loadPixelDataFromNpz(pixelDataPath);
    }
    
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
          } else if (Array.isArray(parsed)) {
            let width = 0;
            let height = parsed.length;
            try {
              const meta = JSON.parse(lines[0]);
              if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
                width = meta.width || (parsed[0] ? parsed[0].length : 0);
                height = meta.height || height;
              }
            } catch {
              // fall through with dimensions derived from the array itself
            }
            if (width === 0 && parsed[0]) width = parsed[0].length;
            resolve({ pixel_data: parsed, width, height });
          } else if (parsed && typeof parsed === 'object' && parsed.pixel_data) {
            resolve({
              pixel_data: parsed.pixel_data,
              width: parsed.width,
              height: parsed.height
            });
          } else {
            reject(new Error(`Unexpected Python output: ${lastLine.slice(0, 200)}`));
          }
        } catch {
          reject(new Error(`Invalid JSON from Python: ${lastLine.slice(0, 200)}`));
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
  if (pixelData.pixel_data) return pixelData.pixel_data;
  
  if (pixelData.R) return pixelData.R;
  if (pixelData.high) return pixelData.high;
  if (pixelData.high_raw) return pixelData.high_raw;
  if (pixelData.low) return pixelData.low;
  if (pixelData.low_raw) return pixelData.low_raw;
  return null;
}

async function loadPngAsPixelArray(filepath) {
  try {
    const fullPath = path.join(libraryImagesRoot, filepath);
    const image = await Jimp.read(fullPath);
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    
    const data = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const pixel = Jimp.intToRGBA(image.getPixelColor(x, y));
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
  
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const invScaleX = 1 / scaleX;
  const invScaleY = 1 / scaleY;
  
  for (let dstY = 0; dstY < dstHeight; dstY++) {
    for (let dstX = 0; dstX < dstWidth; dstX++) {
      const x = (dstX - tx);
      const y = (dstY - ty);
      
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      
      const sx = rx * invScaleX;
      const sy = ry * invScaleY;
      
      const srcX = sx + srcWidth / 2;
      const srcY = sy + srcHeight / 2;
      
      if (srcX >= 0 && srcX < srcWidth && srcY >= 0 && srcY < srcHeight) {
        const sx0 = Math.floor(srcX);
        const sy0 = Math.floor(srcY);
        const sx1 = Math.min(sx0 + 1, srcWidth - 1);
        const sy1 = Math.min(sy0 + 1, srcHeight - 1);
        
        const dx = srcX - sx0;
        const dy = srcY - sy0;
        
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

export async function renderSceneAsync(objects, width = 800, height = 600, energyType = "highenergy", warnings = null) {
  const densityBuffer = new Float32Array(width * height);

  const sorted = [...objects].sort((a, b) => a.layer - b.layer);
   
  for (const obj of sorted) {
    if (!obj.id) continue;
    
    if (!obj.transform || typeof obj.transform !== 'object') {
      const msg = `Missing transform for object ${obj.name || obj.id}, skipping`;
      console.warn(`⚠️  ${msg}`);
      if (Array.isArray(warnings)) {
        warnings.push(msg);
      }
      continue;
    }
    
    const tx = obj.transform.x;
    const ty = obj.transform.y;
    const objWidth = obj.transform.width;
    const objHeight = obj.transform.height;
    const objRotation = obj.transform.rotation;
    
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || 
        !Number.isFinite(objWidth) || !Number.isFinite(objHeight) || 
        !Number.isFinite(objRotation)) {
      const msg = `Invalid transform values for ${obj.name || obj.id} (x=${tx}, y=${ty}, w=${objWidth}, h=${objHeight}, r=${objRotation}), skipping`;
      console.warn(`⚠️  ${msg}`);
      if (Array.isArray(warnings)) {
        warnings.push(msg);
      }
      continue;
    }
    
    let srcArray = null;
    let srcWidth = 0;
    let srcHeight = 0;
    
    let pixelDataFilename = obj.pixel_data_path || null;
    if (pixelDataFilename) {
      if (energyType === "lowenergy") {
        pixelDataFilename = pixelDataFilename.replace(/^highenergy[\\/]/, "lowenergy/");
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
    
    if (!srcArray && obj.filepath) {
      const pngResult = await loadPngAsPixelArray(obj.filepath);
      if (pngResult) {
        srcArray = pngResult.data;
        srcWidth = pngResult.width;
        srcHeight = pngResult.height;
      }
    }
    
    if (!srcArray) {
      const msg = `No pixel data or image found for ${obj.name || obj.id}`;
      console.warn(`⚠️  ${msg}`);
      if (Array.isArray(warnings)) {
        warnings.push(msg);
      }
      continue;
    }
    
    const scaleX = objWidth / srcWidth;
    const scaleY = objHeight / srcHeight;
    const rotation = (objRotation * Math.PI) / 180;
    
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
    
    for (let i = 0; i < transformedData.length; i++) {
      const val = transformedData[i];
      if (val > 0 && val < 65535) {
        const mu = -Math.log(Math.max(1, val) / 65535);
        densityBuffer[i] += mu;
      }
    }
  }

  const raw16 = new Uint16Array(width * height);
  for (let i = 0; i < densityBuffer.length; i++) {
    const intensity = 65535 * Math.exp(-densityBuffer[i]);
    raw16[i] = Math.min(65535, Math.max(0, Math.round(intensity)));
  }
  
  return encode16BitGrayscalePNG(width, height, raw16);
}