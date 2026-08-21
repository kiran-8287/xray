import type { SceneObject } from "../types/customization";
import { combinePixels, to16Bit, to8Bit } from "./xrayPhysics";
import { API_BASE_URL } from "../config/api";
import { IMG_CACHE_MAX } from "./constants";
import { debugLog } from "./debugLog";

export const imgCache = new Map<string, HTMLImageElement>();
export const objectPixelBoundsCache = new Map<string, { left: number; top: number; width: number; height: number }>();

export function clearCaches(): void {
  imgCache.clear();
  objectPixelBoundsCache.clear();
}

export function getObjectPixelBounds(objId: string): { left: number; top: number; width: number; height: number } | undefined {
  return objectPixelBoundsCache.get(objId);
}

export function getLoadedImage(filepath: string, onLoad: () => void): HTMLImageElement | null {
  const url = `${API_BASE_URL}/data/library_images/${filepath}`;
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
  if (imgCache.size >= IMG_CACHE_MAX) {
    const firstKey = imgCache.keys().next().value;
    if (firstKey) imgCache.delete(firstKey);
  }
  imgCache.set(url, img);
  return null;
}

/**
 * Renders an X-ray composite using per-pixel direct multiplication.
 * Formula: result = (result * srcPixel) / 65535 for each overlapping pixel.
 * Uses 8-bit canvas rendering for display performance.
 */
export async function drawXRayComposite(
  canvas: HTMLCanvasElement,
  objects: SceneObject[],
  onImagesLoaded: () => void
) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

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

  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = width;
  layerCanvas.height = height;
  const layerCtx = layerCanvas.getContext("2d", { willReadFrequently: true });
  if (!layerCtx) return;

  const resultBuffer = new Uint16Array(width * height);
  resultBuffer.fill(65535);

  for (const { obj, img } of renderList) {
    layerCtx.clearRect(0, 0, width, height);

    const imgWidth = obj.transform.width;
    const imgHeight = obj.transform.height;

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

    const imgData = layerCtx.getImageData(0, 0, width, height);
    const pixels = imgData.data;

    let minX = width, minY = height, maxX = 0, maxY = 0;
    let hasNonWhite = false;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const alpha = pixels[i + 3];

      if (alpha === 0) continue;
      if (r >= 245 && g >= 245 && b >= 245) continue;

      hasNonWhite = true;
      const idx = i / 4;
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    if (hasNonWhite) {
      objectPixelBoundsCache.set(obj.id, {
        left: minX,
        top: minY,
        width: Math.max(1, maxX - minX + 1),
        height: Math.max(1, maxY - minY + 1),
      });
    } else {
      objectPixelBoundsCache.delete(obj.id);
    }

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const alpha = pixels[i + 3];

      if (alpha === 0) continue;

      const whiteThreshold = 245;
      if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) continue;

      const idx = i / 4;
      const srcPixel = to16Bit(r);
      resultBuffer[idx] = combinePixels(resultBuffer[idx], srcPixel);
    }
  }

  const finalImgData = ctx.createImageData(width, height);
  const data = finalImgData.data;

  for (let i = 0; i < resultBuffer.length; i++) {
    const value16 = resultBuffer[i];
    const value8 = to8Bit(value16);
    const idx = i * 4;
    data[idx] = value8;
    data[idx + 1] = value8;
    data[idx + 2] = value8;
    data[idx + 3] = 255;
  }

  ctx.putImageData(finalImgData, 0, 0);
}

export interface ObjectPixelStats {
  originalMean: number;
  synthesizedMean: number;
  min: number;
  max: number;
}

export function computeObjectStats(
  objects: SceneObject[],
  synthesizedImageData: ImageData
): Map<string, ObjectPixelStats> {
  const stats = new Map<string, ObjectPixelStats>();
  const sorted = [...objects].sort((a, b) => a.layer - b.layer);
  const width = synthesizedImageData.width;
  const height = synthesizedImageData.height;
  const synthesizedPixels = synthesizedImageData.data;

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
  if (!tempCtx) return stats;

  for (const obj of sorted) {
    if (!obj.filepath) continue;

    const url = `${API_BASE_URL}/data/library_images/${obj.filepath}`;
    const img = imgCache.get(url);
    if (!img || !img.complete || img.naturalWidth === 0) continue;

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

    const synthesizedValues: number[] = [];
    const originalValues: number[] = [];

    for (let i = 0; i < objPixels.length; i += 4) {
      const alpha = objPixels[i + 3];
      const r = objPixels[i];

      if (alpha === 0) continue;
      if (r >= 245) continue;

      const idx = i / 4;
      const synValue = synthesizedPixels[i];
      const origValue = to16Bit(r);

      synthesizedValues.push(synValue);
      originalValues.push(origValue);
    }

    if (synthesizedValues.length === 0) continue;

    let origSum = 0;
    let synSum = 0;
    let min = Infinity;
    let max = -Infinity;
    
    for (let i = 0; i < synthesizedValues.length; i++) {
      origSum += originalValues[i];
      synSum += synthesizedValues[i];
      if (synthesizedValues[i] < min) min = synthesizedValues[i];
      if (synthesizedValues[i] > max) max = synthesizedValues[i];
    }

    stats.set(obj.id, {
      originalMean: Math.round(origSum / originalValues.length),
      synthesizedMean: Math.round(synSum / synthesizedValues.length),
      min,
      max,
    });
  }

  return stats;
}