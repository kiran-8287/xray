/**
 * importService.js — Portability / "Save Historic Data" import engine.
 *
 * Implements the manager-approved workflow:
 *   1. User uploads (or points at) the original PIXEL DATA folder (.npz)
 *      and the folder containing the ANNOTATIONS (export annotation JSONs,
 *      annotation partition JSONs, or savedLayouts_*.json storage files).
 *   2. We copy pixel data, register library items (SKIPPING duplicates,
 *      never re-ID'ing), auto-generate valid regions for any new bag that
 *      doesn't already have one, and import saved layouts — resolving the
 *      "same SB id from a different system but different content" collision
 *      by adding the differing combination under a fresh unique id.
 *   3. No synthetic images are generated here: the Saved page re-renders any
 *      combination on demand from the (pre-decided) layout_json positions.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import config from './config.js';
import {
  getItems,
  getSavedLayouts,
  updateItem,
  importItemsBatch,
  importSavedLayoutsBatch,
  layoutContentKey,
} from './storage.js';
import { generateValidRegionBatch, BATCH_FILES_PER_PROCESS } from './autoValidRegion.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function titleCase(s) {
  if (!s) return 'General';
  return String(s)
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function readJsonSafely(absPath) {
  const raw = await fs.readFile(absPath, 'utf8');
  return JSON.parse(raw);
}

function isBagCategory(cat) {
  const c = String(cat || '').toLowerCase().trim();
  return c.includes('bag');
}
function isThreatCategory(cat) {
  const c = String(cat || '').toLowerCase().trim();
  return c.includes('threat') || c.includes('electronic') || c === 'electronics';
}
function displayCategory(cat) {
  const c = String(cat || '').toLowerCase().trim();
  // Match non-threat first before 'threat' to prevent 'non-threat' matching 'threat'
  if (/^non[- ]?threat/.test(c)) return 'non-threats';
  if (c.includes('bag')) return 'bags';
  if (c.includes('threat') || c.includes('electronic') || c === 'electronics') return 'threats';
  return 'non-threats';
}

// ---------------------------------------------------------------------------
// JSON type auto-detection
// ---------------------------------------------------------------------------

/**
 * Determine whether a JSON file is an annotation (single/partition), a
 * savedLayouts storage file, or a catalog file (bags/threats/non-threats).
 */
export function detectJsonType(filename, parsed) {
  const n = String(filename).toLowerCase();
  const base = path.basename(n);

  if (/^(bags?)[_-]?\d*\.json$/.test(base)) return { type: 'catalog', category: 'bags' };
  if (/^(threats?)[_-]?\d*\.json$/.test(base)) return { type: 'catalog', category: 'threats' };
  if (/^non[_-]?threats?[_-]?\d*\.json$/.test(base)) return { type: 'catalog', category: 'non-threats' };
  if (/^savedlayouts?[_-]?\d*\.json$/.test(base)) return { type: 'savedLayouts' };
  if (/^annotations?[_-]?\d*\.json$/.test(base)) return { type: 'annotationPartition' };

  // content-based fallback
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    if (first && first.layout_json) return { type: 'savedLayouts' };
    if (first && first.objects && first.layoutId) return { type: 'annotationPartition' };
    if (first && (first.id || first.category)) return { type: 'catalog', category: displayCategory(first.category) };
    return { type: 'unknown' };
  }
  if (parsed && typeof parsed === 'object') {
    if (parsed.layoutId || parsed.layout_json) return { type: 'annotation' };
  }
  return { type: 'unknown' };
}

// ---------------------------------------------------------------------------
// Normalization: annotations / savedLayouts -> layout records
// ---------------------------------------------------------------------------

function layoutFromAnnotation(a) {
  if (!a || !a.objects) return null;
  const objects = a.objects || {};
  const bag = objects.bag || null;
  const threats = Array.isArray(objects.threats) ? objects.threats : [];
  const nonThreats = Array.isArray(objects['non-threats']) ? objects['non-threats'] : [];

  const names = [...threats, ...nonThreats].map((o) => o && o.subcategory).filter(Boolean).map(titleCase);
  const name =
    (a.layoutName && String(a.layoutName).trim().length > 0)
      ? a.layoutName
      : `bag containing ${names.join(', ')}`.replace(/\s*,\s*$/, '');

  return {
    id: a.layoutId || a.id,
    name,
    filepath: a.filepath ?? null,
    created_at: a.createdAt || a.created_at || null,
    layout_json: {
      threat_count: threats.length,
      non_threat_count: nonThreats.length,
      objects: { bag, threats, 'non-threats': nonThreats },
    },
  };
}

function normalizeSavedLayout(l) {
  if (!l || !l.layout_json) return null;
  return {
    id: l.id,
    name: l.name || 'imported layout',
    filepath: l.filepath ?? null,
    created_at: l.created_at || l.createdAt || null,
    layout_json: l.layout_json,
  };
}

function extractLayoutsFromParsed(type, parsed) {
  if (type === 'annotation') {
    const l = layoutFromAnnotation(parsed);
    return l ? [l] : [];
  }
  if (type === 'annotationPartition') {
    return Array.isArray(parsed) ? parsed.map(layoutFromAnnotation).filter(Boolean) : [];
  }
  if (type === 'savedLayouts') {
    return Array.isArray(parsed) ? parsed.map(normalizeSavedLayout).filter(Boolean) : [];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Item candidates from annotations / catalogs
// ---------------------------------------------------------------------------

function addItemTo(map, canCat, o, allowedIds) {
  const id = o && o.id;
  if (!id || map.has(id)) return;
  // Only derive an item from an annotation when the corresponding pixel file
  // is actually being imported (or the object is already covered by a catalog
  // JSON). This prevents creating phantom items for missing references.
  if (allowedIds && !allowedIds.has(id)) return;
  map.set(id, {
    id,
    category: displayCategory(canCat),
    subcategory: o.subcategory ? titleCase(o.subcategory) : 'General',
    filepath: o.filepath || `${id}.png`,
    width: o.size && o.size.width,
    height: o.size && o.size.height,
    pixelDataFilename: `highenergy/${id}.npz`,
    tags: Array.isArray(o.tags) ? o.tags : undefined,
    _fromAnnotation: true,
  });
}

// Strip the trailing "_copyNNNN" suffix from a generated copy id so copies of
// the same physical object (e.g. "P01X010-2024101200923_copy0103") group under
// their base id. Ids without a copy suffix are returned unchanged.
function copyBaseId(id) {
  return String(id || '').replace(/_[cC]opy\d+$/i, '');
}

// Multiple layouts can reference copies of the same base bag with *different*
// subcategory labels (usually caused by inconsistent annotation exports from
// the previous system). That produces visibly "jumbled" categories after import
// (e.g. half the backpacks showing up under briefcases). Reconcile every copy
// group to its most common label so the library stays consistent, and report
// how many items were affected.
//
// `reservedIds` is a Set of base IDs whose labels are already authoritative
// (e.g. from a catalog export). Those IDs are completely excluded from
// reconciliation so they never show up as "conflicts" and their labels are
// never overridden by annotation-derived copies.
function reconcileItemSubcategories(items, reservedIds = new Set()) {
  const groups = new Map();
  for (const it of items) {
    const base = copyBaseId(it.id);
    if (reservedIds.has(base)) continue; // catalog owns this base — skip entirely
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(it);
  }

  let conflicts = 0;
  const reconciled = [];
  for (const [base, groupItems] of groups) {
    // ---- Reconcile categories first ----
    const catFreq = new Map();
    for (const it of groupItems) {
      const k = displayCategory(it.category);
      catFreq.set(k, (catFreq.get(k) || 0) + 1);
    }
    if (catFreq.size > 1) {
      let bestCat = null;
      let bestCatCount = -1;
      for (const [cat, count] of catFreq) {
        if (count > bestCatCount || (count === bestCatCount && (!bestCat || cat < bestCat))) {
          bestCat = cat;
          bestCatCount = count;
        }
      }
      if (bestCat && groupItems.some((it) => displayCategory(it.category) !== bestCat)) {
        conflicts += groupItems.length;
        reconciled.push({ base, from: Array.from(catFreq.keys()), to: bestCat, count: groupItems.length, type: 'category' });
      }
      for (const it of groupItems) it.category = bestCat;
    }

    // ---- Reconcile subcategories ----
    const freq = new Map();
    for (const it of groupItems) {
      // Normalize subcategory keys to prevent "Backpack" vs "backpack" from
      // being treated as different subcategories.
      const k = titleCase(it.subcategory || 'General');
      freq.set(k, (freq.get(k) || 0) + 1);
    }
    if (freq.size < 2) continue;

    let best = null;
    let bestCount = -1;
    for (const [sub, count] of freq) {
      if (count > bestCount || (count === bestCount && (!best || sub < best))) {
        best = sub;
        bestCount = count;
      }
    }
    if (best && groupItems.some((it) => titleCase(it.subcategory) !== best)) {
      conflicts += groupItems.length;
      reconciled.push({ base, from: Array.from(freq.keys()), to: best, count: groupItems.length, type: 'subcategory' });
    }
    for (const it of groupItems) it.subcategory = best;
  }

  return { items, conflicts, reconciled };
}

function itemsFromLayouts(layouts, allowedIds, reservedIds = new Set()) {
  const map = new Map();
  for (const l of layouts) {
    const objs = (l.layout_json && l.layout_json.objects) || {};
    if (objs.bag) addItemTo(map, 'bags', objs.bag, allowedIds);
    if (Array.isArray(objs.threats)) for (const t of objs.threats) addItemTo(map, 'threats', t, allowedIds);
    if (Array.isArray(objs['non-threats'])) for (const nt of objs['non-threats']) addItemTo(map, 'non-threats', nt, allowedIds);
  }
  return reconcileItemSubcategories(Array.from(map.values()), reservedIds);
}

function itemsFromCatalog(category, parsed) {
  if (!Array.isArray(parsed)) return [];
  const cat = displayCategory(category);
  const out = [];
  for (const it of parsed) {
    if (!it || !it.id) continue;
    out.push({
      ...it,
      category: cat,
      pixelDataFilename: it.pixelDataFilename || it.pixel_data_path || `highenergy/${it.id}.npz`,
      _fromCatalog: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pixel file sources (browser multipart uploads)
// ---------------------------------------------------------------------------

/**
 * Recursively scan a directory for .npz files, honouring highenergy/ and
 * lowenergy/ sub-folder structure when present (flat folders default to high).
 */
export async function scanPixelDir(dir) {
  const out = [];
  const read = async (sub, energy) => {
    let entries;
    try { entries = await fs.readdir(sub, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(sub, e.name);
      if (e.isDirectory()) {
        const lower = e.name.toLowerCase();
        if (lower === 'highenergy') await read(abs, 'highenergy');
        else if (lower === 'lowenergy') await read(abs, 'lowenergy');
        else await read(abs, energy);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.npz')) {
        out.push({
          baseName: path.basename(e.name, path.extname(e.name)),
          energy,
          absPath: abs,
          originalName: path.relative(dir, abs).split(path.sep).join('/'),
        });
      }
    }
  };
  await read(dir, 'highenergy');
  return out;
}

/**
 * Recursively scan a directory for .json files (annotations / catalogs).
 */
export async function scanJsonDir(dir) {
  const out = [];
  const read = async (sub, prefix) => {
    let entries;
    try { entries = await fs.readdir(sub, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(sub, e.name);
      if (e.isDirectory()) {
        await read(abs, `${prefix}${e.name}/`);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.json')) {
        out.push({ filename: `${prefix}${e.name}`, absPath: abs });
      }
    }
  };
  await read(dir, '');
  return out;
}

/**
 * Build pixel-file descriptors from browser Multipart uploads. The frontend
 * should preserve the relative path (e.g. "highenergy/foo.npz") as the file
 * name so energy can be detected; flat names default to highenergy.
 */
export function buildPixelSourcesFromUploads(uploads) {
  if (!Array.isArray(uploads)) return [];
  return uploads.map((u) => {
    const rel = String(u.filename || u.originalname || '').replace(/\\/g, '/');
    const energy = /(^|\/)lowenergy\//i.test(rel) ? 'lowenergy' : 'highenergy';
    const base = path.basename(rel, path.extname(rel));
    return {
      baseName: base,
      energy,
      absPath: u.path,
      originalName: rel,
    };
  });
}

// ---------------------------------------------------------------------------
// Shared parsing of all provided sources
// ---------------------------------------------------------------------------

async function parseSources({ pixelFiles = [], jsonFiles = [] }) {
  const catalogItems = new Map();
  const layouts = [];
  const seenLayoutKeys = new Set();
  const jsonStats = { annotationsFiles: 0, savedLayoutsFiles: 0, catalogFiles: 0, unknownFiles: 0, errors: [] };
  const itemDerivation = { conflicts: 0, reconciled: [] };

  for (const jf of jsonFiles) {
    let parsed;
    try {
      parsed = await readJsonSafely(jf.absPath);
    } catch (err) {
      jsonStats.errors.push({ file: jf.filename, error: String((err && err.message) || err) });
      continue;
    }
    const typeInfo = detectJsonType(jf.filename, parsed);
    if (typeInfo.type === 'catalog') {
      jsonStats.catalogFiles++;
      for (const it of itemsFromCatalog(typeInfo.category, parsed)) {
        if (!catalogItems.has(it.id)) catalogItems.set(it.id, it);
      }
    } else if (typeInfo.type === 'annotation' || typeInfo.type === 'annotationPartition' || typeInfo.type === 'savedLayouts') {
      if (typeInfo.type === 'annotationPartition') jsonStats.annotationsFiles++;
      else jsonStats.savedLayoutsFiles++;
      for (const l of extractLayoutsFromParsed(typeInfo.type, parsed)) {
        if (!l) continue;
        const key = (l.id || '') + '|' + layoutContentKey(l);
        if (seenLayoutKeys.has(key)) continue;
        seenLayoutKeys.add(key);
        layouts.push(l);
      }
    } else {
      jsonStats.unknownFiles++;
    }
  }

  // Annotation-derived items fill gaps not covered by the catalog — but only
  // when the object's pixel file is present in the upload (prevents phantom
  // items for missing references). Items whose base ID already exists in the
  // catalog are reserved: they are excluded from reconciliation so the catalog
  // labels are never reported as "conflicts" or overwritten by annotation copies.
  const allowedForAnnotation = new Set([...catalogItems.keys(), ...pixelFiles.filter((p) => p.energy === 'highenergy').map((p) => p.baseName)]);
  const reservedIds = new Set([...catalogItems.keys()].map((id) => copyBaseId(id)));
  const layoutDerived = itemsFromLayouts(layouts, allowedForAnnotation, reservedIds);
  for (const it of layoutDerived.items) {
    if (!catalogItems.has(it.id)) catalogItems.set(it.id, it);
  }
  itemDerivation.reconciled.push(...layoutDerived.reconciled);
  itemDerivation.conflicts += layoutDerived.conflicts;

  return {
    catalogItems: Array.from(catalogItems.values()),
    catalogItemIds: new Set(catalogItems.keys()),
    layouts,
    jsonStats,
    itemDerivation,
    highBases: new Set(pixelFiles.filter((p) => p.energy === 'highenergy').map((p) => p.baseName)),
    lowBases: new Set(pixelFiles.filter((p) => p.energy === 'lowenergy').map((p) => p.baseName)),
    pixelFiles,
  };
}

// Build the set of everything that can satisfy a layout's object reference.
function buildAvailableSet(existingItems, parsed) {
  const avail = new Set();
  for (const it of existingItems) {
    if (it.id) avail.add(it.id);
    if (it.pixelDataFilename) avail.add(path.basename(it.pixelDataFilename, path.extname(it.pixelDataFilename)));
  }
  for (const id of parsed.catalogItemIds) avail.add(id);
  for (const b of parsed.highBases) avail.add(b);
  return avail;
}

// ---------------------------------------------------------------------------
// Analysis (pre-flight / safety check)
// ---------------------------------------------------------------------------

export async function analyzeImport({ pixelFiles = [], jsonFiles = [], progress } = {}) {
  const emit = (o) => { if (typeof progress === 'function') progress(o); };
  emit({ stage: 'analyze', message: 'Parsing JSON sources…', done: 0 });

  const parsed = await parseSources({ pixelFiles, jsonFiles });

  emit({ stage: 'analyze', message: 'Comparing against current library…', done: 1 });

  const existingItems = await getItems();
  const existingLayouts = await getSavedLayouts();

  const existingItemIds = new Set(existingItems.map((i) => i.id));
  const available = buildAvailableSet(existingItems, parsed);

  // ---- Pixel duplicates (already present in pixel_data/highenergy) ----
  const destHigh = new Set();
  try {
    const files = await fs.readdir(config.pixelDataHighRoot);
    for (const f of files) if (f.toLowerCase().endsWith('.npz')) destHigh.add(f.toLowerCase());
  } catch { /* dir may not exist yet */ }
  const pixelNew = [];
  const pixelDup = [];
  for (const b of parsed.highBases) {
    const name = `${b}.npz`.toLowerCase();
    if (destHigh.has(name)) pixelDup.push(b);
    else pixelNew.push(b);
  }
  const noLowEnergy = Array.from(parsed.highBases).filter((b) => !parsed.lowBases.has(b));

  // ---- Item classification ----
  const itemsToAdd = [];
  const itemsDuplicate = [];
  for (const it of parsed.catalogItems) {
    if (existingItemIds.has(it.id)) itemsDuplicate.push(it);
    else itemsToAdd.push(it);
  }

  // ---- Unclassified pixel files (present in upload, no metadata, not in library) ----
  const unclassified = [];
  const classifiedIds = new Set(parsed.catalogItems.map((i) => i.id));
  for (const b of parsed.highBases) {
    if (!classifiedIds.has(b) && !existingItemIds.has(b)) unclassified.push({ id: b, category: null });
  }

  // ---- Layouts ----
  const existingById = new Map(existingLayouts.map((l) => [l.id, l]));
  const existingKeys = new Set(existingLayouts.map((l) => layoutContentKey(l)));

  const layoutsToAdd = [];
  let layoutsDuplicate = 0;
  let collisionRenames = 0;
  const missingObjects = [];

  for (const l of parsed.layouts) {
    const objs = (l.layout_json && l.layout_json.objects) || {};
    const refs = [];
    if (objs.bag && objs.bag.id) refs.push(objs.bag.id);
    if (Array.isArray(objs.threats)) for (const t of objs.threats) if (t && t.id) refs.push(t.id);
    if (Array.isArray(objs['non-threats'])) for (const nt of objs['non-threats']) if (nt && nt.id) refs.push(nt.id);

    const missing = refs.filter((id) => !available.has(id));
    if (missing.length > 0) {
      missingObjects.push({ layoutId: l.id, missing });
      continue;
    }

    const contentKey = layoutContentKey(l);
    const existing = l.id && existingById.get(l.id);
    if (existing) {
      if (layoutContentKey(existing) === contentKey) { layoutsDuplicate++; continue; }
      collisionRenames++; // same id, different content -> added under fresh id
      layoutsToAdd.push(l);
      continue;
    }
    if (existingKeys.has(contentKey)) { layoutsDuplicate++; continue; }
    layoutsToAdd.push(l);
  }

  const report = {
    ok: true,
    pixel: {
      total: pixelFiles.length,
      newFiles: pixelNew,
      duplicateFiles: pixelDup,
      noLowEnergy,
      highCount: parsed.highBases.size,
    },
    json: parsed.jsonStats,
    items: {
      toAdd: itemsToAdd,
      duplicates: itemsDuplicate,
      unclassified,
    },
    layouts: {
      total: parsed.layouts.length,
      toAdd: layoutsToAdd,
      duplicates: layoutsDuplicate,
      collisionRenames,
      missingObjects,
    },
    itemDerivation: parsed.itemDerivation || { conflicts: 0, reconciled: [] },
    stats: {
      pixelNew: pixelNew.length,
      pixelDuplicate: pixelDup.length,
      itemsToAdd: itemsToAdd.length,
      itemsDuplicate: itemsDuplicate.length,
      unclassified: unclassified.length,
      layoutsToAdd: layoutsToAdd.length,
      layoutsDuplicate,
      collisionRenames,
      missingLayouts: missingObjects.length,
      subcategoryConflicts: (parsed.itemDerivation && parsed.itemDerivation.conflicts) || 0,
    },
  };

  emit({ stage: 'analyze', done: 1, message: 'Analysis complete', report });
  return report;
}

// ---------------------------------------------------------------------------
// Import execution
// ---------------------------------------------------------------------------

async function copyPixelData(pixelFiles, progress, cancelState) {
  const copied = [];
  const skipped = [];
  let n = 0;
  for (const p of pixelFiles) {
    if (cancelState && cancelState.cancelled) break;
    const destRoot = p.energy === 'lowenergy' ? config.pixelDataLowRoot : config.pixelDataHighRoot;
    try { await fs.mkdir(destRoot, { recursive: true }); } catch { /* exists */ }
    const dest = path.join(destRoot, `${p.baseName}.npz`);
    let exists = false;
    try { await fs.access(dest); exists = true; } catch { /* not exists */ }
    if (!exists && p.absPath !== dest) {
      try {
        await fs.copyFile(p.absPath, dest);
        copied.push(p.baseName);
      } catch (err) {
        skipped.push({ baseName: p.baseName, reason: String((err && err.message) || err) });
      }
    } else {
      skipped.push({ baseName: p.baseName, reason: exists ? 'already_exists' : 'same_path' });
    }
    n++;
    if (n % 50 === 0) progress({ stage: 'pixel', done: n, total: pixelFiles.length });
  }
  progress({ stage: 'pixel', done: pixelFiles.length, total: pixelFiles.length });
  return { copied, skipped };
}

async function generateValidRegionsForNewBags(addedItems, progress) {
  const bagsMissing = addedItems.filter((it) => displayCategory(it.category) === 'bags' && !it.valid_region_points);
  if (bagsMissing.length === 0) return { done: 0, failed: [] };

  // Resolve the actual .npz base filename from the item's stored pixel
  // reference (highenergy/<base>.npz or lowenergy/<base>.npz) instead of
  // assuming the filename equals the item id. The pixel file is copied under
  // its ORIGINAL base name, which can differ from the item id (e.g. imported
  // layout-derived ids).
  const toBase = (it) => {
    const ref = it.pixelDataFilename || it.pixel_data_path || '';
    const base = String(ref).split(/[\\/]/).pop().replace(/\.npz$/i, '');
    return base || String(it.id || '');
  };

  const tasks = [];
  const failedMissing = [];
  for (const it of bagsMissing) {
    const base = toBase(it);
    // Check both highenergy and lowenergy folders since pixel files may be
    // in either location depending on the original system's structure.
    const highPath = path.join(config.pixelDataHighRoot, `${base}.npz`);
    const lowPath = path.join(config.pixelDataLowRoot, `${base}.npz`);
    let npzPath = null;
    try { await fs.access(highPath); npzPath = highPath; } catch { /* try low */ }
    if (!npzPath) {
      try { await fs.access(lowPath); npzPath = lowPath; } catch { /* missing */ }
    }
    if (npzPath) tasks.push({ itemId: it.id, npzPath });
    else failedMissing.push({ itemId: it.id, reason: `pixel data file not found: ${base}.npz (checked highenergy/ and lowenergy/)` });
  }

  let done = 0;
  const failed = [...failedMissing];
  const concurrency = 2;
  const chunks = [];
  for (let i = 0; i < tasks.length; i += BATCH_FILES_PER_PROCESS) {
    chunks.push(tasks.slice(i, i + BATCH_FILES_PER_PROCESS));
  }

  const runQueue = [...chunks];
  const workers = Array.from({ length: Math.min(concurrency, chunks.length || 1) }, async () => {
    while (runQueue.length) {
      const chunk = runQueue.shift();
      if (!chunk) break;
      let results = [];
      try {
        results = await generateValidRegionBatch(chunk);
      } catch (err) {
        results = chunk.map((t) => ({ itemId: t.itemId, ok: false, error: String((err && err.message) || err) }));
      }
      for (const r of results) {
        if (r && r.ok && r.data && Array.isArray(r.data.points) && r.data.points.length >= 3) {
          try {
            await updateItem(r.itemId, { valid_region_points: { points: r.data.points } });
            done++;
          } catch (err) {
            failed.push({ itemId: r.itemId, reason: String((err && err.message) || err) });
          }
        } else {
          failed.push({ itemId: r && r.itemId, reason: (r && r.error) || 'no valid region generated' });
        }
        const processed = done + failed.length;
        if (processed % 20 === 0) progress({ stage: 'valid-region', done: processed, total: bagsMissing.length });
      }
    }
  });
  await Promise.all(workers);
  progress({ stage: 'valid-region', done: bagsMissing.length, total: bagsMissing.length });
  return { done, failed };
}

function collectLayoutRefs(l) {
  const objs = (l.layout_json && l.layout_json.objects) || {};
  const refs = [];
  if (objs.bag && objs.bag.id) refs.push(objs.bag.id);
  if (Array.isArray(objs.threats)) for (const t of objs.threats) if (t && t.id) refs.push(t.id);
  if (Array.isArray(objs['non-threats'])) for (const nt of objs['non-threats']) if (nt && nt.id) refs.push(nt.id);
  return refs;
}

/**
 * Execute the import after a successful analysis.
 *
 * @param {object}   input
 * @param {Array}    input.pixelFiles  - pixel descriptors ({baseName, energy, absPath})
 * @param {Array}    input.jsonFiles   - json descriptors ({filename, absPath})
 * @param {object}   input.options     - {autoValidRegions, skipMissing, copyPixelData, categoryOverrides}
 * @param {Function} input.progress    - (obj) => void  (NDJSON-shaped progress objects)
 */
export async function runImport({ pixelFiles = [], jsonFiles = [], options = {}, progress } = {}) {
  const emit = (o) => { if (typeof progress === 'function') progress(o); };
  const opts = {
    autoValidRegions: true,
    skipMissing: false,
    copyPixelData: true,
    categoryOverrides: {}, // baseName -> 'bags' | 'threats' | 'non-threats'
    ...options,
  };
  const cancelState = opts.cancelState || { cancelled: false };
  const cancelled = () => cancelState.cancelled;

  emit({ stage: 'start', message: 'Parsing sources…' });
  const parsed = await parseSources({ pixelFiles, jsonFiles });

  // Build a map of base name -> energy folder so we can set correct pixel
  // data paths for items created from unclassified files / overrides.
  const pixelEnergyMap = new Map();
  for (const p of pixelFiles) {
    pixelEnergyMap.set(p.baseName, p.energy);
  }

  const existingItems = await getItems();
  const existingItemIds = new Set(existingItems.map((i) => i.id));
  const available = buildAvailableSet(existingItems, parsed);

  // ---- 1. Copy pixel data ----
  let pixelCopy = { copied: [], skipped: [] };
  if (opts.copyPixelData) {
    emit({ stage: 'pixel', message: 'Copying pixel data…', done: 0, total: pixelFiles.length });
    pixelCopy = await copyPixelData(pixelFiles, emit, cancelState);
    if (cancelled()) { emit({ stage: 'cancelled', message: 'Import cancelled during pixel copy' }); return { cancelled: true, partial: true }; }
  }

  // ---- 2. Build library items to add ----
  const itemsToAdd = parsed.catalogItems.filter((it) => !existingItemIds.has(it.id));

  // Apply user category overrides for unclassified pixel files.
  const overrides = opts.categoryOverrides || {};
  const classified = new Set(parsed.catalogItems.map((i) => i.id));
  for (const [base, category] of Object.entries(overrides)) {
    if (!category || classified.has(base) || existingItemIds.has(base)) continue;
    // Use the actual energy folder for the pixel file instead of always
    // defaulting to highenergy/.
    const energy = pixelEnergyMap.get(base) || 'highenergy';
    itemsToAdd.push({
      id: base,
      category: displayCategory(category),
      subcategory: 'General',
      filepath: `${base}.png`,
      pixelDataFilename: `${energy}/${base}.npz`,
      _fromOverride: true,
    });
    classified.add(base);
  }

  let itemImport = { added: [], skipped: [], total: 0 };
  if (itemsToAdd.length > 0) {
    emit({ stage: 'items', message: `Registering ${itemsToAdd.length} library item(s)…`, done: 0, total: itemsToAdd.length });
    itemImport = await importItemsBatch(itemsToAdd, { skipExisting: true });
    emit({ stage: 'items', message: 'Library items registered', done: itemsToAdd.length, total: itemsToAdd.length });
    if (cancelled()) { emit({ stage: 'cancelled', message: 'Import cancelled after item registration' }); return { cancelled: true, partial: true }; }
  }

  // ---- 3. Auto valid regions for new bags ----
  let validRegionResult = { done: 0, failed: [] };
  if (opts.autoValidRegions && itemImport.added.length > 0) {
    emit({ stage: 'valid-region', message: 'Generating valid regions for new bags…', done: 0, total: itemImport.added.length });
    validRegionResult = await generateValidRegionsForNewBags(itemImport.added, emit);
    if (cancelled()) { emit({ stage: 'cancelled', message: 'Import cancelled during valid-region generation' }); return { cancelled: true, partial: true }; }
  }

  // ---- 4. Import saved layouts (with missing-object purge + collision rename) ----
  // Layouts that reference objects which are neither in the current library
  // nor among the uploaded pixel files are ALWAYS excluded here (they are
  // reported back to the user). When `skipMissing` is set the user explicitly
  // chose to purge them from a copy of the annotations.
  const keep = [];
  let purged = 0;
  for (const l of parsed.layouts) {
    const bad = collectLayoutRefs(l).filter((id) => !available.has(id));
    if (bad.length > 0) { purged++; continue; }
    keep.push(l);
  }

  let layoutImport = { added: [], skipped: [], renamed: [], total: 0 };
  if (keep.length > 0) {
    emit({ stage: 'layouts', message: `Importing ${keep.length} saved layout(s)…`, done: 0, total: keep.length });
    layoutImport = await importSavedLayoutsBatch(keep, { skipExisting: true, renameCollisions: true });
    emit({ stage: 'layouts', message: 'Saved layouts imported', done: keep.length, total: keep.length });
    if (cancelled()) { emit({ stage: 'cancelled', message: 'Import cancelled after layout import' }); return { cancelled: true, partial: true }; }
  }

  const summary = {
    pixel: { copied: pixelCopy.copied.length, skipped: pixelCopy.skipped.length },
    items: { added: itemImport.added.length, skipped: itemImport.skipped.length },
    validRegions: { generated: validRegionResult.done, failed: validRegionResult.failed.length },
    layouts: {
      added: layoutImport.added.length,
      skipped: layoutImport.skipped.length,
      renamed: layoutImport.renamed.length,
      purged,
    },
  };

  emit({ stage: 'done', message: 'Import complete', summary });
  return summary;
}

