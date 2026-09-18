import type { FixturePrediction } from './prediction-engine';
import type { Fixture } from './fpl-data';
import type { PredictionStore } from './prediction-store';
import type { ReleaseRecord, SavedFixture } from './prediction-worker';

export function publication(store: PredictionStore, season: string, gameweek: number, fixtures: Fixture[]) {
  const releases=store.all<ReleaseRecord>('releases').filter(r=>r.season===season && r.gameweek===gameweek);
  const ids=new Set(releases.map(r=>r.id));
  const predictions: Record<number,FixturePrediction>={};
  for (const item of store.all<SavedFixture>('fixtures').filter(i=>ids.has(i.releaseId) && i.status==='complete' && i.result)
    .sort((a,b)=>a.checkedAt.localeCompare(b.checkedAt) || Number(a.releaseId.endsWith('pre-kickoff'))-Number(b.releaseId.endsWith('pre-kickoff')))) predictions[item.fixtureId]=item.result!;
  // Never publish raw requests, provider errors, checkpoints or credentials.
  return {season,gameweek,fixtures,predictions,generatedAt:new Date().toISOString(),message:Object.keys(predictions).length?'Latest saved predictions':'Awaiting scheduled predictions.'};
}
