import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { PredictionStore, predictionDirectory } from '../lib/prediction-store';
import { planReleases, type PredictionSchedule } from '../lib/prediction-schedule';
import { runPredictionRelease } from '../lib/prediction-worker';
import { publication } from '../lib/prediction-publication';
import { fetchOfficialEvidence } from '../lib/prediction-evidence';
import { isMissingStorageObject } from '../lib/prediction-storage-errors';
import type { DashboardData } from '../lib/fpl-data';
import type { AnalyticsData } from '../lib/analytics-data';
import type { EnrichmentData } from '../lib/enrichment-data';

nextEnv.loadEnvConfig(process.cwd());
// Deliberately refuse local execution against the shared production store.
if (process.env.GITHUB_ACTIONS!=='true') throw new Error('Cloud publishing runs only in GitHub Actions.');
const key=process.env.TYPESAFE_API_KEY;
if (!key || key==='replace_with_your_api_key') { console.log('TYPESAFE_API_KEY not configured; no paid requests.'); process.exit(0); }
const url=process.env.SUPABASE_URL, secret=process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error('Supabase repository secrets required');
const client=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const bucket=process.env.SUPABASE_STORAGE_BUCKET || 'betterfpl-cache';
const bucketInfo=await client.storage.getBucket(bucket);
if (bucketInfo.error || !bucketInfo.data || bucketInfo.data.public) throw new Error('Prediction checkpoints require an existing PRIVATE Supabase bucket.');
const storage=client.storage.from(bucket);
const json=async <T,>(path:string):Promise<T>=>JSON.parse(await readFile(path,'utf8'));
async function run(command:string,args:string[]) {
  await new Promise<void>((accept,reject)=>{ const child=spawn(command,args,{stdio:'inherit'}); child.on('error',reject); child.on('exit',code=>code===0?accept():reject(new Error('Data refresh failed'))); });
}
async function upload(path:string,bytes:Uint8Array|string,upsert=true) {
  const {error}=await storage.upload(path,bytes,{upsert,contentType:path.endsWith('.json')?'application/json':'application/octet-stream',cacheControl:'0'});
  if (error) throw error;
}
await run(process.execPath,['scripts/refresh-fpl.mjs']);
const schedule=await json<PredictionSchedule>(resolve(predictionDirectory(),'schedule.json'));
const directory=resolve(predictionDirectory(),'cloud');
await mkdir(directory,{recursive:true});
const {data,error}=await storage.download('predictions/private/state.sqlite');
if (error && !await isMissingStorageObject(error)) throw error;
if (data) await writeFile(resolve(directory,'predictions.sqlite'),new Uint8Array(await data.arrayBuffer()));
const store=await PredictionStore.open(directory,bytes=>upload('predictions/private/state.sqlite',bytes));
try {
  const due=planReleases(schedule).filter(r=>store.get<{status:string}>('releases',r.id)?.status!=='complete');
  for (const release of due) {
    const objectId=release.id.replace(/[^A-Za-z0-9_-]/g,'-');
    const claimPath=`predictions/private/claims/${objectId}.json`;
    // Check claims before refreshing analytics. Only a missing object permits work.
    const claim=await storage.download(claimPath);
    if (claim.data) { console.log(`${release.id}: already claimed; no new requests.`); continue; }
    if (claim.error && !await isMissingStorageObject(claim.error)) throw claim.error;
    await run(process.env.PREDICTION_PYTHON || 'python',['scripts/refresh-analytics.py']);
    await run(process.env.PREDICTION_PYTHON || 'python',['scripts/refresh-enrichment.py']);
    const [fpl,analytics,enrichment]=await Promise.all([json<DashboardData>('public/fpl-data.json'),json<AnalyticsData>('public/analytics-data.json'),json<EnrichmentData>('public/enrichment-data.json')]);
    if (fpl.source!=='live' || analytics.season!==schedule.season || !Number.isFinite(Date.parse(analytics.fetchedAt)) || Date.now()-Date.parse(analytics.fetchedAt)>36*3600000) throw new Error('Fresh same-season data required');
    let evidence: Awaited<ReturnType<typeof fetchOfficialEvidence>>=[];
    try { evidence=await fetchOfficialEvidence(fpl); } catch { console.warn('Official headlines unavailable; using numerical evidence.'); }
    // Atomic create, NEVER overwrite. Even a cancelled runner cannot re-buy this release.
    await upload(claimPath,JSON.stringify({release:release.id,run:process.env.GITHUB_RUN_ID,claimedAt:new Date().toISOString()}),false);
    let failed=false;
    try {
      const record=await runPredictionRelease(store,release,{fpl,analytics,enrichment,evidence},{maxTokens:Number(process.env.PREDICTION_MAX_TOKENS || 500000)});
      failed=record.status!=='complete';
      console.log(`${release.id}: ${record.status}`);
    } finally {
      const bundle=publication(store,schedule.season,release.gameweek,fpl.fixtures.filter(f=>f.event===release.gameweek));
      await upload(`predictions/releases/${objectId}.json`,JSON.stringify(bundle));
      await upload('predictions/latest.json',JSON.stringify(bundle));
    }
    if (failed) throw new Error('Prediction release incomplete; held to prevent duplicate charges. Review workflow logs/private checkpoints.');
  }
} finally { store.close(); }
