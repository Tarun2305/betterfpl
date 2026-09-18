import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cloudDatasetFiles, readCloudDataset, type CloudDataset } from './cloud-data';

export async function readDataset(dataset: CloudDataset) {
  try {
    return { body: await readCloudDataset(dataset), source: 'supabase' };
  } catch {
    // The bundled real snapshot is an offline fallback, never demonstration data.
    return {
      body: await readFile(join(process.cwd(), 'public', cloudDatasetFiles[dataset]), 'utf8'),
      source: 'bundled-fallback',
    };
  }
}
