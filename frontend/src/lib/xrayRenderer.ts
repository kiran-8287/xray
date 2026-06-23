import type { SceneObject } from "../types/customization";
import { combinePixels, to16Bit, to8Bit } from "./xrayPhysics";

export const imgCache = new Map<string, HTMLImageElement>();

export function getLoadedImage(filepath: string, onLoad: () => void): HTMLImageElement | null {
  const url = `http://localhost:8080/data/library_images/${filepath}`;
  if (imgCache.has(url)) {
    const cached = imgCache.get(url)!;
    if (cached.complete && cached.naturalWidth > 0) return cached;
    return null;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  img.onload = () => {
    onLoad();
  };
  img.onerror = () => {
    imgCache.delete(url);
  };
  imgCache.set(url, img);
  return null;
}

/**
 * Renders an X-ray composite using per-pixel direct multiplication.
 * Formula: result = (result * srcPixel) / 65535 for each overlapping pixel.
 * This preserves full precision — no information is lost.
 */
export function drawXRayComposite(
  canvas: HTMLCanvasElement,
  objects: SceneObject[],
  onImagesLoaded: () => void
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  // Clear to white (65535 = fully transparent in X-ray)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const sorted = [...objects].sort((a, b) => a.layer - b.layer);
  const renderList: { obj: SceneObject; img: HTMLImageElement }[] = [];
  let allLoaded = true;

  for (const obj of sorted) {
    if (!obj.filepath) continue;
    const img = getLoadedImage(obj.filepath, onImagesLoaded);
    if (img) {
      renderList.push({ obj, img });
    } else {
      allLoaded = false;
    }
  }

  if (renderList.length === 0) return;

  // Create offscreen canvas for individual layers
  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = width;
  layerCanvas.height = height;
  const layerCtx = layerCanvas.getContext("2d");
  if (!layerCtx) return;

  // Result buffer: 16-bit values (0-65535), initialized to white (transparent)
  const resultBuffer = new Uint16Array(width * height);
  resultBuffer.fill(65535);

  for (const { obj, img } of renderList) {
    // Clear offscreen canvas
    layerCtx.clearRect(0, 0, width, height);

    // Use original image dimensions
    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;

    // Draw element relative to its transform
    layerCtx.save();
    layerCtx.translate(obj.transform.x, obj.transform.y);
    layerCtx.rotate((obj.transform.rotation * Math.PI) / 180);
    layerCtx.drawImage(
      img,
      -imgWidth / 2,
      -imgHeight / 2,
      imgWidth,
      imgHeight
    );
    layerCtx.restore();

    // Get layer pixel data
    const imgData = layerCtx.getImageData(0, 0, width, height);
    const pixels = imgData.data;

    // Combine using direct multiplication: result = (result * srcPixel) / 65535
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const alpha = pixels[i + 3];

      // Skip fully transparent pixels
      if (alpha === 0) continue;

      // Skip near-white background pixels
      const whiteThreshold = 245;
      if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) continue;

      const idx = i / 4;

      // Convert 8-bit grayscale to 16-bit (use red channel since images are grayscale)
      const srcPixel = to16Bit(r);

      // Apply per-pixel combination: result = (result * srcPixel) / 65535
      resultBuffer[idx] = combinePixels(resultBuffer[idx], srcPixel);
    }
  }

  // Convert 16-bit buffer back to 8-bit for display
  const finalImgData = ctx.createImageData(width, height);
  const data = finalImgData.data;

  for (let i = 0; i < resultBuffer.length; i++) {
    const value16 = resultBuffer[i];
    const value8 = to8Bit(value16);

    const idx = i * 4;
    data[idx] = value8;     // Red
    data[idx + 1] = value8; // Green
    data[idx + 2] = value8; // Blue
    data[idx + 3] = 255;    // Alpha
  }

  ctx.putImageData(finalImgData, 0, 0);
}

export interface ObjectPixelStats {
  originalMean: number;
  synthesizedMean: number;
  min: number;
  max: number;
}

/**
 * Compute per-object pixel statistics from the rendered composite.
 * For each object, finds all pixels belonging to it and reads the
 * synthesized values at those pixels.
 */
export function computeObjectStats(
  objects: SceneObject[],
  synthesizedImageData: ImageData
): Map<string, ObjectPixelStats> {
  const stats = new Map<string, ObjectPixelStats>();
  const sorted = [...objects].sort((a, b) => a.layer - b.layer);
  const width = synthesizedImageData.width;
  const height = synthesizedImageData.height;
  const synthesizedPixels = synthesizedImageData.data;

  // Create a temporary canvas to render each object's alpha mask
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return stats;

  for (const obj of sorted) {
    if (!obj.filepath) continue;

    // Load the image for this object
    const url = `http://localhost:8080/data/library_images/${obj.filepath}`;
    const img = imgCache.get(url);
    if (!img || !img.complete || img.naturalWidth === 0) continue;

    // Render just this object to get its alpha mask
    tempCtx.clearRect(0, 0, width, height);
    tempCtx.save();
    tempCtx.translate(obj.transform.x, obj.transform.y);
    tempCtx.rotate((obj.transform.rotation * Math.PI) / 180);
    tempCtx.drawImage(
      img,
      -obj.transform.width / 2,
      -obj.transform.height / 2,
      obj.transform.width,
      obj.transform.height
    );
    tempCtx.restore();

    const objImageData = tempCtx.getImageData(0, 0, width, height);
    const objPixels = objImageData.data;

    // Collect synthesized values at pixels belonging to this object
    const synthesizedValues: number[] = [];
    const originalValues: number[] = [];

    for (let i = 0; i < objPixels.length; i += 4) {
      const alpha = objPixels[i + 3];
      const r = objPixels[i];

      // Skip transparent or near-white background pixels
      if (alpha === 0) continue;
      if (r >= 245) continue;

      const idx = i / 4;
      const synValue = synthesizedPixels[i]; // 8-bit grayscale from synthesized image
      const origValue = to16Bit(r); // 8-bit to 16-bit original

      synthesizedValues.push(synValue);
      originalValues.push(origValue);
    }

    if (synthesizedValues.length === 0) continue;

    // Compute statistics
    const origSum = originalValues.reduce((a, b) => a + b, 0);
    const synSum = synthesizedValues.reduce((a, b) => a + b, 0);

    stats.set(obj.id, {
      originalMean: Math.round(origSum / originalValues.length),
      synthesizedMean: Math.round(synSum / synthesizedValues.length),
      min: Math.min(...synthesizedValues),
      max: Math.max(...synthesizedValues),
    });
  }

  return stats;
}
