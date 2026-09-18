import { cloudDatasetFiles, type CloudDataset } from '@/lib/cloud-data';
import { readDataset } from '@/lib/dashboard-snapshot';

export const revalidate = 300;

export async function GET(
  _request: Request,
  context: { params: Promise<{ dataset: string }> },
) {
  const { dataset } = await context.params;
  if (!Object.hasOwn(cloudDatasetFiles, dataset)) {
    return Response.json({ error: 'Unknown dataset' }, { status: 404 });
  }

  let body: string;
  let source = 'supabase';
  try {
    ({ body, source } = await readDataset(dataset as CloudDataset));
  } catch (error) {
    console.error('BetterFPL data unavailable', error);
    return Response.json({ error: 'Dashboard data is temporarily unavailable' }, {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': source === 'supabase'
        ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=300'
        : 'private, no-store, max-age=0',
      'X-BetterFPL-Data-Source': source,
    },
  });
}
