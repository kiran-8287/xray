#!/usr/bin/env node

/**
 * Generate test files for upload page testing
 * Replicates existing .dump.pgm and .tip files with unique IDs
 * 
 * Usage:
 *   node scripts/generate-test-files.js
 *   node scripts/generate-test-files.js --count 5000
 *   node scripts/generate-test-files.js --count 10000 --source "dump and tip" --output "test-upload-batch"
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const targetCount = parseInt(args.find(arg => arg.startsWith('--count'))?.split('=')[1] || '1000');
const sourceDir = args.find(arg => arg.startsWith('--source'))?.split('=')[1] || path.join(projectRoot, 'dump and tip');
const outputDir = args.find(arg => arg.startsWith('--output'))?.split('=')[1] || path.join(projectRoot, 'test-upload-batch');

/**
 * Recursively scan directory for .dump.pgm and .tip files
 */
async function scanSourceFiles(dir) {
  const files = { dump: [], tip: [] };
  
  async function scan(currentDir) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.name.endsWith('.dump.pgm')) {
          files.dump.push({
            path: fullPath,
            name: entry.name,
            category: path.basename(currentDir)
          });
        } else if (entry.name.endsWith('.tip')) {
          files.tip.push({
            path: fullPath,
            name: entry.name,
            category: path.basename(currentDir)
          });
        }
      }
    } catch (err) {
      console.warn(`Warning: Could not scan ${currentDir}:`, err.message);
    }
  }
  
  await scan(dir);
  return files;
}

/**
 * Generate unique filename from original
 * P01X010-2024101200923.dump.pgm -> P01X010-2024101200923_copy0001.dump.pgm
 * P01X010-2024101200923.tip -> P01X010-2024101200923_copy0001.tip
 */
function generateFilename(originalName, copyNumber) {
  // Handle multi-part extensions like .dump.pgm
  let baseName, extension;
  
  if (originalName.endsWith('.dump.pgm')) {
    baseName = originalName.slice(0, -'.dump.pgm'.length);
    extension = '.dump.pgm';
  } else if (originalName.endsWith('.tip')) {
    baseName = originalName.slice(0, -'.tip'.length);
    extension = '.tip';
  } else {
    // Fallback for other extensions
    const lastDotIndex = originalName.lastIndexOf('.');
    baseName = originalName.substring(0, lastDotIndex);
    extension = originalName.substring(lastDotIndex);
  }
  
  const copySuffix = `_copy${String(copyNumber).padStart(4, '0')}`;
  return `${baseName}${copySuffix}${extension}`;
}

/**
 * Main generation function
 */
async function generateTestFiles() {
  console.log('🔍 Scanning source files...');
  console.log(`   Source: ${sourceDir}`);
  
  const sourceFiles = await scanSourceFiles(sourceDir);
  const totalSource = sourceFiles.dump.length + sourceFiles.tip.length;
  
  if (totalSource === 0) {
    console.error('❌ No .dump.pgm or .tip files found in source directory!');
    process.exit(1);
  }
  
  console.log(`   Found: ${sourceFiles.dump.length} .dump.pgm files, ${sourceFiles.tip.length} .tip files`);
  
  // Calculate distribution
  const dumpCount = Math.floor(targetCount * (sourceFiles.dump.length / totalSource));
  const tipCount = targetCount - dumpCount;
  
  console.log(`\n📊 Target distribution:`);
  console.log(`   .dump.pgm files: ${dumpCount}`);
  console.log(`   .tip files: ${tipCount}`);
  console.log(`   Total: ${targetCount}`);
  
  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });
  console.log(`\n📁 Output directory: ${outputDir}`);
  
  // Generate files
  let generated = 0;
  let errors = 0;
  const startTime = Date.now();
  
  // Generate dump files
  if (sourceFiles.dump.length > 0 && dumpCount > 0) {
    const copiesPerFile = Math.ceil(dumpCount / sourceFiles.dump.length);
    console.log(`\n⚙️  Generating .dump.pgm files (${copiesPerFile} copies per source)...`);
    
    for (const source of sourceFiles.dump) {
      const categoryDir = path.join(outputDir, source.category);
      await fs.mkdir(categoryDir, { recursive: true });
      
      for (let i = 1; i <= copiesPerFile && generated < targetCount; i++) {
        try {
          const newFilename = generateFilename(source.name, i);
          const destPath = path.join(categoryDir, newFilename);
          await fs.copyFile(source.path, destPath);
          generated++;
          
          if (generated % 100 === 0) {
            console.log(`   Progress: ${generated}/${targetCount} files...`);
          }
        } catch (err) {
          errors++;
          if (errors <= 5) {
            console.error(`   ⚠️  Error copying ${source.name}:`, err.message);
          }
        }
      }
    }
  }
  
  // Generate tip files
  if (sourceFiles.tip.length > 0 && tipCount > 0) {
    const copiesPerFile = Math.ceil(tipCount / sourceFiles.tip.length);
    console.log(`\n⚙️  Generating .tip files (${copiesPerFile} copies per source)...`);
    
    for (const source of sourceFiles.tip) {
      const categoryDir = path.join(outputDir, source.category);
      await fs.mkdir(categoryDir, { recursive: true });
      
      for (let i = 1; i <= copiesPerFile && generated < targetCount; i++) {
        try {
          const newFilename = generateFilename(source.name, i);
          const destPath = path.join(categoryDir, newFilename);
          await fs.copyFile(source.path, destPath);
          generated++;
          
          if (generated % 100 === 0) {
            console.log(`   Progress: ${generated}/${targetCount} files...`);
          }
        } catch (err) {
          errors++;
          if (errors <= 5) {
            console.error(`   ⚠️  Error copying ${source.name}:`, err.message);
          }
        }
      }
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  
  // Calculate total size
  let totalSize = 0;
  async function calculateSize(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await calculateSize(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      }
    }
  }
  await calculateSize(outputDir);
  const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
  
  // Summary
  console.log('\n✅ Generation complete!');
  console.log('━'.repeat(50));
  console.log(`   Files generated: ${generated}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Time elapsed: ${elapsed}s`);
  console.log(`   Total size: ${sizeMB} MB`);
  console.log(`   Output: ${outputDir}`);
  console.log('━'.repeat(50));
  
  // List generated structure
  console.log('\n📂 Generated structure:');
  async function listStructure(dir, indent = 0) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile());
    const dirs = entries.filter(e => e.isDirectory());
    
    if (files.length > 0) {
      console.log(`${'  '.repeat(indent)}├── ${files.length} files`);
    }
    
    for (const dirEntry of dirs) {
      console.log(`${'  '.repeat(indent)}├── ${dirEntry.name}/`);
      await listStructure(path.join(dir, dirEntry.name), indent + 1);
    }
  }
  await listStructure(outputDir);
  
  console.log('\n💡 Next steps:');
  console.log('   1. Go to the upload page');
  console.log('   2. Drag and drop the "test-upload-batch" folder');
  console.log(`   3. Test uploading ${generated} files at once`);
  console.log('   4. Monitor performance and UI responsiveness');
}

// Run
generateTestFiles().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});