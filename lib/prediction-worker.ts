import type { PredictionInput, FixturePrediction } from './prediction-engine';
import { preparePrediction, evaluatePrediction, QUESTION_VERSION, MODEL, type PreparedPrediction } from './prediction-model';
import { PredictionStore } from './prediction-store';
import type { PredictionRelease } from './prediction-schedule';

export type ReleaseRecord = PredictionRelease & { status:'running' | 'complete' | 'partial'; checkedAt:string; questionVersion:string; errors:string[] };
export type SavedFixture = { releaseId:string; fixtureId:number; status:'sending' | 'complete' | 'failed' | 'uncertain' | 'skipped'; result?:FixturePrediction; error?:string; diagnostic?:{name:string;status?:number;requestId?:string;message:string}; request?:PreparedPrediction['payload']; estimatedTokens?:number; checkedAt:string };
export function predictionDiagnostic(error:unknown):NonNullable<SavedFixture['diagnostic']> {
  const e=error as {name?:string;status?:number;requestId?:string;message?:string};
  let message=typeof e?.message==='string'?e.message:'Unknown prediction failure';
  for(const key of ['TYPESAFE_API_KEY','SUPABASE_SECRET_KEY','BETTERFPL_SUPABASE_KEY']) {
    const secret=process.env[key];if(secret)message=message.split(secret).join('[REDACTED]');
  }
  message=message.replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').slice(0,4000);
  return {name:e?.name??'Error',status:e?.status,requestId:e?.requestId,message};
}
export async function runPredictionRelease(store: PredictionStore, release: PredictionRelease, input: Omit<PredictionInput,'fixtureId'>,
  options: { evaluate?:(prepared:PreparedPrediction)=>Promise<FixturePrediction>; now?:()=>number; maxTokens?:number; retryFailed?:boolean; maxFixtures?:number } = {}) {
  const now = options.now ?? Date.now;
  if (input.fpl.source!=='live' || !Number.isFinite(options.maxTokens ?? 500000) || (options.maxTokens ?? 500000)<1) throw new Error('Live data and a valid token budget are required');
  const existing = store.get<ReleaseRecord>('releases',release.id);
  if (existing?.status==='complete') return existing;
  const record: ReleaseRecord = { ...release,status:'running',checkedAt:new Date(now()).toISOString(),questionVersion:QUESTION_VERSION,errors:[] };
  store.put('releases',release.id,record); await store.save();
  let spent = store.all<SavedFixture>('fixtures').filter(item=>item.releaseId===release.id && item.request).reduce((sum,item)=>sum+(item.estimatedTokens ?? 0),0);
  let evaluated = 0;
  for (const fixtureId of release.fixtureIds) {
    const key = `${release.id}:${fixtureId}`;
    const saved = store.get<SavedFixture>('fixtures',key);
    if (saved?.status==='complete') continue;
    if (saved && ['sending','uncertain'].includes(saved.status)) { record.errors.push(`${fixtureId}: previous request may have been charged; operator review required`); continue; }
    if (saved?.status==='failed' && !options.retryFailed) { record.errors.push(`${fixtureId}: failed request requires an explicit retry`); continue; }
    const fixture = input.fpl.fixtures.find(f=>f.id===fixtureId && f.event===release.gameweek);
    const checkedAt = new Date(now()).toISOString();
    if (!fixture?.kickoff || Date.parse(fixture.kickoff)<=now()) { store.put('fixtures',key,{releaseId:release.id,fixtureId,status:'skipped',error:'Fixture already started or no longer scheduled',checkedAt}); await store.save(); continue; }
    const prepared = preparePrediction({...input,fixtureId},fixture,now());
    const cached = store.get<FixturePrediction>('cache',`${MODEL}:${QUESTION_VERSION}:${prepared.fingerprint}`);
    if (cached) {
      store.put('fixtures',key,{releaseId:release.id,fixtureId,status:'complete',checkedAt,result:{...cached,release:release.stage,checkedAt,reused:true}}); await store.save(); continue;
    }
    const estimatedTokens = Math.ceil(prepared.stateBytes / 2)+prepared.questionCount*30;
    if (spent+estimatedTokens>(options.maxTokens ?? 500000) || evaluated>=(options.maxFixtures ?? 20)) { record.errors.push(`${fixtureId}: release budget limit reached`); break; }
    // Persist before calling: an interrupted worker cannot blindly re-charge a request.
    const item: SavedFixture = {releaseId:release.id,fixtureId,status:'sending',request:prepared.payload,estimatedTokens,checkedAt};
    store.put('fixtures',key,item); await store.save();
    spent+=estimatedTokens; evaluated++;
    try {
      const result = await (options.evaluate ?? evaluatePrediction)(prepared);
      store.put('cache',`${MODEL}:${QUESTION_VERSION}:${prepared.fingerprint}`,result);
      store.put('fixtures',key,{...item,status:'complete',result:{...result,release:release.stage,checkedAt,reused:false}}); await store.save();
    } catch(error) {
      const status = (error as {status?:number}).status;
      const definite = status && [400,401,403,404,422,429].includes(status);
      const message = definite ? `Provider rejected request (HTTP ${status}); explicit retry required.` : 'Request outcome uncertain; may have been charged. Review before retrying.';
      store.put('fixtures',key,{...item,status:definite?'failed':'uncertain',error:message,diagnostic:predictionDiagnostic(error)}); await store.save();
      record.errors.push(`${fixtureId}: ${message}`); break;
    }
  }
  const items = release.fixtureIds.map(id=>store.get<SavedFixture>('fixtures',`${release.id}:${id}`));
  record.status = items.every(item=>item && ['complete','skipped'].includes(item.status)) ? 'complete' : 'partial';
  record.checkedAt=new Date(now()).toISOString();
  store.put('releases',release.id,record); await store.save(); return record;
}
