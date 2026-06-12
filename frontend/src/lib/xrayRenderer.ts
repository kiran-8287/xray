import type { SceneObject } from "../types/customization";

const imgCache = new Map<string, HTMLImageElement>();

export function getLoadedImage(filepath: string, onLoad: () => void): HTMLImageElement | null {
  const url = `http://localhost:8080/data/library_images/${filepath}`;
  if (imgCache.has(url)) {
    const cached = imgCache.get(url)!;
    if (cached.complete && cached.naturalWidth > 0) return cached;
    // Still loading - attach another onLoad if not already queued
    return null;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  img.onload = () => {
    onLoad();
  };
  img.onerror = () => {
    // Remove from cache on error so it can be retried
    imgCache.delete(url);
  };
  imgCache.set(url, img);
  return null;
}

export function drawXRayComposite(
  canvas: HTMLCanvasElement,
  objects: SceneObject[],
  onImagesLoaded: () => void
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  // Clear onscreen canvas to empty white background (minimum absorption/empty space)
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

  // Always render what we have; callback will trigger re-render when more images finish
  if (renderList.length === 0) return;

  // Create an offscreen canvas to render individual layers
  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = width;
  layerCanvas.height = height;
  const layerCtx = layerCanvas.getContext("2d");
  if (!layerCtx) return;

  // Initialize density summation buffer (all zeroes)
  const densityBuffer = new Float32Array(width * height);

  for (const { obj, img } of renderList) {
    // Clear offscreen canvas
    layerCtx.clearRect(0, 0, width, height);

    // Draw element relative to its transform
    layerCtx.save();
    layerCtx.translate(obj.transform.x, obj.transform.y);
    layerCtx.rotate((obj.transform.rotation * Math.PI) / 180);
    layerCtx.drawImage(
      img,
      -obj.transform.width / 2,
      -obj.transform.height / 2,
      obj.transform.width,
      obj.transform.height
    );
    layerCtx.restore();

    // Get layer alpha channel to extract thickness map
    const imgData = layerCtx.getImageData(0, 0, width, height);
    const pixels = imgData.data;

    // Attenuation coefficient calculation from pixel value (0 - 65535)
    const pixelVal = obj.originalPixelValue;
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

  // Map densities back to intensities and convert to grayscale pixels
  const finalImgData = ctx.createImageData(width, height);
  const data = finalImgData.data;

  for (let i = 0; i < densityBuffer.length; i++) {
    const density = densityBuffer[i];
    const intensity = 65535 * Math.exp(-density);
    const g = Math.round((intensity / 65535) * 255);

    const idx = i * 4;
    data[idx] = g;     // Red
    data[idx + 1] = g; // Green
    data[idx + 2] = g; // Blue
    data[idx + 3] = 255; // Alpha
  }

  ctx.putImageData(finalImgData, 0, 0);
}
