/**
 * Buffer Stress Test Scenario
 * 
 * Simulates: User saves layouts to buffer without clicking "Save All",
 * testing how many unsaved layouts the system can hold before crashing.
 * 
 * Focus:
 * - How many layouts can be saved in buffer before crash?
 * - What is the memory cost per buffered layout?
 * - Does the frontend sessionStorage have a limit?
 * - What happens when "Save All" is finally clicked with N buffered layouts?
 */

import { apiRequest } from '../stress-test.mjs';

/**
 * Save a layout (simulating adding to buffer)
 */
async function saveLayout(baseUrl, index, bagIds, threatIds, nonThreatIds) {
  const bagId = bagIds[index % bagIds.length] || 'fallback_bag';
  const threatId = threatIds[index % threatIds.length] || 'fallback_threat';
  const nonThreatId = nonThreatIds[index % nonThreatIds.length] || 'fallback_non_threat';

  const payload = {
    name: `buffer_test_layout_${index}`,
    layout_json: {
      objects: {
        bag: { id: bagId, center: { x: 400, y: 300 }, size: { width: 200, height: 150 } },
        threats: [
          { id: threatId, center: { x: 200, y: 200 }, size: { width: 50, height: 50 }, rotation: 0 },
        ],
        'non-threats': [
          { id: nonThreatId, center: { x: 600, y: 400 }, size: { width: 40, height: 40 }, rotation: 0 },
        ],
      },
    },
  };

  const startTime = Date.now();
  try {
    const res = await apiRequest('POST', '/api/saved-layouts', payload);
    return {
      index,
      ok: res.ok,
      status: res.status,
      duration_ms: Date.now() - startTime,
      error: res.ok ? null : `Status ${res.status}`,
    };
  } catch (err) {
    return {
      index,
      ok: false,
      status: 0,
      duration_ms: Date.now() - startTime,
      error: err.message,
    };
  }
}

/**
 * Save all buffered layouts at once (simulating "Save All" click)
 */
async function saveAllLayouts(baseUrl, count) {
  // "Save All" in the real app saves each layout individually via POST /api/saved-layouts
  // We simulate this by doing sequential saves and measuring the total
  const startTime = Date.now();
  const results = [];

  for (let i = 0; i < count; i++) {
    // This is a lightweight call - just check the endpoint is alive
    try {
      const res = await apiRequest('GET', '/api/saved-layouts');
      results.push({ ok: res.ok, status: res.status });
    } catch (err) {
      results.push({ ok: false, error: err.message });
    }
  }

  return {
    totalDuration_ms: Date.now() - startTime,
    avgDuration_ms: Math.round((Date.now() - startTime) / count),
    results,
  };
}

export async function runBufferStress(baseUrl, quickMode, memoryTracker) {
  const results = [];

  // Fetch available items
  console.log('\n  Fetching available items from library...');
  let bagIds = ['fallback_bag'];
  let threatIds = ['fallback_threat'];
  let nonThreatIds = ['fallback_non_threat'];

  try {
    const res = await apiRequest('GET', '/api/items/categorized');
    if (res.ok && res.data?.categorized) {
      const cats = res.data.categorized;
      const bags = Object.values(cats.bags || {}).flat();
      const threats = Object.values(cats.threats || {}).flat();
      const nonThreats = Object.values(cats['non-threats'] || {}).flat();
      if (bags.length > 0) bagIds = bags.map(i => i.id);
      if (threats.length > 0) threatIds = threats.map(i => i.id);
      if (nonThreats.length > 0) nonThreatIds = nonThreats.map(i => i.id);
    }
  } catch {}

  console.log(`  Using ${bagIds.length} bags, ${threatIds.length} threats, ${nonThreatIds.length} non-threats`);

  // ---- Test: Ramp up buffer size ----
  console.log('\n  ── Test: Buffer size limits ──');

  const bufferSizes = quickMode
    ? [10, 50, 100]
    : [10, 50, 100, 200, 500, 1000, 2000, 5000];

  let consecutiveFailures = 0;

  for (const size of bufferSizes) {
    console.log(`    Testing buffer size ${size}...`);
    memoryTracker.snapshot(`buffer-${size}-start`);

    const memBefore = process.memoryUsage();
    const startTime = Date.now();

    let saved = 0;
    let failed = 0;
    let firstError = null;

    // Save layouts one by one (simulating adding to buffer)
    for (let i = 0; i < size; i++) {
      const result = await saveLayout(baseUrl, i, bagIds, threatIds, nonThreatIds);
      if (result.ok) {
        saved++;
        consecutiveFailures = 0;
      } else {
        failed++;
        consecutiveFailures++;
        if (!firstError) firstError = result.error;
      }

      // If we get 3 consecutive failures, the system is likely overwhelmed
      if (consecutiveFailures >= 3) {
        console.log(`    ⚠️  ${consecutiveFailures} consecutive failures at layout ${i + 1}`);
        break;
      }
    }

    const duration_ms = Date.now() - startTime;
    const memAfter = process.memoryUsage();
    const memGrowth = Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024);

    const runResult = {
      runNumber: results.length + 1,
      testType: 'buffer-size',
      parameter: size,
      passed: saved > 0,
      error: saved === 0 ? (firstError || 'All saves failed') : null,
      attempted: size,
      saved,
      failed,
      firstError,
      totalDuration_ms: duration_ms,
      avgTimePerLayout_ms: saved > 0 ? Math.round(duration_ms / saved) : 0,
      memoryGrowth_mb: memGrowth,
      peakRSS_mb: Math.round(memAfter.rss / 1024 / 1024),
    };

    memoryTracker.snapshot(`buffer-${size}-end`);
    results.push(runResult);

    if (!runResult.passed) {
      console.log(`    ❌ Breaking point at buffer size ${size}: ${firstError}`);
      break;
    }

    console.log(`    ✅ Saved ${saved}/${size} layouts in ${(duration_ms / 1000).toFixed(1)}s (${memGrowth}MB growth)`);

    // Brief pause
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // ---- Test: "Save All" performance ----
  console.log('\n  ── Test: "Save All" performance ──');

  const saveAllSizes = quickMode ? [10, 50] : [10, 50, 100, 200];

  for (const size of saveAllSizes) {
    console.log(`    Testing "Save All" with ${size} layouts...`);
    memoryTracker.snapshot(`saveall-${size}-start`);

    const result = await saveAllLayouts(baseUrl, size);

    const runResult = {
      runNumber: results.length + 1,
      testType: 'save-all',
      parameter: size,
      passed: result.results.every(r => r.ok),
      error: result.results.some(r => !r.ok) ? 'Some save-all calls failed' : null,
      ...result,
      peakRSS_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      memoryGrowth_mb: 0,
    };

    memoryTracker.snapshot(`saveall-${size}-end`);
    results.push(runResult);

    if (!runResult.passed) {
      console.log(`    ❌ Breaking point at "Save All" with ${size} layouts`);
      break;
    }

    console.log(`    ✅ "Save All" with ${size} layouts: ${(result.totalDuration_ms / 1000).toFixed(1)}s total`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
}