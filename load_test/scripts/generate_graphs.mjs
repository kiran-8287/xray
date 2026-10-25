// ============================================================================
// GRAPH GENERATOR - Generates SVGs and HTML Dashboard from load test results
// STRICTLY USES B: DRIVE ONLY (NO A: DRIVE, NO C: DRIVE)
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_DIR, 'load_test/results');
const GRAPHS_DIR = path.join(PROJECT_DIR, 'load_test/graphs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {}
  return null;
}

// Generate an SVG Bar Chart
function renderBarChartSvg({ title, subtitle, xLabel, yLabel, data, width = 720, height = 380 }) {
  const padLeft = 90;
  const padBottom = 70;
  const padTop = 60;
  const padRight = 40;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxVal = Math.max(...data.map(d => d.value), 1) * 1.15;
  const barCount = data.length;
  const barW = Math.min(60, (chartW / (barCount || 1)) * 0.6);
  const gap = chartW / (barCount || 1);

  let barsSvg = '';
  data.forEach((d, i) => {
    const valH = (d.value / maxVal) * chartH;
    const x = padLeft + i * gap + (gap - barW) / 2;
    const y = padTop + (chartH - valH);

    barsSvg += `
      <rect x="${x}" y="${y}" width="${barW}" height="${valH}" rx="4" fill="url(#barGrad)" filter="url(#glow)">
        <title>${d.label}: ${d.value}</title>
      </rect>
      <text x="${x + barW / 2}" y="${y - 8}" fill="#38bdf8" font-size="12" font-weight="600" text-anchor="middle">${d.value}</text>
      <text x="${x + barW / 2}" y="${padTop + chartH + 20}" fill="#94a3b8" font-size="11" text-anchor="middle">${d.label}</text>
    `;
  });

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>
    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#0284c7" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#38bdf8" flood-opacity="0.3"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bgGrad)" rx="12" stroke="#334155" stroke-width="1.5" />

  <text x="${padLeft}" y="32" fill="#f8fafc" font-size="17" font-weight="700" font-family="system-ui, sans-serif">${title}</text>
  <text x="${padLeft}" y="50" fill="#94a3b8" font-size="12" font-family="system-ui, sans-serif">${subtitle}</text>

  <!-- Y Axis Grid -->
  <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + chartH}" stroke="#475569" stroke-width="1.5" />
  <line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="#475569" stroke-width="1.5" />

  <!-- Y axis label -->
  <text transform="rotate(-90)" x="${-(padTop + chartH / 2)}" y="25" fill="#94a3b8" font-size="12" text-anchor="middle" font-family="system-ui, sans-serif">${yLabel}</text>
  <text x="${padLeft + chartW / 2}" y="${height - 15}" fill="#94a3b8" font-size="12" text-anchor="middle" font-family="system-ui, sans-serif">${xLabel}</text>

  ${barsSvg}
</svg>`;
}

// Generate an SVG Line Chart
function renderLineChartSvg({ title, subtitle, xLabel, yLabel, data, width = 720, height = 380 }) {
  const padLeft = 90;
  const padBottom = 70;
  const padTop = 60;
  const padRight = 40;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxVal = Math.max(...data.map(d => d.value), 1) * 1.15;
  const stepX = chartW / Math.max(data.length - 1, 1);

  const points = data.map((d, i) => {
    const x = padLeft + i * stepX;
    const y = padTop + chartH - (d.value / maxVal) * chartH;
    return { x, y, value: d.value, label: d.label };
  });

  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x} ${padTop + chartH} L ${points[0].x} ${padTop + chartH} Z`;

  let pointsSvg = '';
  points.forEach(p => {
    pointsSvg += `
      <circle cx="${p.x}" cy="${p.y}" r="5" fill="#38bdf8" stroke="#0f172a" stroke-width="2" />
      <text x="${p.x}" y="${p.y - 10}" fill="#38bdf8" font-size="11" font-weight="600" text-anchor="middle">${p.value}</text>
      <text x="${p.x}" y="${padTop + chartH + 20}" fill="#94a3b8" font-size="11" text-anchor="middle">${p.label}</text>
    `;
  });

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>
    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35" />
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0" />
    </linearGradient>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bgGrad)" rx="12" stroke="#334155" stroke-width="1.5" />

  <text x="${padLeft}" y="32" fill="#f8fafc" font-size="17" font-weight="700" font-family="system-ui, sans-serif">${title}</text>
  <text x="${padLeft}" y="50" fill="#94a3b8" font-size="12" font-family="system-ui, sans-serif">${subtitle}</text>

  <!-- Axes -->
  <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + chartH}" stroke="#475569" stroke-width="1.5" />
  <line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="#475569" stroke-width="1.5" />

  <path d="${areaD}" fill="url(#areaGrad)" />
  <path d="${pathD}" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />

  ${pointsSvg}

  <text transform="rotate(-90)" x="${-(padTop + chartH / 2)}" y="25" fill="#94a3b8" font-size="12" text-anchor="middle" font-family="system-ui, sans-serif">${yLabel}</text>
  <text x="${padLeft + chartW / 2}" y="${height - 15}" fill="#94a3b8" font-size="12" text-anchor="middle" font-family="system-ui, sans-serif">${xLabel}</text>
</svg>`;
}

export function generateAllGraphs() {
  ensureDir(GRAPHS_DIR);

  const uploadSummary = readJsonSafe(path.join(RESULTS_DIR, 'upload_summary.json'));
  const librarySummary = readJsonSafe(path.join(RESULTS_DIR, 'library_summary.json'));
  const collageSummary = readJsonSafe(path.join(RESULTS_DIR, 'collage_summary.json'));
  const customizationSummary = readJsonSafe(path.join(RESULTS_DIR, 'customization_summary.json'));
  const savedSummary = readJsonSafe(path.join(RESULTS_DIR, 'saved_summary.json'));
  const loadSummary = readJsonSafe(path.join(RESULTS_DIR, 'load_page_summary.json'));

  // 1. Upload Page Graphs
  if (uploadSummary && uploadSummary.results) {
    const throughputData = uploadSummary.results.map(r => ({ label: `${r.scale} files`, value: r.throughputFilesPerSec }));
    fs.writeFileSync(
      path.join(GRAPHS_DIR, 'upload_throughput_vs_scale.svg'),
      renderBarChartSvg({
        title: 'Upload Page — Processing Throughput vs Scale',
        subtitle: 'Peak throughput in files/second for .dump.pgm and .tip files',
        xLabel: 'Upload Batch Scale (Files)',
        yLabel: 'Throughput (files/sec)',
        data: throughputData,
      })
    );

    const latencyData = uploadSummary.results.map(r => ({ label: `${r.scale} files`, value: r.avgProcessingTimePerFileMs }));
    fs.writeFileSync(
      path.join(GRAPHS_DIR, 'upload_avg_latency_vs_scale.svg'),
      renderLineChartSvg({
        title: 'Upload Page — Avg Processing Latency per File',
        subtitle: 'Milliseconds per file processed through python worker pipeline',
        xLabel: 'Upload Batch Scale (Files)',
        yLabel: 'Avg Time (ms)',
        data: latencyData,
      })
    );
  }

  // 2. Library Page Graph
  if (librarySummary && librarySummary.results) {
    const libraryQps = librarySummary.results.map(r => ({ label: `${r.concurrentTabs} tabs`, value: r.queriesPerSecond }));
    fs.writeFileSync(
      path.join(GRAPHS_DIR, 'library_qps_vs_tabs.svg'),
      renderBarChartSvg({
        title: 'Library Page — Queries Per Second vs Concurrent Tabs',
        subtitle: 'Paginated item fetching under concurrent simulated users',
        xLabel: 'Concurrent Tabs',
        yLabel: 'Queries / Sec (QPS)',
        data: libraryQps,
      })
    );
  }

  // 3. Collage Page Graph
  if (collageSummary && collageSummary.results) {
    const collageThroughput = collageSummary.results.map(r => ({ label: `${r.scale} combos`, value: r.throughputCombosPerSec }));
    fs.writeFileSync(
      path.join(GRAPHS_DIR, 'collage_throughput_vs_scale.svg'),
      renderBarChartSvg({
        title: 'Collage Page — Layout Save Throughput',
        subtitle: 'Combinatorial layouts saved per second through disk queue',
        xLabel: 'Scale (Combinations)',
        yLabel: 'Throughput (layouts/sec)',
        data: collageThroughput,
      })
    );
  }

  // 4. Customization Page Graph
  if (customizationSummary && customizationSummary.results) {
    const customLatency = customizationSummary.results.map(r => ({ label: `${r.scale} reqs`, value: r.avgRenderLatencyMs }));
    fs.writeFileSync(
      path.join(GRAPHS_DIR, 'customization_latency_vs_scale.svg'),
      renderLineChartSvg({
        title: 'Customization Page — Preview Render Latency',
        subtitle: 'Milliseconds per interactive canvas scene preview',
        xLabel: 'Concurrent Preview Requests',
        yLabel: 'Avg Render Time (ms)',
        data: customLatency,
      })
    );
  }

  // 5. Cross-Page Peak Throughput Comparison
  const crossPageData = [
    { label: 'Upload (files/s)', value: uploadSummary?.peakThroughputFilesPerSec || 0 },
    { label: 'Library (QPS)', value: librarySummary?.peakQpsAchieved || 0 },
    { label: 'Collage (combos/s)', value: collageSummary?.peakThroughputCombosPerSec || 0 },
    { label: 'Custom (renders/s)', value: customizationSummary?.peakThroughputRendersPerSec || 0 },
    { label: 'Saved (QPS)', value: savedSummary?.peakQpsAchieved || 0 },
    { label: 'Load (combos/s)', value: loadSummary?.peakThroughputCombosPerSec || 0 },
  ];

  fs.writeFileSync(
    path.join(GRAPHS_DIR, 'all_pages_peak_throughput.svg'),
    renderBarChartSvg({
      title: 'Cross-Page Peak Throughput Comparison',
      subtitle: 'Peak operations per second achieved across all 6 application pages',
      xLabel: 'Application Page',
      yLabel: 'Peak Operations / Sec',
      data: crossPageData,
    })
  );

  // 6. Interactive HTML Dashboard
  const htmlDashboard = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Synthetic X-Ray Load Test Report & Dashboard</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #131b2e;
      --border: #22304d;
      --text: #f1f5f9;
      --subtext: #94a3b8;
      --accent: #38bdf8;
      --green: #22c55e;
      --orange: #f59e0b;
      --red: #ef4444;
    }
    body {
      margin: 0;
      padding: 32px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.3);
      margin-right: 8px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .card h3 { margin: 0 0 16px; font-size: 16px; color: var(--accent); }
    .metric { font-size: 32px; font-weight: 700; margin: 4px 0 12px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-top: 12px;
    }
    th, td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th { color: var(--subtext); font-weight: 600; }
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 24px;
    }
    .chart-box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      text-align: center;
    }
    .chart-box img { max-width: 100%; height: auto; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Synthetic X-Ray Load Test Report</h1>
    <div>
      <span class="badge">B: Drive Only (B:\\xray)</span>
      <span class="badge">Date: ${new Date().toISOString().split('T')[0]}</span>
      <span class="badge">Node v24.15.0</span>
      <span class="badge">8 Cores / 12 Threads</span>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>Upload Page (.dump.pgm & .tip)</h3>
      <div class="metric">${uploadSummary?.peakUploadsAchieved || 0} <span style="font-size: 14px; font-weight: normal; color: var(--subtext);">peak files</span></div>
      <div><strong>Peak Throughput:</strong> ${uploadSummary?.peakThroughputFilesPerSec || 0} files/sec</div>
      <div><strong>Avg Time / File:</strong> ${uploadSummary?.overallAvgProcessingTimePerFileMs || 0} ms</div>
      <div><strong>Known Limits:</strong> 100 MB/file, 5,000 files/batch, 8 workers cap</div>
    </div>

    <div class="card">
      <h3>Library Page (Pagination & Search)</h3>
      <div class="metric">${librarySummary?.peakQpsAchieved || 0} <span style="font-size: 14px; font-weight: normal; color: var(--subtext);">QPS</span></div>
      <div><strong>Max Concurrent Tabs:</strong> ${librarySummary?.peakConcurrentTabsSupported || 0} tabs</div>
      <div><strong>Avg Latency:</strong> ${librarySummary?.overallAvgQueryTimeMs || 0} ms</div>
      <div><strong>Known Limits:</strong> 50 req/s, 30 concurrent</div>
    </div>

    <div class="card">
      <h3>Collage Page (Combinations & Layouts)</h3>
      <div class="metric">${collageSummary?.peakThroughputCombosPerSec || 0} <span style="font-size: 14px; font-weight: normal; color: var(--subtext);">combos/sec</span></div>
      <div><strong>Peak Saved:</strong> ${collageSummary?.peakCombinationsSaved || 0} combos</div>
      <div><strong>Avg Time / Layout:</strong> ${collageSummary?.overallAvgTimePerLayoutMs || 0} ms</div>
      <div><strong>Known Limits:</strong> 200ms disk queue debounce, 5000/partition</div>
    </div>

    <div class="card">
      <h3>Customization Page (Preview Rendering)</h3>
      <div class="metric">${customizationSummary?.peakThroughputRendersPerSec || 0} <span style="font-size: 14px; font-weight: normal; color: var(--subtext);">renders/sec</span></div>
      <div><strong>Peak Previews:</strong> ${customizationSummary?.peakPreviewsRendered || 0}</div>
      <div><strong>Avg Latency:</strong> ${customizationSummary?.overallAvgRenderLatencyMs || 0} ms</div>
      <div><strong>Known Limits:</strong> 20 req/s, 10 concurrent</div>
    </div>

    <div class="card">
      <h3>Saved Page (Filtered Layouts)</h3>
      <div class="metric">${savedSummary?.peakQpsAchieved || 0} <span style="font-size: 14px; font-weight: normal; color: var(--subtext);">QPS</span></div>
      <div><strong>Peak Queries:</strong> ${savedSummary?.peakQueriesExecuted || 0}</div>
      <div><strong>Avg Latency:</strong> ${savedSummary?.overallAvgQueryLatencyMs || 0} ms</div>
      <div><strong>Known Limits:</strong> 50 req/s, 30 concurrent</div>
    </div>

    <div class="card">
      <h3>Load Page (Combination Pipeline)</h3>
      <div class="metric">${loadSummary?.peakThroughputCombosPerSec || 0} <span style="font-size: 14px; font-weight: normal; color: var(--subtext);">combos/sec</span></div>
      <div><strong>Peak Combinations:</strong> ${loadSummary?.peakCombinationsExported || 0}</div>
      <div><strong>Avg Latency:</strong> ${loadSummary?.overallAvgTimePerComboMs || 0} ms</div>
      <div><strong>Known Limits:</strong> 10,000 combos max, dual-res export</div>
    </div>
  </div>

  <h2>Generated Performance Visualizations</h2>
  <div class="charts-grid">
    <div class="chart-box">
      <img src="all_pages_peak_throughput.svg" alt="Cross-Page Peak Throughput" />
    </div>
    <div class="chart-box">
      <img src="upload_throughput_vs_scale.svg" alt="Upload Throughput" />
    </div>
    <div class="chart-box">
      <img src="upload_avg_latency_vs_scale.svg" alt="Upload Latency" />
    </div>
    <div class="chart-box">
      <img src="library_qps_vs_tabs.svg" alt="Library QPS" />
    </div>
    <div class="chart-box">
      <img src="collage_throughput_vs_scale.svg" alt="Collage Throughput" />
    </div>
    <div class="chart-box">
      <img src="customization_latency_vs_scale.svg" alt="Customization Latency" />
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(GRAPHS_DIR, 'dashboard.html'), htmlDashboard);
  console.log('[GRAPHS] Generated all SVG graphs and interactive HTML dashboard in', GRAPHS_DIR);
}

if (process.argv[1]?.endsWith('generate_graphs.mjs')) {
  generateAllGraphs();
}
