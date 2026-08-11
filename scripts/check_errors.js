const fs = require('fs');
const lines = fs.readFileSync('backend/monitoring.log', 'utf8').split('\n');
const errors = [];
for (const line of lines) {
  if (line.includes('"status":400') || line.includes('"status":500')) {
    const m = line.match(/"status":(\d+)/);
    if (m) {
      errors.push({ status: +m[1], line });
    }
  }
}
console.log('Total lines:', lines.length);
console.log('Errors found:', errors.length);
if (errors.length) {
  console.log('First 20 errors:');
  errors.slice(0, 20).forEach(e => console.log(e.status, e.line.slice(0, 200)));
}
