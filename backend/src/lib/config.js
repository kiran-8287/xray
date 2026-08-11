/**
 * Configuration module for the X-Ray backend.
 * 
 * All hard-coded paths and environment-dependent settings are centralized here.
 * Override via environment variables or .env file.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ---- Environment variable loading (lightweight, no dotenv dependency) ----
function loadEnv() {
  const envFile = path.resolve(PROJECT_ROOT, '.env');
  try {
    const content = fs.readFileSync(envFile, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      // Only set if not already set by the environment
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file is optional
  }
}
loadEnv();

// ---- Paths ----
// Use environment variables with sensible defaults
// For production, set these to actual drive paths
const config = {
  // Data directories
  libraryImagesRoot: process.env.LIBRARY_IMAGES_PATH || path.resolve(PROJECT_ROOT, 'data', 'library_images'),
  collageImagesRoot: process.env.COLLAGE_IMAGES_PATH || path.resolve(PROJECT_ROOT, 'data', 'collage_images'),
  pixelDataRoot: process.env.PIXEL_DATA_PATH || path.resolve(PROJECT_ROOT, 'data', 'pixel_data'),
  dataDir: process.env.DATA_DIR || path.resolve(PROJECT_ROOT, 'data', 'storage'),
  savedLayoutsDir: process.env.SAVED_LAYOUTS_PATH || path.resolve(PROJECT_ROOT, 'data', 'storage'),
  exportsRoot: process.env.EXPORTS_PATH || path.resolve(PROJECT_ROOT, 'data', 'exports'),
  // Default destination for Load-page saves. High- and low-resolution images are
  // written side-by-side into this single folder (no high/ low/ subfolders).
  loadLayoutsDir: process.env.LOAD_LAYOUTS_PATH || path.resolve(PROJECT_ROOT, 'data', 'load_layouts'),
  tempDir: process.env.TEMP_PATH || path.resolve(PROJECT_ROOT, 'data', 'temp'),

  // Server
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Auth
  apiKey: process.env.API_KEY || null,

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',

  // Upload limits
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600', 10), // 100MB
  maxFilesPerUpload: parseInt(process.env.MAX_FILES_PER_UPLOAD || '5000', 10),
  uploadTimeoutMs: parseInt(process.env.UPLOAD_TIMEOUT_MS || '1800000', 10), // 30 min

  // Derived paths
  get collageHighRoot() {
    return path.join(this.collageImagesRoot, 'high');
  },
  get collageLowRoot() {
    return path.join(this.collageImagesRoot, 'low');
  },
  get pixelDataHighRoot() {
    return path.join(this.pixelDataRoot, 'highenergy');
  },
  get pixelDataLowRoot() {
    return path.join(this.pixelDataRoot, 'lowenergy');
  },
  get exportsHighRoot() {
    return path.join(this.exportsRoot, 'high');
  },
  get exportsLowRoot() {
    return path.join(this.exportsRoot, 'low');
  },
  get exportsAnnotationsRoot() {
    return path.join(this.exportsRoot, 'annotations');
  },
};

export default config;