/**
 * Loads an image and returns its natural dimensions
 */
export function loadImageDimensions(filepath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:8080/data/library_images/${filepath}`;
    const img = new Image();
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    
    img.onerror = () => {
      reject(new Error(`Failed to load image: ${filepath}`));
    };
    
    img.src = url;
  });
}

/**
 * Loads multiple images and returns their dimensions
 */
export function loadMultipleImageDimensions(filepaths: string[]): Promise<Map<string, { width: number; height: number }>> {
  return Promise.all(
    filepaths.map(async (filepath) => {
      try {
        const dims = await loadImageDimensions(filepath);
        return { filepath, dims };
      } catch (error) {
        console.error(`Failed to load dimensions for ${filepath}:`, error);
        return { filepath, dims: { width: 0, height: 0 } };
      }
    })
  ).then(results => {
    const map = new Map<string, { width: number; height: number }>();
    results.forEach(({ filepath, dims }) => {
      map.set(filepath, dims);
    });
    return map;
  });
}