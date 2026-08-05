import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const BACKUP_FILE = path.join(DATA_DIR, 'items_backup.json');

const AVAILABLE_DATASETS = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];

async function backupCurrentItems() {
  try {
    await fs.access(ITEMS_FILE);
    await fs.copyFile(ITEMS_FILE, BACKUP_FILE);
    console.log('✓ Backed up current items.json to items_backup.json');
  } catch {
    console.log('ℹ No existing items.json found to backup');
  }
}

async function restoreBackup() {
  try {
    await fs.access(BACKUP_FILE);
    await fs.copyFile(BACKUP_FILE, ITEMS_FILE);
    await fs.unlink(BACKUP_FILE);
    console.log('✓ Restored original items.json from backup');
  } catch {
    console.log('ℹ No backup found to restore');
  }
}

async function switchDataset(count) {
  const sourceFile = path.join(DATA_DIR, `items_${count}.json`);
  
  try {
    await fs.access(sourceFile);
    await backupCurrentItems();
    await fs.copyFile(sourceFile, ITEMS_FILE);
    console.log(`✓ Switched to ${count} items dataset`);
    console.log(`  Source: items_${count}.json`);
    console.log(`  Target: items.json`);
  } catch {
    console.error(`✗ Error: items_${count}.json not found!`);
    console.log(`\nAvailable datasets: ${AVAILABLE_DATASETS.join(', ')}`);
    process.exit(1);
  }
}

async function listDatasets() {
  console.log('\nAvailable test datasets:');
  for (const count of AVAILABLE_DATASETS) {
    const filePath = path.join(DATA_DIR, `items_${count}.json`);
    try {
      const stats = await fs.stat(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`  ${count.toString().padStart(5)} items - items_${count}.json (${sizeMB} MB)`);
    } catch {
      console.log(`  ${count.toString().padStart(5)} items - items_${count}.json (NOT FOUND)`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log('Test Data Manager\n');

  switch (command) {
    case 'restore':
      await restoreBackup();
      break;
    
    case 'list':
      await listDatasets();
      break;
    
    case undefined:
    case 'help':
      console.log('Usage: node switchTestData.js <command> [count]');
      console.log('\nCommands:');
      console.log('  <count>     Switch to specific dataset (e.g., 1000, 5000, 10000)');
      console.log('  restore     Restore original items.json from backup');
      console.log('  list        List all available test datasets');
      console.log('  help        Show this help message');
      console.log('\nExamples:');
      console.log('  node switchTestData.js 1000    # Switch to 1000 items');
      console.log('  node switchTestData.js 5000    # Switch to 5000 items');
      console.log('  node switchTestData.js restore # Restore original data');
      break;
    
    default:
      const count = parseInt(command);
      if (isNaN(count) || !AVAILABLE_DATASETS.includes(count)) {
        console.error(`✗ Invalid count: ${command}`);
        console.log(`\nValid counts: ${AVAILABLE_DATASETS.join(', ')}`);
        process.exit(1);
      }
      await switchDataset(count);
  }

  console.log('\n⚠️  Remember to restart the backend server after switching datasets!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});