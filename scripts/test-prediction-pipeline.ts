import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleData } from '../lib/fpl-data';
import { emptyAnalytics } from '../lib/analytics-data';
import { emptyEnrichment } from '../lib/enrichment-data';
import { selectEvidence, type PredictionInput } from '../lib/prediction-engine';
import { planReleases, type PredictionSchedule } from '../lib/prediction-schedule';
import { preparePrediction, validatePrediction, type PreparedPrediction } from '../lib/prediction-model';
import { PredictionStore, lockPredictions } from '../lib/prediction-store';
import { runPredictionRelease, type SavedFixture } from '../lib/prediction-worker';
import { validateEvidence } from '../lib/prediction-evidence';
import { createClient } from '@supabase/supabase-js';
import { isMissingStorageObject } from '../lib/prediction-storage-errors';

const now=Date.parse('2026-09-18T06:00:00Z');

test('installed storage SDK missing-download wrapper is distinguished from real failures',async()=>{
  for (const [statusCode,message,missing] of [['404','Object not found',true],['404','Bucket not found',false],['403','Access denied',false],['500','Internal error',false]] as const) {
    const client=createClient('https://example.supabase.co','test-only-key',{global:{fetch:async()=>new Response(JSON.stringify({statusCode,message}),{status:400,headers:{'Content-Type':'application/json'}})}});
    const {error}=await client.storage.from('test').download('missing.json');
    assert.ok(error);
    assert.equal(await isMissingStorageObject(error),missing);
  }
  assert.equal(await isMissingStorageObject(new Error('network unavailable')),false);
  assert.equal(await isMissingStorageObject({statusCode:'404',message:'Object not found'}),true);
});
const fixture={...sampleData.fixtures[1],id:42,event:5,kickoff:'2026-09-19T15:00:00Z'};
const input:PredictionInput={fpl:{...sampleData,source:'live',fixtures:[fixture],gameweek:4},analytics:emptyAnalytics,enrichment:emptyEnrichment,fixtureId:fixture.id};
const schedule:PredictionSchedule={season:'2026/27',fetchedAt:new Date(now).toISOString(),events:[{id:4,finished:true,dataChecked:true}],fixtures:[{id:1,event:4,kickoff:'2026-09-16T15:00:00Z',started:true,finished:true},{id:42,event:5,kickoff:fixture.kickoff,started:false,finished:false}]};
function mock(prepared:PreparedPrediction) {
  const probabilities=Object.fromEntries(Array.from({length:10},(_,i)=>[i,i===2?1:0]));
  const answers=Object.fromEntries(Object.entries(prepared.payload.questions).map(([id,q])=>[id,q.type==='score'?{type:'score' as const,score:2,confidence:1,legend:{},probabilities}:{type:'noul' as const,noul:0.25}]));
  return validatePrediction(prepared,{model:prepared.payload.model,answers,usage:{input_tokens:100,output_tokens:20}},1,now);
}
test('two releases, merged windows, postponements, blanks and started gameweeks',()=>{
  assert.equal(planReleases(schedule,now)[0].stage,'early');
  assert.equal(planReleases(schedule,Date.parse('2026-09-19T04:00:00Z'))[0].stage,'pre-kickoff');
  assert.equal(planReleases(schedule,Date.parse('2026-09-19T04:00:00Z'))[0].merged,true);
  assert.equal(planReleases(schedule,Date.parse(fixture.kickoff!)).length,0);
  const withPostponed={...schedule,events:[],fixtures:[...schedule.fixtures,{id:9,event:4,kickoff:null,started:false,finished:false}]};
  assert.equal(planReleases(withPostponed,now)[0].stage,'early');
  assert.equal(planReleases({...schedule,fixtures:[]},now).length,0);
});
test('hash ignores fetch timestamps, but changes for availability and evidence',()=>{
  const a=preparePrediction(input,fixture,now);
  assert.equal(a.fingerprint,preparePrediction({...input,fpl:{...input.fpl,fetchedAt:'new-time'}},fixture,now).fingerprint);
  const changed={...input,fpl:{...input.fpl,players:input.fpl.players.map(p=>({...p,chance:0}))}};
  assert.notEqual(a.fingerprint,preparePrediction(changed,fixture,now).fingerprint);
});
test('attributed evidence deduplicates, expires, excludes future/unrelated content',()=>{
  const evidence=validateEvidence([{id:'a',source:'My observation',publishedAt:'2026-09-17T00:00:00Z',expiresAt:'2026-09-20T00:00:00Z',teams:['CHE'],kind:'opinion',text:'Player occupied a deeper role.'}]);
  const list=[...evidence,{...evidence[0],id:'copy'}, {...evidence[0],id:'future',publishedAt:'2026-09-19T00:00:00Z'}, {...evidence[0],id:'expired',expiresAt:'2026-09-18T00:00:00Z'}, {...evidence[0],id:'unrelated',teams:['ARS']}];
  assert.equal(selectEvidence(list,fixture,now).length,1);
  assert.notEqual(preparePrediction({...input,evidence},fixture,now).fingerprint,preparePrediction(input,fixture,now).fingerprint);
  assert.throws(()=>validateEvidence([{text:'missing source'}]));
});
test('persistent SQLite cache survives restart, repeated checks and unchanged releases',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'betterfpl-predictions-'));
  let store=await PredictionStore.open(directory),calls=0;
  const evaluate=async(prepared:PreparedPrediction)=>{calls++;return mock(prepared);};
  const release=planReleases(schedule,now)[0];
  await runPredictionRelease(store,release,input,{evaluate,now:()=>now});
  store.close(); store=await PredictionStore.open(directory);
  assert.equal(store.all<SavedFixture>('fixtures')[0].result!.home.mode,2);
  await runPredictionRelease(store,release,input,{evaluate,now:()=>now});
  const pre=planReleases(schedule,Date.parse('2026-09-19T04:00:00Z'))[0];
  await runPredictionRelease(store,pre,input,{evaluate,now:()=>Date.parse('2026-09-19T04:00:00Z')});
  assert.equal(calls,1);
  assert.equal(store.get<SavedFixture>('fixtures',`${pre.id}:42`)!.result!.reused,true);
  store.close();
});
test('uncertain requests are persisted and never automatically retried',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'betterfpl-prediction-timeout-')),store=await PredictionStore.open(directory);
  let calls=0;const evaluate=async()=>{calls++;throw new Error('timeout');};
  const release=planReleases(schedule,now)[0];
  await runPredictionRelease(store,release,input,{evaluate,now:()=>now});
  assert.equal(store.all<SavedFixture>('fixtures')[0].status,'uncertain');
  await runPredictionRelease(store,release,input,{evaluate,now:()=>now,retryFailed:true});
  assert.equal(calls,1);store.close();
});
test('budget guard and persistent writer lock prevent duplicate spending',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'betterfpl-prediction-lock-'));
  const unlock=await lockPredictions(directory);
  await assert.rejects(lockPredictions(directory),/active/);
  await unlock();const again=await lockPredictions(directory);await again();
  const store=await PredictionStore.open(directory);let calls=0;
  await runPredictionRelease(store,planReleases(schedule,now)[0],input,{evaluate:async p=>{calls++;return mock(p);},now:()=>now,maxTokens:1});
  assert.equal(calls,0);store.close();
});

test('cloud checkpoint failure prevents any paid request',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'betterfpl-cloud-durability-'));
  let saves=0,calls=0;
  const store=await PredictionStore.open(directory,async()=>{ if (++saves===2) throw new Error('cloud unavailable'); });
  await assert.rejects(runPredictionRelease(store,planReleases(schedule,now)[0],input,{evaluate:async p=>{calls++;return mock(p);},now:()=>now}),/cloud unavailable/);
  assert.equal(calls,0);store.close();
});
