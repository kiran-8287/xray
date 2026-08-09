const fs = require('fs');
const data = JSON.parse(fs.readFileSync('backend/data/storage/threats_1.json', 'utf8'));
console.log(JSON.stringify(data[0], null, 2));
