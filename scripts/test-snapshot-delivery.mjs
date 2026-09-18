import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Run after npm run build. Uses an isolated mock Storage service, not production credentials.
const files = ['fpl-data.json', 'analytics-data.json', 'enrichment-data.json'];
const payloads = new Map(await Promise.all(files.map(async (file) => [file, await readFile(`public/${file}`, 'utf8')])));
const reads = new Map();
let unavailable = false;
const storage = createServer((request, response) => {
  const path = decodeURIComponent(request.url).split('/betterfpl-cache/')[1];
  reads.set(path, (reads.get(path) || 0) + 1);
  response.setHeader('Content-Type', 'application/json');
  if (unavailable) {
    response.writeHead(503).end(JSON.stringify({ message: 'Storage unavailable' }));
  } else if (path === 'current.json') {
    response.end(JSON.stringify({ snapshot: 'snapshots/test-release', generatedAt: '2026-09-18T00:00:00Z' }));
  } else if (payloads.has(path?.split('/').at(-1))) {
    response.end(payloads.get(path.split('/').at(-1)));
  } else {
    response.writeHead(404).end('{}');
  }
});
storage.listen(0, '127.0.0.1');
await once(storage, 'listening');
const portFinder = createServer();
portFinder.listen(0, '127.0.0.1');
await once(portFinder, 'listening');
const port = portFinder.address().port;
await new Promise((resolve) => portFinder.close(resolve));
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
  env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${storage.address().port}`, SUPABASE_SECRET_KEY: 'test-only', SUPABASE_STORAGE_BUCKET: 'betterfpl-cache' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
app.stdout.on('data', (chunk) => { output += chunk; });
app.stderr.on('data', (chunk) => { output += chunk; });
try {
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Preview did not start: ${output}`)), 15000);
    const onOutput = () => {
      if (output.includes('Ready in')) { clearTimeout(deadline); resolve(); }
    };
    app.stdout.on('data', onOutput);
    app.once('exit', (code) => { clearTimeout(deadline); reject(new Error(`Preview exited ${code}: ${output}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const homepage = await fetch(base);
  const html = await homepage.text();
  assert.equal(homepage.status, 200);
  assert.ok(html.includes(JSON.parse(payloads.get('fpl-data.json')).fetchedAt), 'Initial HTML includes the real saved snapshot');
  assert.ok(homepage.headers.get('cache-control').includes('s-maxage=300'), 'Homepage revalidates without a redeploy');
  const datasetResponse = await fetch(`${base}/api/data/fpl`);
  assert.equal(datasetResponse.headers.get('x-betterfpl-data-source'), 'supabase');
  assert.ok(datasetResponse.headers.get('cache-control').includes('s-maxage=300'));
  assert.deepEqual(await datasetResponse.json(), JSON.parse(payloads.get('fpl-data.json')));
  await fetch(`${base}/api/data/fpl`);
  await fetch(`${base}/api/data/analytics`);
  assert.equal(reads.get('current.json'), 1, 'The pointer is reused across requests and datasets');
  assert.equal(reads.get('snapshots/test-release/fpl-data.json'), 1, 'Immutable FPL data is reused');
  unavailable = true;
  const retained = await fetch(`${base}/api/data/fpl`);
  assert.equal(retained.headers.get('x-betterfpl-data-source'), 'supabase');
  assert.deepEqual(await retained.json(), JSON.parse(payloads.get('fpl-data.json')), 'A warm cache survives a storage outage');
  // Enrichment has not been cached: verify the offline path separately.
  const fallback = await fetch(`${base}/api/data/enrichment`);
  assert.equal(fallback.headers.get('x-betterfpl-data-source'), 'bundled-fallback');
  assert.ok(fallback.headers.get('cache-control').includes('no-store'), 'Fallback is not cached as current cloud data');
  assert.deepEqual(await fallback.json(), JSON.parse(payloads.get('enrichment-data.json')));
  assert.equal((await fetch(`${base}/api/data/toString`)).status, 404);
  console.log('Snapshot delivery checks passed: initial data, revalidation, shared cache, offline fallback and invalid datasets.');
} finally {
  app.kill();
  await new Promise((resolve) => storage.close(resolve));
}
