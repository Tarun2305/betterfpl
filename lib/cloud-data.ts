import { createClient } from '@supabase/supabase-js';
import { isMissingStorageObject } from './prediction-storage-errors';

export const cloudDatasetFiles = {
  fpl: 'fpl-data.json',
  analytics: 'analytics-data.json',
  enrichment: 'enrichment-data.json',
} as const;

export type CloudDataset = keyof typeof cloudDatasetFiles;

type SnapshotManifest = {
  snapshot: string;
  generatedAt: string;
};

function createStorageClient(customFetch?: typeof fetch) {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new Error('Supabase cloud cache is not configured');
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(customFetch ? { global: { fetch: customFetch } } : {}),
  });
}

async function downloadText(path: string) {
  const client = createStorageClient((input, init) => fetch(input, {
    ...init,
    cache: 'force-cache',
    // Snapshot files are immutable; only the current pointer needs polling.
    next: { revalidate: path === 'current.json' ? 300 : 86400 },
  }));
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'betterfpl-cache';
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error || !data) throw error || new Error(`Cloud object ${path} was empty`);
  return data.text();
}

export async function readCloudPredictions() {
  const client=createStorageClient();
  const {data,error}=await client.storage.from(process.env.SUPABASE_STORAGE_BUCKET || 'betterfpl-cache').download('predictions/latest.json');
  if (await isMissingStorageObject(error)) return {predictions:{},gameweek:null,message:'Awaiting the first scheduled predictions.'};
  if (error || !data) throw error || new Error('Prediction cache unavailable');
  return JSON.parse(await data.text());
}

export async function readCloudDataset(dataset: CloudDataset) {
  const manifest = JSON.parse(await downloadText('current.json')) as SnapshotManifest;
  if (!/^snapshots\/[A-Za-z0-9._-]+$/.test(manifest.snapshot)) {
    throw new Error('The cloud snapshot pointer is invalid');
  }
  return downloadText(`${manifest.snapshot}/${cloudDatasetFiles[dataset]}`);
}
