// Simple port diagnostic script
// Usage: node diagnose-port.js [port]
// Defaults to process.env.PORT or 3001
const http = require('http');
const port = parseInt(process.argv[2] || process.env.PORT || '3001', 10);

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get({ hostname: 'localhost', port, path: '/health', timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        resolve({ ok: true, statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

(async () => {
  console.log('[Diagnose] Checking http://localhost:' + port + '/health');
  const result = await checkHealth();
  if (result.ok) {
    console.log('[Diagnose] Health endpoint reachable. Status:', result.statusCode);
    console.log('[Diagnose] Body:', result.body);
  } else {
    console.log('[Diagnose] Health check FAILED:', result.error);
    console.log('[Diagnose] Suggestions:');
    console.log('  - Ensure server is started: node app.js');
    console.log('  - Confirm no firewall blocking local requests');
    console.log('  - Check if another process already used the port');
  }
})();
