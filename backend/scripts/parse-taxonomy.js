
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('📚 Parsing taxonomy file...');
  
  const filePath = path.join(__dirname, '../../list.txt');
  const content = await fs.readFile(filePath, 'utf8');
  
  const taxonomy = [];
  
  let currentCategory = null;
  let currentSubcategory = null;
  
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line || line.startsWith('═══') || line.startsWith('───')) {
      continue;
    }
    
    const categoryMatch = line.match(/CATEGORY \d+: ([A-Z\s&/]+)/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
      taxonomy.push({
        name: currentCategory,
        slug: currentCategory.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        subcategories: []
      });
      currentSubcategory = null;
      continue;
    }
    
    const subcategoryMatch = line.match(/SUBCATEGORY \d+\.\d+ — (.+)/);
    if (subcategoryMatch && currentCategory) {
      currentSubcategory = subcategoryMatch[1].trim();
      const category = taxonomy.find(c => c.name === currentCategory);
      if (category) {
        category.subcategories.push({
          name: currentSubcategory,
          slug: currentSubcategory.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          items: []
        });
      }
      continue;
    }
    
    const itemMatch = line.match(/^\d+\.\s+([^\[]+?)(?:\s+\[(.+)\])?$/);
    if (itemMatch && currentCategory && currentSubcategory) {
      const itemName = itemMatch[1].trim();
      const description = itemMatch[2]?.trim() || '';
      
      const category = taxonomy.find(c => c.name === currentCategory);
      const subcategory = category?.subcategories.find(s => s.name === currentSubcategory);
      
      if (subcategory && itemName) {
        let categorySlug = category.slug;
        if (categorySlug.includes('bag')) categorySlug = 'bags';
        else if (categorySlug.includes('tray')) categorySlug = 'trays';
        else if (categorySlug.includes('cloth')) categorySlug = 'clothes';
        else if (categorySlug.includes('electronic')) categorySlug = 'electronics';
        else if (categorySlug.includes('food')) categorySlug = 'food';
        else if (categorySlug.includes('threat') || categorySlug.includes('prohibited')) categorySlug = 'threats';
        
        const itemSlug = itemName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const subcatSlug = subcategory.slug;
        
        subcategory.items.push({
          name: itemName,
          description: description,
          filename: `${categorySlug}_${subcatSlug}_${itemSlug}.svg`,
          category: categorySlug,
          subcategory: subcategory.slug,
          displayCategory: category.name,
          displaySubcategory: subcategory.name
        });
      }
      continue;
    }
  }
  
  const outputPath = path.join(__dirname, '../../taxonomy.json');
  await fs.writeFile(outputPath, JSON.stringify(taxonomy, null, 2));
  console.log(`✅ Parsed taxonomy saved to ${outputPath}`);
  
  let totalItems = 0;
  for (const category of taxonomy) {
    for (const subcategory of category.subcategories) {
      totalItems += subcategory.items.length;
    }
  }
  
  console.log(`📊 Stats:`);
  console.log(`   - Categories: ${taxonomy.length}`);
  console.log(`   - Subcategories: ${taxonomy.reduce((sum, c) => sum + c.subcategories.length, 0)}`);
  console.log(`   - Total items: ${totalItems}`);
  
  return taxonomy;
}

main().catch(err => {
  console.error('❌ Error parsing taxonomy:', err);
  process.exit(1);
});

