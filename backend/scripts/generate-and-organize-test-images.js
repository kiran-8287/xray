import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🚀 Starting combined test image generation and organization...\n');

  // Step 1: Load taxonomy
  const taxonomyPath = path.join(__dirname, '../../taxonomy.json');
  const taxonomyData = await fs.readFile(taxonomyPath, 'utf8');
  const taxonomy = JSON.parse(taxonomyData);

  // Step 2: Generate test images
  console.log('🎨 Generating test images from taxonomy...');
  const testImagesDir = path.join(__dirname, '../../test_images');
  await fs.mkdir(testImagesDir, { recursive: true });

  let generated = 0;

  for (const category of taxonomy) {
    for (const subcategory of category.subcategories) {
      for (const item of subcategory.items) {
        // Generate a simple SVG
        const colors = {
          bags: ['#4a90d9', '#2563eb', '#1d4ed8', '#3b82f6'],
          threats: ['#dc2626', '#991b1b', '#7f1d1d', '#ef4444'],
          trays: ['#6b7280', '#4b5563', '#374151', '#9ca3af'],
          clothes: ['#22c55e', '#16a34a', '#15803d', '#4ade80'],
          electronics: ['#8b5cf6', '#7c3aed', '#6d28d9', '#a78bfa'],
          food: ['#f97316', '#ea580c', '#c2410c', '#fb923c'],
          misc: ['#64748b', '#475569', '#334155', '#94a3b8']
        };

        const colorPalette = colors[item.category] || colors.misc;
        const fillColor = colorPalette[Math.floor(Math.random() * colorPalette.length)];
        const pixelValue = Math.floor(30000 + Math.random() * 50000);
        const grayValue = Math.floor((pixelValue / 65535) * 255);

        const svgContent = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="512" height="512" rx="20" ry="20" fill="rgb(${grayValue}, ${grayValue}, ${grayValue})" />
  <text x="256" y="200" text-anchor="middle" fill="white" font-size="28" font-family="Arial, sans-serif" font-weight="bold">
    ${item.name}
  </text>
  <text x="256" y="250" text-anchor="middle" fill="white" font-size="18" font-family="Arial, sans-serif">
    ${category.name}
  </text>
  <text x="256" y="290" text-anchor="middle" fill="white" font-size="14" font-family="Arial, sans-serif">
    ${subcategory.name}
  </text>
  <text x="256" y="330" text-anchor="middle" fill="white" font-size="12" font-family="Arial, sans-serif">
    Pixel Value: ${pixelValue}
  </text>
</svg>`;

        const outputPath = path.join(testImagesDir, item.filename);
        await fs.writeFile(outputPath, svgContent);
        generated++;

        if (generated % 100 === 0) {
          console.log(`  ✨ Generated ${generated} images...`);
        }
      }
    }
  }

  console.log(`✅ Generated ${generated} test images\n`);

  // Step 3: Organize the test images into library structure
  console.log('🔧 Organizing test images into library structure...');
  const libraryImagesRoot = path.resolve(__dirname, '../data/library_images');
  let movedCount = 0;

  for (const category of taxonomy) {
    for (const subcategory of category.subcategories) {
      for (const item of subcategory.items) {
        // Normalize folder names
        const cat = (item.category || 'miscellaneous').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const subcat = (item.subcategory || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-');

        // Create target directory
        const targetDir = path.join(libraryImagesRoot, cat, subcat);
        await fs.mkdir(targetDir, { recursive: true });

        // Copy file to library
        const sourcePath = path.join(testImagesDir, item.filename);
        const targetPath = path.join(targetDir, item.filename);

        try {
          await fs.copyFile(sourcePath, targetPath);
          movedCount++;
          console.log(`✅ Copied: ${item.filename} → ${cat}/${subcat}/`);
        } catch (err) {
          console.log(`❌ Failed to copy ${item.filename}:`, err.message);
        }
      }
    }
  }

  console.log(`\n🎉 All done! Generated ${generated} images and organized ${movedCount} to library.`);
}

main().catch(err => {
  console.error('❌ Error in combined script:', err);
  process.exit(1);
});
