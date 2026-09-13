import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cloudDatasetFiles, readCloudDataset, type CloudDataset } from '@/lib/cloud-data';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ dataset: string }> },
) {
  const { dataset } = await context.params;
  if (!(dataset in cloudDatasetFiles)) {
    return Response.json({ error: 'Unknown dataset' }, { status: 404 });
  }

  let body: string;
  let source = 'supabase';
  try {
    body = await readCloudDataset(dataset as CloudDataset);
  } catch (error) {
    source = 'bundled-fallback';
    try {
      body = await readFile(join(process.cwd(), 'public', cloudDatasetFiles[dataset as CloudDataset]), 'utf8');
    } catch {
      console.error('BetterFPL data unavailable', error);
      return Response.json({ error: 'Dashboard data is temporarily unavailable' }, {
        status: 503,
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      });
    }
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'X-BetterFPL-Data-Source': source,
    },
  });
}
