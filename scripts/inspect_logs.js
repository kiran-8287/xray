// Inspect every file in logs/ : line counts, JSON validity, first/last lines,
// and the error counts per file. Also flag exact-duplicate prefixes so we know
// which files are copy-paste repetitions of the same underlying data.
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', 'logs');
const files = fs.readdirSync(dir).filter((f) => f.startsWith('m') || /monitoring/i.test(f));

const byTypeRaw = {}; // map raw line -> { file, lineNo }
const byTypeMin = {};  // map (type+method+route+status) -> count per file
const perFile = {};

for (const f of files) {
  const fp = path.join(dir, f);
  const stat = fs.statSync(fp);
  const raw = fs.readFileSync(fp, 'utf8');
  const lines = raw.split('\n');
  const cleaned = lines.filter((l) => l.trim());
  const info = {
    file: f,
    bytes: stat.size,
    lines_total: lines.length,
    lines_nonempty: cleaned.length,
    json_ok: 0,
    json_bad: [],
    types: {},
    finished: 0,
    statuses: {},
    errorLines: [],
    first: cleaned[0] ? cleaned[0].slice(0, 180) : '',
    last: cleaned[cleaned.length - 1] ? cleaned[cleaned.length - 1].slice(0, 180) : '',
    timeRange: ['', ''],
  };
  for (let i = 0; i < cleaned.length; i++) {
    const line = cleaned[i];
    let j = null;
    try { j = JSON.parse(line); } catch { /* not json */ }
    if (j && typeof j === 'object' && j.type) {
      info.json_ok++;
      const t = j.type;
      info.types[t] = (info.types[t] || 0) + 1;
      const ts = j.timestamp || j.startedAt || '';
      if (ts) {
        if (!info.timeRange[0] || ts < info.timeRange[0]) info.timeRange[0] = ts;
        if (ts > info.timeRange[1]) info.timeRange[1] = ts;
      }
      if (t === 'request_finished') {
        info.finished++;
        const st = j.status;
        if (st) info.statuses[st] = (info.statuses[st] || 0) + 1;
        if (st && st >= 400) {
          info.errorLines.push({ line: i + 1, ts, method: j.method, path: j.route || j.path, status: st });
        }
      }
    } else {
      info.json_bad.push({ line: i + 1, snippet: line.slice(0, 140) });
    }
  }
  info.errorCount = info.errorLines.length;
  perFile[f] = info;

  console.log(`\n===== ${f}  (${info.bytes} bytes, ${info.lines_total} total / ${info.lines_nonempty} non-empty lines)`);
  console.log(`  valid JSON entries: ${info.json_ok}  |  bad/non-JSON lines: ${info.json_bad.length}`);
  console.log(`  types: ${JSON.stringify(info.types)}`);
  console.log(`  request_finished: ${info.finished}  |  statuses: ${JSON.stringify(info.statuses)}`);
  console.log(`  time range: ${info.timeRange[0]}  ->  ${info.timeRange[1]}`);
  if (info.errorCount) {
    console.log(`  error responses: ${info.errorCount}`);
    for (const e of info.errorLines.slice(0, 12)) {
      console.log(`    L${e.line} ${e.ts} ${e.method} ${e.path} -> ${e.status}`);
    }
    if (info.errorLines.length > 12) console.log(`    ... and ${info.errorLines.length - 12} more`);
  }
  if (info.json_bad.length) {
    console.log(`  non-JSON samples:`);
    for (const b of info.json_bad.slice(0, 5)) console.log(`    L${b.line}: ${b.snippet}`);
  }
  console.log(`  first: ${info.first}`);
  console.log(`  last : ${info.last}`);
}