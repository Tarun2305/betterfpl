'use client';

import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { ClubBadge } from '@/components/club-badge';
import type { DashboardData, Fixture } from '@/lib/fpl-data';
import type { AnalyticsData } from '@/lib/analytics-data';
import type { EnrichmentData } from '@/lib/enrichment-data';
import { upcomingFixtures, type FixturePrediction, type GoalPrediction } from '@/lib/prediction-engine';

function GoalDistribution({code,result}:{code:string;result:GoalPrediction}) {
  return <div className="rounded-lg bg-muted/40 p-3"><div className="mb-3 flex justify-between text-sm"><b>{code} goal distribution</b><span className="text-muted-foreground">Mean {result.score.toFixed(2)}{result.probabilities['9']>0?' (capped)':''}</span></div>
    <div className="flex h-20 items-end gap-1">{Object.entries(result.probabilities).map(([goal,prob])=><div key={goal} className="flex h-full flex-1 flex-col justify-end text-center" title={`${goal==='9'?'9+':goal} goals: ${(prob*100).toFixed(1)}%`}><div className={`mx-auto w-full max-w-8 rounded-t ${Number(goal)===result.mode?'bg-primary':'bg-primary/30'}`} style={{height:`${Math.max(2,prob*100)}%`}}/><span className="mt-1 text-xs text-muted-foreground">{goal==='9'?'9+':goal}</span></div>)}</div>
    <p className="mt-2 text-xs text-muted-foreground">Distribution concentration: {Math.round(result.confidence*100)}% · not predictive accuracy</p></div>;
}
type Published = {predictions:Record<number,FixturePrediction>;fixtures:Fixture[];gameweek:number|null;message:string;worker?:{checkedAt?:string;error?:string}};
export function PredictionEngine({fpl}:{fpl:DashboardData;analytics:AnalyticsData;enrichment:EnrichmentData}) {
  const [published,setPublished]=useState<Published|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    async function load() {
      try {
        const response=await fetch('/api/prediction-engine',{cache:'no-store'}), body=await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Saved predictions unavailable.');
        if (active) {setPublished(body);setError('');}
      } catch(failure) {if(active)setError(failure instanceof Error?failure.message:'Saved predictions unavailable.');}
    }
    void load();
    const timer=setInterval(()=>void load(),60000);
    return ()=>{active=false;clearInterval(timer);};
  },[]);
  const fixtures=published?.fixtures ?? upcomingFixtures(fpl), event=published?.gameweek ?? fixtures[0]?.event ?? fpl.gameweek;
  const results=published?.predictions ?? {};
  return <div className="space-y-4"><section className="rounded-xl border bg-card p-5 sm:p-6"><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary"><FlaskConical className="size-4"/>Experimental predictions · Jev 1.13</p>
    <h2 className="text-2xl font-black">Prediction Engine <span className="text-muted-foreground">/ GW {event ?? '—'}</span></h2>
    <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t pt-4 text-sm"><span>{fixtures.length} upcoming fixtures</span><span>{Object.keys(results).length} saved predictions</span><span className="text-muted-foreground">{published?.message ?? 'Loading saved predictions…'}</span></div>
    <p className="mt-3 text-xs text-muted-foreground">Automatically published after the previous gameweek closes and around 12 hours before first kickoff. This page only reads saved results; opening or refreshing it never calls Jev.</p>
    {published?.worker?.error&&<p role="status" className="mt-3 text-sm text-muted-foreground">Background update paused: {published.worker.error}. Previously saved predictions remain available.</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold">Evidence & limitations</summary><p className="mt-2 text-muted-foreground">Numerical evidence includes squad minutes, xG/xA, availability, recent matches and labelled Elo. Qualitative evidence includes source-labelled official headlines and supplied observations; it is not a confirmed lineup. Missing history is unknown. Percentages are experimental model estimates, not bookmaker odds. Football calibration has not been validated.</p></details>
  </section>
  {!fixtures.length&&<div className="rounded-xl border p-10 text-center"><h3 className="font-bold">No upcoming scheduled fixtures</h3><p className="mt-2 text-sm text-muted-foreground">The engine will select the next gameweek when its fixtures are available.</p></div>}
  <div className="grid items-start gap-4 xl:grid-cols-2">{fixtures.map(fixture=>{
    const result=results[fixture.id];
    return <article key={fixture.id} className="overflow-hidden rounded-xl border bg-card"><div className="flex items-center justify-between border-b bg-muted/30 px-5 py-3 text-xs text-muted-foreground"><span>{new Date(fixture.kickoff!).toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span><span>{result?`${result.release==='pre-kickoff'?'Pre-gameweek update':'Early outlook'}${result.reused?' · unchanged evidence':''}`:'Awaiting prediction'}</span></div>
      <div className="p-5"><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">{[fixture.homeCode,'score',fixture.awayCode].map((code,index)=>code==='score'?<div key="score" className="text-center"><p className="whitespace-nowrap font-mono text-4xl font-black">{result?`${result.home.mode===9?'9+':result.home.mode} : ${result.away.mode===9?'9+':result.away.mode}`:'— : —'}</p><p className="mt-2 max-w-36 text-xs text-muted-foreground">{result?'Most-supported goals per team':'No model result yet'}</p></div>:<div key={code} className="flex flex-col items-center gap-2 text-center"><ClubBadge shortName={code} name={index===0?fixture.homeTeam:fixture.awayTeam} code={fpl.teams.find(t=>t.shortName===code)?.code}/><h3 className="font-bold">{index===0?fixture.homeTeam:fixture.awayTeam}</h3><span className="text-xs text-muted-foreground">{index===0?'HOME':'AWAY'}</span></div>)}</div>
      {result?<><div className="mt-5 grid gap-3 sm:grid-cols-2"><GoalDistribution code={fixture.homeCode} result={result.home}/><GoalDistribution code={fixture.awayCode} result={result.away}/></div><p className="mt-2 text-xs text-muted-foreground">Separate team distributions; this is not a jointly modelled scoreline.</p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">{(['goal','assist'] as const).map(metric=><section key={metric}><h4 className="mb-3 text-sm font-bold">{metric==='goal'?'Likely scorers':'Likely assist providers'}</h4>{[...result.players].sort((a,b)=>b[metric]-a[metric]).slice(0,4).map((p,index)=><div key={p.id} className="mb-3"><div className="flex justify-between gap-2 text-sm"><span className="truncate"><span className="mr-2 text-muted-foreground">{index+1}</span>{p.name}<span className="ml-1 text-xs text-muted-foreground">{p.team}</span></span><span className="font-mono font-bold">{(p[metric]*100).toFixed(1)}%</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{width:`${p[metric]*100}%`}}/></div></div>)}</section>)}</div>
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">Predicted {new Date(result.createdAt).toLocaleString()} · checked {new Date(result.checkedAt ?? result.createdAt).toLocaleString()} · {result.model}</p>
        {!!result.evidence?.length&&<details className="mt-3 text-sm"><summary className="cursor-pointer">Qualitative evidence supplied ({result.evidence.length})</summary><div className="mt-3 space-y-3">{result.evidence.map(item=><div key={item.id} className="rounded-lg bg-muted/40 p-3"><p>{item.text}</p><p className="mt-1 text-xs text-muted-foreground">{item.url?<a href={item.url} target="_blank" rel="noreferrer" className="underline">{item.source}</a>:item.source} · {item.kind} · {new Date(item.publishedAt).toLocaleDateString()}</p></div>)}</div></details>}
      </>:<p className="my-6 text-center text-sm text-muted-foreground">The background worker will publish this fixture’s prediction automatically. No action is needed on this page.</p>}</div>
    </article>;
  })}</div></div>;
}
