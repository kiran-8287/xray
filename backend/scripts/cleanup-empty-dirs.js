
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function removeEmptyDirs(dir) {
  // First recursively check subdirs
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeEmptyDirs(fullPath);
    }
  }
  
  // Check if current dir is empty now
  const remainingEntries = await fs.readdir(dir);
  if (remainingEntries.length === 0) {
    await fs.rmdir(dir);
    console.log(`🗑️  Removed empty directory: ${dir}`);
  }
}

async function main() {
  console.log('🧹 Cleaning up empty directories...');
  const libraryImagesRoot = path.resolve(__dirname, '../data/library_images');
  await removeEmptyDirs(libraryImagesRoot);
  console.log('✅ Done!');
}

main().catch(err => {
  console.error('❌ Error cleaning up:', err);
  process.exit(1);
});
