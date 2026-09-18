import { spawn } from 'node:child_process';
import { readFile, appendFile } from 'node:fs/promises';
import { planReleases } from '../lib/prediction-schedule.ts';
import { versionedRelease } from '../lib/prediction-version.ts';

// Dependency-free preflight: most hourly checks skip npm/Python installation entirely.
let due=false;
if (process.env.TYPESAFE_API_KEY && process.env.TYPESAFE_API_KEY!=='replace_with_your_api_key') {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('Supabase secrets missing');
  await new Promise((accept,reject)=>{const child=spawn(process.execPath,['scripts/refresh-fpl.mjs'],{stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?accept():reject(new Error('Fixture refresh failed')));});
  const schedule=JSON.parse(await readFile('work/prediction-engine/schedule.json','utf8'));
  for (const release of planReleases(schedule).map(versionedRelease)) {
    const bucket=process.env.SUPABASE_STORAGE_BUCKET || 'betterfpl-cache';
    const path=`predictions/private/claims/${release.id.replace(/[^A-Za-z0-9_-]/g,'-')}.json`;
    const response=await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,{headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`},signal:AbortSignal.timeout(20000)});
    if (response.ok) continue;
    const error=await response.json().catch(()=>({}));
    if (response.status===404 || String(error.statusCode)==='404') due=true;
    else throw new Error(`Cloud claim check failed (HTTP ${response.status})`);
  }
}
console.log(due?'Gameweek release due.':'No unclaimed release due; no Jev calls.');
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,`due=${due}\n`);
