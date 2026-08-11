import http from 'http';

const endpoints = [
  '/api/health',
  '/api/items/ids',
  '/api/items/categorized',
  '/api/user-config/exports-path',
];

for (const path of endpoints) {
  await new Promise((resolve) => {
    const req = http.request({ hostname: 'localhost', port: 8080, path, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`GET ${path} => ${res.statusCode}`);
        console.log(data.substring(0, 300));
        console.log('---');
        resolve();
      });
    });
    req.on('error', (err) => {
      console.log(`GET ${path} => ERROR: ${err.message}`);
      console.log('---');
      resolve();
    });
    req.end();
  });
}
