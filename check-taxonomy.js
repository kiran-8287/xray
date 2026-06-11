
import fs from 'fs';
import path from 'path';

const taxonomyPath = path.join(process.cwd(), 'taxonomy.json');
const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));

console.log('All categories and subcategories:');
taxonomy.forEach(cat => {
  console.log(`- Category: ${cat.name} (slug: "${cat.slug}")`);
  cat.subcategories.forEach(subcat => {
    console.log(`  - Subcategory: ${subcat.name} (slug: "${subcat.slug}")`);
  });
});
