/**
 * Test script for rate limiter
 * Tests that rate limiting works correctly and doesn't block normal users
 */

import http from 'http';

const BASE_URL = 'http://localhost:8080';
let testsPassed = 0;
let testsFailed = 0;

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, data: JSON.parse(data) });
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting Rate Limiter Tests...\n');

  // Test 1: Normal request should succeed
  console.log('Test 1: Normal request to /api/items/categorized');
  try {
    const res = await makeRequest('/api/items/categorized');
    if (res.status === 200 && res.data.ok) {
      console.log('✅ PASS: Normal request succeeded\n');
      testsPassed++;
    } else {
      console.log(`❌ FAIL: Expected 200, got ${res.status}\n`);
      testsFailed++;
    }
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // Test 2: Rate limit status endpoint should work
  console.log('Test 2: Rate limit status endpoint');
  try {
    const res = await makeRequest('/api/rate-limit-status');
    if (res.status === 200 && res.data.ok && res.data.rateLimiter) {
      console.log('✅ PASS: Rate limit status endpoint works');
      console.log(`   Tracked IPs: ${res.data.rateLimiter.trackedIPs}`);
      console.log(`   Concurrent: ${res.data.rateLimiter.concurrentConnections}\n`);
      testsPassed++;
    } else {
      console.log(`❌ FAIL: Expected 200 with rateLimiter data, got ${res.status}\n`);
      testsFailed++;
    }
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // Test 3: Rapid requests should be rate limited
  console.log('Test 3: Rapid requests (testing rate limit)');
  try {
    const promises = [];
    for (let i = 0; i < 25; i++) {
      promises.push(makeRequest('/api/items/categorized'));
    }
    const results = await Promise.all(promises);
    const statusCodes = results.map(r => r.status);
    const rateLimited = statusCodes.filter(s => s === 429).length;
    const succeeded = statusCodes.filter(s => s === 200).length;
    
    console.log(`   Total requests: ${results.length}`);
    console.log(`   Succeeded (200): ${succeeded}`);
    console.log(`   Rate limited (429): ${rateLimited}`);
    
    if (rateLimited > 0 && succeeded <= 20) {
      console.log('✅ PASS: Rate limiting is working correctly\n');
      testsPassed++;
    } else {
      console.log('❌ FAIL: Rate limiting did not work as expected\n');
      testsFailed++;
    }
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // Test 4: Health check should not be rate limited
  console.log('Test 4: Health check endpoint (should not be rate limited)');
  try {
    const res = await makeRequest('/api/health');
    if (res.status === 200 && res.data.status === 'healthy') {
      console.log('✅ PASS: Health check works\n');
      testsPassed++;
    } else {
      console.log(`❌ FAIL: Expected 200, got ${res.status}\n`);
      testsFailed++;
    }
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // Print summary
  console.log('═'.repeat(50));
  console.log('Test Summary:');
  console.log(`  ✅ Passed: ${testsPassed}`);
  console.log(`  ❌ Failed: ${testsFailed}`);
  console.log(`  Total: ${testsPassed + testsFailed}`);
  console.log('═'.repeat(50));

  if (testsFailed === 0) {
    console.log('\n🎉 All tests passed! Rate limiter is working correctly.');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Please check the implementation.');
    process.exit(1);
  }
}

// Run tests
console.log('Make sure the server is running on port 8080 before running this test.\n');
runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
