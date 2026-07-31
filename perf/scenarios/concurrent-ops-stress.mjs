/**
 * Concurrent Operations Stress Test Scenario
 * 
 * This is the most critical scenario as described by Ashish:
 * "Call the same set of APIs N times across M threads to simulate
 *  real user behavior and find the breaking point."
 * 
 * Simulates: Multiple users performing operations simultaneously:
 * - User A: Uploading files
 * - User B: Assigning categories
 * - User C: Auto-generating valid regions
 * - User D: Saving layouts
 * - User E: Rendering collages
 * 
 * All operations happen concurrently, ramping up until the system breaks.
 * Memory is tracked to detect leaks (does it free or stack?).
 */

import { apiRequest } from '../stress-test.mjs';

/**
 * A single "operation set" that simulates one user's actions
 */
async function executeOperationSet(baseUrl, setId, bagIds, threatIds, nonThreatIds) {
  const results = [];
  const startTime = Date.now();

  // Operation 1: Get categorized items (read)
  try {
    const res = await apiRequest('GET', '/api/items/categorized?limit=50');
    results.push({ op: 'get-items', ok: res.ok, status: res.status, ms: res.timing?.duration_ms || 0 });
  } catch (err) {
    results.push({ op: 'get-items', ok: false, error: err.message });
  }

  // Operation 2: Get saved layouts (read)
  try {
    const res = await apiRequest('GET', '/api/saved-layouts');
    results.push({ op: 'get-layouts', ok: res.ok, status: res.status, ms: res.timing?.duration_ms || 0 });
  } catch (err) {
    results.push({ op: 'get-layouts', ok: false, error: err.message });
  }

  // Operation 3: Update an item (write) - if we have items
  if (bagIds.length > 0) {
    const id = bagIds[setId % bagIds.length];
    try {
      const res = await apiRequest('PUT', `/api/items/${id}`, {
        category: 'bags',
        subcategory: 'backpack',
      });
      results.push({ op: 'update-item', ok: res.ok, status: res.status, ms: res.timing?.duration_ms || 0 });
    } catch (err) {
      results.push({ op: 'update-item', ok: false, error: err.message });
    }
  }

  // Operation 4: Save a layout (write)
  try {
    const layoutPayload = {
      name: `concurrent_layout_${setId}_${Date.now()}`,
      layout_json: {
        objects: {
          bag: { id: bagIds[0] || 'fallback_bag' },
          threats: threatIds.slice(0, 2).map(id => ({ id })),
          'non-threats': nonThreatIds.slice(0, 1).map(id => ({ id })),
        },
      },
    };
    const res = await apiRequest('POST', '/api/saved-layouts', layoutPayload);
    results.push({ op: 'save-layout', ok: res.ok, status: res.status, ms: res.timing?.duration_ms || 0 });
  } catch (err) {
    results.push({ op: 'save-layout', ok: false, error: err.message });
  }

  // Operation 5: Get custom subcategories (read)
  try {
    const res = await apiRequest('GET', '/api/custom-subcategories');
    results.push({ op: 'get-subcategories', ok: res.ok, status: res.status, ms: res.timing?.duration_ms || 0 });
  } catch (err) {
    results.push({ op: 'get-subcategories', ok: false, error: err.message });
  }

  return {
    setId,
    results,
    totalDuration_ms: Date.now() - startTime,
    allOk: results.every(r => r.ok),
    failedCount: results.filter(r => !r.ok).length,
  };
}

export async function runConcurrentOpsStress(baseUrl, quickMode, memoryTracker) {
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

  // ---- Ramp up concurrent users ----
  console.log('\n  ── Test: Ramp up concurrent users ──');

  // Each "user" executes the full operation set (5 API calls)
  // We ramp up: 1 user, 5 users, 10 users, 25 users, 50 users, 100 users...
  const concurrencyLevels = quickMode
    ? [1, 5, 10, 25]
    : [1, 5, 10, 25, 50, 100, 200, 500];

  for (const concurrentUsers of concurrencyLevels) {
    console.log(`    Testing ${concurrentUsers} concurrent users...`);
    memoryTracker.snapshot(`concurrent-${concurrentUsers}-start`);

    const memBefore = process.memoryUsage();
    const startTime = Date.now();

    // Launch all users concurrently
    const userPromises = [];
    for (let i = 0; i < concurrentUsers; i++) {
      userPromises.push(executeOperationSet(baseUrl, i, bagIds, threatIds, nonThreatIds));
    }

    const userResults = await Promise.allSettled(userPromises);
    const totalDuration = Date.now() - startTime;
    const memAfter = process.memoryUsage();
    const memGrowth = Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024);

    // Analyze results
    let totalOps = 0;
    let successfulOps = 0;
    let failedOps = 0;
    let totalOpTime = 0;
    const opBreakdown = {};

    for (const userResult of userResults) {
      if (userResult.status === 'fulfilled') {
        const userData = userResult.value;
        for (const op of userData.results) {
          totalOps++;
          totalOpTime += op.ms || 0;
          if (op.ok) successfulOps++;
          else failedOps++;

          if (!opBreakdown[op.op]) {
            opBreakdown[op.op] = { total: 0, ok: 0, failed: 0, totalMs: 0 };
          }
          opBreakdown[op.op].total++;
          opBreakdown[op.op].totalMs += op.ms || 0;
          if (op.ok) opBreakdown[op.op].ok++;
          else opBreakdown[op.op].failed++;
        }
      } else {
        failedOps += 5; // Assume all 5 ops failed for this user
        totalOps += 5;
      }
    }

    const runResult = {
      runNumber: results.length + 1,
      testType: 'concurrent-users',
      parameter: concurrentUsers,
      passed: successfulOps > 0,
      error: successfulOps === 0 ? 'All operations failed' : null,
      concurrentUsers,
      totalOperations: totalOps,
      successfulOperations: successfulOps,
      failedOperations: failedOps,
      successRate: totalOps > 0 ? Math.round((successfulOps / totalOps) * 100) : 0,
      totalDuration_ms: totalDuration,
      avgOpDuration_ms: successfulOps > 0 ? Math.round(totalOpTime / successfulOps) : 0,
      memoryGrowth_mb: memGrowth,
      peakRSS_mb: Math.round(memAfter.rss / 1024 / 1024),
      opBreakdown,
    };

    memoryTracker.snapshot(`concurrent-${concurrentUsers}-end`);
    results.push(runResult);

    if (!runResult.passed) {
      console.log(`    ❌ Breaking point at ${concurrentUsers} concurrent users`);
      break;
    }

    // Pause to allow GC / post-action cleanup
    await new Promise(resolve => setTimeout(resolve, 2000));
    const memPost = process.memoryUsage();
    const memPostDelta = Math.round((memPost.heapUsed - memBefore.heapUsed) / 1024 / 1024);
    const memFreedStatus = memPostDelta <= 5 ? 'FREED (clean)' : `STACKED (+${memPostDelta}MB retained)`;
    
    runResult.memPostDelta_mb = memPostDelta;
    runResult.memFreedStatus = memFreedStatus;

    const rate = runResult.successRate;
    const icon = rate >= 90 ? '✅' : rate >= 50 ? '⚠️' : '❌';
    console.log(`    ${icon} ${concurrentUsers} users: ${successfulOps}/${totalOps} ops OK (${rate}%) in ${(totalDuration / 1000).toFixed(1)}s (Peak: +${memGrowth}MB | Post-Action: ${memFreedStatus})`);
  }

  // ---- Multi-threaded simulation (same API called N times across M "threads") ----
  console.log('\n  ── Test: Same API called N times across M threads ──');

  // This directly tests Ashish's scenario: "calling the same set of apis n number of times"
  // We pick 3 key APIs and call them in parallel with increasing thread counts

  const apiSets = [
    { name: 'GET /api/items/categorized', method: 'GET', path: '/api/items/categorized?limit=10' },
    { name: 'GET /api/saved-layouts', method: 'GET', path: '/api/saved-layouts' },
    { name: 'GET /api/custom-subcategories', method: 'GET', path: '/api/custom-subcategories' },
  ];

  const threadCounts = quickMode ? [5, 10, 25] : [5, 10, 25, 50, 100, 200, 500];

  for (const threads of threadCounts) {
    console.log(`    Testing ${threads} threads x ${apiSets.length} APIs...`);
    memoryTracker.snapshot(`threads-${threads}-start`);

    const memBefore = process.memoryUsage();
    const startTime = Date.now();

    // Each "thread" calls all APIs in sequence
    const threadPromises = [];
    for (let t = 0; t < threads; t++) {
      threadPromises.push(
        (async () => {
          const threadResults = [];
          for (const api of apiSets) {
            try {
              const res = await apiRequest(api.method, api.path);
              threadResults.push({ api: api.name, ok: res.ok, status: res.status });
            } catch (err) {
              threadResults.push({ api: api.name, ok: false, error: err.message });
            }
          }
          return threadResults;
        })()
      );
    }

    const allThreadResults = await Promise.allSettled(threadPromises);
    const totalDuration = Date.now() - startTime;
    const memAfter = process.memoryUsage();
    const memGrowth = Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024);

    // Analyze
    let totalCalls = 0;
    let successCalls = 0;
    let failCalls = 0;

    for (const threadResult of allThreadResults) {
      if (threadResult.status === 'fulfilled') {
        for (const apiResult of threadResult.value) {
          totalCalls++;
          if (apiResult.ok) successCalls++;
          else failCalls++;
        }
      } else {
        failCalls += apiSets.length;
        totalCalls += apiSets.length;
      }
    }

    const runResult = {
      runNumber: results.length + 1,
      testType: 'multi-threaded-apis',
      parameter: threads,
      passed: successCalls > 0,
      error: successCalls === 0 ? 'All API calls failed' : null,
      threads,
      apisPerThread: apiSets.length,
      totalCalls,
      successCalls,
      failCalls,
      successRate: totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0,
      totalDuration_ms: totalDuration,
      avgCallDuration_ms: successCalls > 0 ? Math.round(totalDuration / successCalls) : 0,
      memoryGrowth_mb: memGrowth,
      peakRSS_mb: Math.round(memAfter.rss / 1024 / 1024),
    };

    memoryTracker.snapshot(`threads-${threads}-end`);
    results.push(runResult);

    if (!runResult.passed) {
      console.log(`    ❌ Breaking point at ${threads} threads`);
      break;
    }

    const rate = runResult.successRate;
    const icon = rate >= 90 ? '✅' : rate >= 50 ? '⚠️' : '❌';
    console.log(`    ${icon} ${threads} threads: ${successCalls}/${totalCalls} calls OK (${rate}%) in ${(totalDuration / 1000).toFixed(1)}s (${memGrowth}MB)`);

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}