import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'betterfpl-cache';
if (!url || !secretKey) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');

const files = ['fpl-data.json', 'analytics-data.json', 'enrichment-data.json'];
const payloads = new Map();
for (const file of files) {
  const body = await readFile(resolve('public', file));
  const parsed = JSON.parse(body.toString('utf8'));
  if (file === 'fpl-data.json' && (!Array.isArray(parsed.players) || parsed.players.length < 100 || parsed.teams?.length !== 20)) throw new Error('FPL snapshot failed validation');
  if (file === 'analytics-data.json' && !Array.isArray(parsed.matches)) throw new Error('Analytics snapshot failed validation');
  if (file === 'enrichment-data.json' && (!Array.isArray(parsed.whoScoredPlayers) || !Array.isArray(parsed.clubElo))) throw new Error('Enrichment snapshot failed validation');
  payloads.set(file, body);
}

const client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
const snapshot = `snapshots/${stamp}`;

for (const [file, body] of payloads) {
  const { error } = await client.storage.from(bucket).upload(`${snapshot}/${file}`, body, {
    contentType: 'application/json',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
}

const manifest = Buffer.from(JSON.stringify({ snapshot, generatedAt: new Date().toISOString() }));
const { error: manifestError } = await client.storage.from(bucket).upload('current.json', manifest, {
  contentType: 'application/json',
  cacheControl: '60',
  upsert: true,
});
if (manifestError) throw manifestError;
console.log(`Published BetterFPL cloud snapshot ${snapshot}.`);
