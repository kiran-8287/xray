import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const libraryImagesRoot = path.join(__dirname, '../data/library_images');

async function renameImages() {
  console.log('🚀 Starting image renaming...\n');
  
  // Get all category directories
  const categoryDirs = await fs.readdir(libraryImagesRoot, { withFileTypes: true });
  const categoryIds = {};
  
  for (const dirent of categoryDirs) {
    if (!dirent.isDirectory()) continue;
    const category = dirent.name;
    console.log(`\n📁 Processing category: ${category}`);
    categoryIds[category] = 1;
    
    // Walk through all subdirectories
    const allFiles = [];
    await walkDirectory(path.join(libraryImagesRoot, category), allFiles);
    
    for (const filePath of allFiles) {
      const ext = path.extname(filePath);
      const newFileName = `${category}${categoryIds[category]}${ext}`;
      const newFilePath = path.join(path.dirname(filePath), newFileName);
      
      if (filePath === newFilePath) {
        console.log(`   Skipping already renamed: ${path.basename(filePath)}`);
      } else {
        await fs.rename(filePath, newFilePath);
        console.log(`   ✅ Renamed: ${path.basename(filePath)} → ${newFileName}`);
      }
      categoryIds[category]++;
    }
  }
  
  console.log('\n✅ All images renamed successfully!');
}

async function walkDirectory(dir, fileList) {
  const files = await fs.readdir(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      await walkDirectory(fullPath, fileList);
    } else if (file.name.match(/\.(svg|png|jpg|jpeg)$/i)) {
      fileList.push(fullPath);
    }
  }
}

renameImages().catch(err => {
  console.error('❌ Error renaming images:', err);
  process.exit(1);
});
