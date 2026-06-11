import { createCanvas, loadImage } from 'canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libraryImagesRoot = path.resolve(__dirname, "../../data/library_images");

async function findImageFile(filename, rootDir = libraryImagesRoot) {
  // First, check the root directory directly
  const directPath = path.join(rootDir, filename);
  try {
    await fs.access(directPath);
    return directPath;
  } catch {
    // Not in root, search subdirectories
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      
      if (entry.isDirectory()) {
        const found = await findImageFile(filename, fullPath);
        if (found) return found;
      } else if (entry.name === filename) {
        return fullPath;
      }
    }
  }
  
  return null;
}

/**
 * Async helper that loads images and performs the per‑pixel attenuation calculation.
 * Returns a PNG buffer of the composited scene.
 */
export async function renderSceneAsync(objects, width = 800, height = 600) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // White background (minimal absorption)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const sorted = [...objects].sort((a, b) => a.layer - b.layer);
  const densityBuffer = new Float32Array(width * height);

  for (const obj of sorted) {
    if (!obj.filepath) continue;
    const imgPath = await findImageFile(obj.filepath);
    if (!imgPath) {
      console.log(`⚠️  Could not find image file: ${obj.filepath}`);
      continue;
    }
    
    let img;
    if (obj.filepath.endsWith('.svg')) {
      let svgContent = await fs.readFile(imgPath, 'utf8');
      const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
      let svgW = "512";
      let svgH = "512";
      if (viewBoxMatch) {
        const parts = viewBoxMatch[1].trim().split(/\s+/).map(Number);
        if (parts.length === 4) {
          svgW = parts[2].toString();
          svgH = parts[3].toString();
        }
      }

      if (!svgContent.includes('width=')) {
        svgContent = svgContent.replace('<svg', `<svg width="${svgW}"`);
      } else {
        svgContent = svgContent.replace(/width="[^"]+"/, `width="${svgW}"`);
      }
      if (!svgContent.includes('height=')) {
        svgContent = svgContent.replace('<svg', `<svg height="${svgH}"`);
      } else {
        svgContent = svgContent.replace(/height="[^"]+"/, `height="${svgH}"`);
      }

      img = await loadImage(Buffer.from(svgContent));
    } else {
      img = await loadImage(imgPath);
    }
    
    // Offscreen canvas for the object to extract alpha map
    const off = createCanvas(width, height);
    const offCtx = off.getContext('2d');
    offCtx.clearRect(0, 0, width, height);
    
    offCtx.save();
    offCtx.translate(obj.transform.x, obj.transform.y);
    offCtx.rotate((obj.transform.rotation * Math.PI) / 180);
    offCtx.drawImage(
      img,
      -obj.transform.width / 2,
      -obj.transform.height / 2,
      obj.transform.width,
      obj.transform.height
    );
    offCtx.restore();
    
    const imgData = offCtx.getImageData(0, 0, width, height);
    const pixels = imgData.data;
    
    // Attenuation coefficient calculation from pixel value (0 - 65535)
    // Objects from library have pixel_value, SceneObjects in frontend have currentPixelValue / originalPixelValue.
    // Let's support both obj.originalPixelValue and obj.pixel_value.
    const pixelVal = typeof obj.originalPixelValue === 'number' ? obj.originalPixelValue : (typeof obj.pixel_value === 'number' ? obj.pixel_value : 32767);
    const mu = -Math.log(Math.max(1, pixelVal) / 65535);

    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3];
      if (alpha > 0) {
        const idx = i / 4;
        const normalizedThickness = alpha / 255;
        densityBuffer[idx] += mu * normalizedThickness;
      }
    }
  }

  // Convert density buffer to final grayscale image using Beer-Lambert Law
  const finalImg = ctx.createImageData(width, height);
  const data = finalImg.data;
  
  for (let i = 0; i < densityBuffer.length; i++) {
    const density = densityBuffer[i];
    const intensity = 65535 * Math.exp(-density);
    const g = Math.round((intensity / 65535) * 255);
    
    const idx = i * 4;
    data[idx] = g;       // R
    data[idx + 1] = g;   // G
    data[idx + 2] = g;   // B
    data[idx + 3] = 255; // A
  }
  
  ctx.putImageData(finalImg, 0, 0);
  return canvas.toBuffer('image/png');
}
