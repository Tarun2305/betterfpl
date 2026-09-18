import { readFile } from 'node:fs/promises';
import { upcomingFixtures } from '@/lib/prediction-engine';
import type { DashboardData } from '@/lib/fpl-data';
import { PredictionStore } from '@/lib/prediction-store';
import type { ReleaseRecord } from '@/lib/prediction-worker';
import { readCloudPredictions } from '@/lib/cloud-data';
import { publication } from '@/lib/prediction-publication';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
// Read-only by construction: no model imports, browser snapshots or POST handler.
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    try {
      return Response.json(await readCloudPredictions(), { headers });
    } catch {
      return Response.json(
        { error: 'Saved predictions are temporarily unavailable.' },
        { status: 503, headers },
      );
    }
  }
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)
  )
    return Response.json(
      { error: 'Local development only.' },
      { status: 403, headers },
    );
  let store: PredictionStore | undefined;
  try {
    const fpl = JSON.parse(
      await readFile('public/fpl-data.json', 'utf8'),
    ) as DashboardData;
    const analytics = JSON.parse(
      await readFile('public/analytics-data.json', 'utf8'),
    ) as { season: string };
    const fixtures = upcomingFixtures(fpl),
      event = fixtures[0]?.event ?? fpl.gameweek;
    store = await PredictionStore.open();
    const releases = store
      .all<ReleaseRecord>('releases')
      .filter((r) => r.season === analytics.season && r.gameweek === event);
    const { predictions } = publication(
      store,
      analytics.season,
      event ?? 0,
      fixtures,
    );
    return Response.json(
      {
        predictions,
        fixtures,
        gameweek: event,
        releases,
        worker: store.get('status', 'worker'),
        message: Object.keys(predictions).length
          ? 'Latest saved predictions'
          : 'Awaiting the background worker’s first predictions. No model calls are made by this page.',
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: 'Saved predictions are temporarily unavailable.' },
      { status: 503, headers },
    );
  } finally {
    store?.close();
  }
}
