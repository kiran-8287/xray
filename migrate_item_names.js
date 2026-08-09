/**
 * Migration script to fix item names in the database.
 * This script updates items that have incorrect names (with file extensions)
 * to use just the item ID as the name.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'backend', 'data', 'storage');
const CATEGORIES = ['bags', 'threats', 'non_threats'];

function deriveItemId(filename) {
    const dotIndex = filename.indexOf('.');
    if (dotIndex === -1) return filename;
    return filename.slice(0, dotIndex);
}

function migrateCategory(category) {
    const filePath = path.join(DATA_DIR, `${category}_1.json`);
    
    if (!fs.existsSync(filePath)) {
        console.log(`Skipping ${category} - file not found`);
        return 0;
    }
    
    console.log(`\nMigrating ${category}...`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let updatedCount = 0;
    
    for (const item of data) {
        // If name is missing or contains file extensions, fix it
        if (!item.name || item.name.includes('.dump') || item.name.includes('.pgm') || item.name.includes('.tip')) {
            const oldName = item.name || '(missing)';
            item.name = deriveItemId(item.id);
            console.log(`  ${item.id}: "${oldName}" -> "${item.name}"`);
            updatedCount++;
        }
    }
    
    if (updatedCount > 0) {
        // Create backup
        fs.copyFileSync(filePath, filePath + '.bak');
        
        // Write updated data
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`  Updated ${updatedCount} items`);
    } else {
        console.log(`  No updates needed`);
    }
    
    return updatedCount;
}

console.log('Starting item name migration...');
console.log('This will fix item names to use just the ID (e.g., "px01x" instead of "px01x.dump.pgm")');

let totalUpdated = 0;
for (const category of CATEGORIES) {
    totalUpdated += migrateCategory(category);
}

console.log(`\n✓ Migration complete. Total items updated: ${totalUpdated}`);
console.log('\nNote: A backup of each file was created with .bak extension');
