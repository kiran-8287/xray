import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const storageDir = path.join(root, 'backend', 'data', 'storage');

// 1. Inspect a stored saved layout's structure
const layouts = JSON.parse(fs.readFileSync(path.join(storageDir, 'savedLayouts_1.json'), 'utf8'));
console.log('=== STORED SAVED LAYOUT (first) ===');
const l = layouts[0];
console.log('keys:', Object.keys(l).join(', '));
console.log('layout_json keys:', l.layout_json ? Object.keys(l.layout_json).join(', ') : 'NONE');
console.log('objects.bag keys:', l.layout_json && l.layout_json.objects && l.layout_json.objects.bag ? Object.keys(l.layout_json.objects.bag).join(', ') : 'NONE');
console.log('sample bag obj:', JSON.stringify(l.layout_json.objects.bag).slice(0, 600));

// 2. Inspect a sample item in each category partition
console.log('\n=== ITEM STRUCTURE ===');
for (const n of ['bags_1.json', 'threats_1.json', 'non_threats_1.json']) {
  const items = JSON.parse(fs.readFileSync(path.join(storageDir, n), 'utf8'));
  console.log('\n', n, '(' + items.length + '):');
  if (items[0]) {
    console.log('  keys:', Object.keys(items[0]).join(', '));
    console.log('  sample:', JSON.stringify({
      id: items[0].id, category: items[0].category, subcategory: items[0].subcategory,
      filepath: items[0].filepath, pixelDataFilename: items[0].pixelDataFilename,
      width: items[0].width, height: items[0].height,
      threat_type: items[0].threat_type, severity: items[0].severity,
      subcategory_slug: items[0].subcategory_slug,
      has_vr: !!items[0].valid_region_points
    }, null, 2));
  }
}

// 3. What does the annotation record preserve? Link a stored layout to its exported annotation.
const annDir = path.join(root, 'backend', 'data', 'exports', 'annotations');
let annCount = 0;
const annFiles = fs.readdirSync(annDir).filter(f => f.endsWith('.json'));
console.log('\n=== EXPORTED ANNOTATION STRUCTURE ===');
for (const f of annFiles) {
  const arr = JSON.parse(fs.readFileSync(path.join(annDir, f), 'utf8'));
  annCount += arr.length;
  const a = arr[0];
  console.log(' file:', f, '| layouts in file:', arr.length);
  console.log(' annotation keys:', Object.keys(a).join(', '));
  console.log(' objects.bag keys:', a.objects && a.objects.bag ? Object.keys(a.objects.bag).join(', ') : 'NONE');
  break;
}
console.log('Total exported annotation layouts:', annCount);