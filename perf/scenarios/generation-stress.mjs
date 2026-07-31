/**
 * Generation Stress Test Scenario
 * 
 * Simulates: User selects K bags and N objects, generates collages,
 * then saves all. Tests increasing K (combinations) and N (objects)
 * values to find the breaking point.
 * 
 * Focus: 
 * - What is the max K (combinations) before crash?
 * - What is the max N (objects per combination) before crash?
 * - How many layouts can be saved in a single "save all" call?
 * - Does memory free after each batch or stack?
 */

import { apiRequest } from '../stress-test.mjs';

/**
 * Wrapper to add timeout to any async operation
 */
async function withTimeout(promise, timeoutMs, label) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms: ${label}`)), timeoutMs)
  );
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Test generation with increasing K values (number of combinations)
 */
async function testCombinationsK(baseUrl, kValue, bagIds, threatIds, nonThreatIds) {
  const layouts = [];
  const startTime = Date.now();

  for (let i = 0; i < kValue; i++) {
    const layoutPayload = {
      name: `stress_layout_k${kValue}_${i}`,
      layout_json: {
        objects: {
          bag: { id: bagIds[0] || 'fallback_bag' },
          threats: threatIds.slice(0, 3).map(id => ({ id })),
          'non-threats': nonThreatIds.slice(0, 2).map(id => ({ id })),
        },
      },
    };

    try {
      const res = await withTimeout(
        apiRequest('POST', '/api/saved-layouts', layoutPayload),
        10000,
        `save layout ${i + 1}/${kValue}`
      );
      
      if (res.ok) {
        layouts.push({ id: res.data?.layout?.id, ok: true, status: res.status });
      } else {
        layouts.push({ ok: false, status: res.status, error: `HTTP ${res.status}` });
      }
    } catch (err) {
      layouts.push({ ok: false, error: err.message });
    }

    // Early exit if we hit 3 consecutive failures
    const recentFailures = layouts.slice(-3).filter(l => !l.ok).length;
    if (recentFailures >= 3) {
      console.log(`    ⚠️  Stopping early at layout ${i + 1} due to repeated failures`);
      break;
    }
  }

  const duration_ms = Date.now() - startTime;
  const saved = layouts.filter(l => l.ok).length;
  const failed = layouts.filter(l => !l.ok).length;

  return {
    kValue,
    attempted: layouts.length,
    saved,
    failed,
    duration_ms,
    avgTimePerLayout_ms: saved > 0 ? Math.round(duration_ms / saved) : 0,
  };
}

/**
 * Test generation with increasing N values (objects per combination)
 */
async function testObjectsPerCombo(baseUrl, objectCount, bagIds, threatIds, nonThreatIds) {
  const selectedThreats = threatIds.slice(0, Math.min(objectCount, threatIds.length));
  const selectedOthers = nonThreatIds.slice(0, Math.min(Math.ceil(objectCount / 2), nonThreatIds.length));

  const layoutPayload = {
    name: `stress_objects_${objectCount}`,
    layout_json: {
      objects: {
        bag: { id: bagIds[0] || 'fallback_bag' },
        threats: selectedThreats.map(id => ({ id })),
        'non-threats': selectedOthers.map(id => ({ id })),
      },
    },
  };

  const startTime = Date.now();
  let saved = false;
  let error = null;

  try {
    const res = await withTimeout(
      apiRequest('POST', '/api/saved-layouts', layoutPayload),
      10000,
      `save layout with ${objectCount} objects`
    );
    saved = res.ok;
    if (!res.ok) error = `Status ${res.status}: ${JSON.stringify(res.data)}`;
  } catch (err) {
    error = err.message;
  }

  return {
    objectCount,
    bagCount: 1,
    threatCount: selectedThreats.length,
    nonThreatCount: selectedOthers.length,
    saved,
    error,
    duration_ms: Date.now() - startTime,
  };
}

export async function runGenerationStress(baseUrl, quickMode, memoryTracker) {
  const results = [];

  // First, fetch available items from the library
  console.log('\n  Fetching available items from library...');
  let bagIds = [];
  let threatIds = [];
  let nonThreatIds = [];

  try {
    const res = await apiRequest('GET', '/api/items/categorized');
    if (res.ok && res.data?.categorized) {
      const cats = res.data.categorized;
      bagIds = Object.values(cats.bags || {}).flat().map(i => i.id).slice(0, 20);
      threatIds = Object.values(cats.threats || {}).flat().map(i => i.id).slice(0, 50);
      nonThreatIds = Object.values(cats['non-threats'] || {}).flat().map(i => i.id).slice(0, 30);
    }
  } catch (err) {
    console.warn('  Could not fetch items, using fallback IDs');
  }

  if (bagIds.length === 0) {
    console.log('  ⚠️  No items found in library. Generation tests will use fallback data.');
    for (let i = 0; i < 50; i++) {
      const id = `stress_fallback_${i}`;
      bagIds.push(id);
      threatIds.push(id);
      nonThreatIds.push(id);
    }
  }

  console.log(`  Found ${bagIds.length} bags, ${threatIds.length} threats, ${nonThreatIds.length} non-threats`);

  // ---- Test 1: Ramp up K (combinations) ----
  console.log('\n  ── Test: Ramp up K (combinations) ──');

  const kValues = quickMode ? [5, 10, 20] : [5, 10, 20, 50, 100, 200, 500];

  for (const k of kValues) {
    console.log(`    Testing K=${k}...`);
    memoryTracker.snapshot(`generation-k${k}-start`);

    const result = await testCombinationsK(baseUrl, k, bagIds, threatIds, nonThreatIds);

    const runResult = {
      runNumber: results.length + 1,
      testType: 'k-combinations',
      parameter: k,
      passed: result.saved > 0,
      error: result.saved === 0 ? 'No layouts saved' : null,
      ...result,
      peakRSS_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      memoryGrowth_mb: 0,
    };

    memoryTracker.snapshot(`generation-k${k}-end`);
    results.push(runResult);

    if (!runResult.passed) {
      console.log(`    ❌ Breaking point at K=${k}`);
      break;
    }

    console.log(`    ✅ Saved ${result.saved}/${result.attempted} layouts in ${(result.duration_ms / 1000).toFixed(1)}s`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // ---- Test 2: Ramp up N (objects per combination) ----
  console.log('\n  ── Test: Ramp up N (objects per combination) ──');

  const objectCounts = quickMode ? [5, 10] : [5, 10, 20, 30, 50];

  for (const count of objectCounts) {
    console.log(`    Testing N=${count} objects...`);
    memoryTracker.snapshot(`generation-n${count}-start`);

    const result = await testObjectsPerCombo(baseUrl, count, bagIds, threatIds, nonThreatIds);

    const runResult = {
      runNumber: results.length + 1,
      testType: 'objects-per-combo',
      parameter: count,
      passed: result.saved,
      error: result.error,
      ...result,
      peakRSS_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      memoryGrowth_mb: 0,
    };

    memoryTracker.snapshot(`generation-n${count}-end`);
    results.push(runResult);

    if (!runResult.passed) {
      console.log(`    ❌ Breaking point at N=${count}: ${result.error}`);
      break;
    }

    console.log(`    ✅ Saved layout with ${count} objects in ${(result.duration_ms / 1000).toFixed(1)}s`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}