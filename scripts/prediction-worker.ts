import nextEnv from '@next/env';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { PredictionStore, lockPredictions, predictionDirectory } from '../lib/prediction-store';
import { planReleases, type PredictionSchedule } from '../lib/prediction-schedule';
import { fetchOfficialEvidence, validateEvidence } from '../lib/prediction-evidence';
import { runPredictionRelease, type SavedFixture } from '../lib/prediction-worker';
import type { DashboardData } from '../lib/fpl-data';
import type { AnalyticsData } from '../lib/analytics-data';
import type { EnrichmentData } from '../lib/enrichment-data';

nextEnv.loadEnvConfig(process.cwd());
const args = new Set(process.argv.slice(2));
const json = async <T,>(path: string): Promise<T> => JSON.parse(await readFile(path,'utf8'));
function run(command: string, parameters: string[]) {
  return new Promise<void>((resolveRun,reject) => {
    const child = spawn(command,parameters,{stdio:'inherit',windowsHide:true});
    child.on('error',reject); child.on('exit',code=>code===0?resolveRun():reject(new Error(`Data refresh failed (${code})`)));
  });
}
async function tick() {
  if (args.has('--plan')) {
    const schedule = await json<PredictionSchedule>(resolve(predictionDirectory(),'schedule.json'));
    console.log(JSON.stringify({due:planReleases(schedule),note:'Read-only plan; no refresh and no Jev calls.'},null,2)); return;
  }
  if (!args.has('--dry-run') && (!process.env.TYPESAFE_API_KEY || process.env.TYPESAFE_API_KEY==='replace_with_your_api_key')) { console.log('Prediction worker awaiting TYPESAFE_API_KEY; no paid calls.'); return; }
  const unlock = await lockPredictions();
  let store: PredictionStore | undefined;
  try {
    store = await PredictionStore.open();
    await run(process.execPath,['scripts/refresh-fpl.mjs']);
    const schedule = await json<PredictionSchedule>(resolve(predictionDirectory(),'schedule.json'));
    if (!Number.isFinite(Date.parse(schedule.fetchedAt)) || Date.now()-Date.parse(schedule.fetchedAt)>60*60*1000) throw new Error('Schedule data is stale');
    const due = planReleases(schedule).filter(release=>store!.get<{status:string}>('releases',release.id)?.status!=='complete'
      && !store!.all<SavedFixture>('fixtures').some(item=>item.releaseId===release.id && (['sending','uncertain'].includes(item.status) || (item.status==='failed' && !args.has('--retry-failed')))));
    const status = {checkedAt:new Date().toISOString(),due:due.map(r=>r.id),message:due.length?'Release due':'No release due; saved predictions unchanged'};
    store.put('status','worker',status); await store.save();
    if (args.has('--dry-run')) { console.log(JSON.stringify({ ...status,releases:due,note:'Dry run; no model requests.' },null,2)); return; }
    if (!due.length) return;
    const python = process.env.PREDICTION_PYTHON || resolve('.venv','Scripts','python.exe');
    await run(python,['scripts/refresh-analytics.py']); await run(python,['scripts/refresh-enrichment.py']);
    const [fpl,analytics,enrichment,manual] = await Promise.all([
      json<DashboardData>('public/fpl-data.json'),json<AnalyticsData>('public/analytics-data.json'),json<EnrichmentData>('public/enrichment-data.json'),json<{observations:unknown}>('prediction-evidence.json'),
    ]);
    if (fpl.source!=='live' || !Number.isFinite(Date.parse(fpl.fetchedAt)) || Date.now()-Date.parse(fpl.fetchedAt)>6*60*60*1000 || !Number.isFinite(Date.parse(analytics.fetchedAt)) || Date.now()-Date.parse(analytics.fetchedAt)>36*60*60*1000 || analytics.season!==schedule.season) throw new Error('Fresh, same-season FPL/analytics data required');
    const observations = validateEvidence(manual.observations);
    let news;
    try { news=await fetchOfficialEvidence(fpl); store.put('evidence','official',{items:news,fetchedAt:new Date().toISOString()}); await store.save(); }
    catch { news=store.get<{items:ReturnType<typeof validateEvidence>}>('evidence','official')?.items ?? []; console.warn('Official news unavailable; using only unexpired saved reporting and observations.'); }
    const maxTokens=Number(process.env.PREDICTION_MAX_TOKENS || 500000);
    if (!Number.isFinite(maxTokens) || maxTokens<1) throw new Error('PREDICTION_MAX_TOKENS must be a positive number');
    for (const release of due) {
      const record=await runPredictionRelease(store,release,{fpl,analytics,enrichment,evidence:[...observations,...news]}, {maxTokens,retryFailed:args.has('--retry-failed')});
      console.log(`${record.id}: ${record.status}${record.errors.length?` — ${record.errors.join('; ')}`:''}`);
    }
    store.put('status','worker',{checkedAt:new Date().toISOString(),message:'Finished scheduled check'}); await store.save();
  } catch(error) {
    if (store) { store.put('status','worker',{checkedAt:new Date().toISOString(),error:error instanceof Error?error.message:'Worker failed'}); await store.save(); }
    throw error;
  } finally { store?.close(); await unlock(); }
}
let stopped=false;
process.on('SIGINT',()=>{stopped=true;}); process.on('SIGTERM',()=>{stopped=true;});
do {
  try { await tick(); } catch(error) { console.error(error instanceof Error?error.message:'Prediction worker failed'); if (!args.has('--watch')) process.exitCode=1; }
  if (!args.has('--watch') || stopped) break;
  for (let second=0;second<15*60 && !stopped;second++) await delay(1000);
} while (!stopped);
