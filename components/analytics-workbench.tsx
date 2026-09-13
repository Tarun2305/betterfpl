'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronLeft, ChevronRight, Crosshair, Gauge, Route, Search, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AnalyticsData, AnalyticsMatch, AnalyticsPlayerMatch, AnalyticsShot } from '@/lib/analytics-data';

function matchLabel(match: AnalyticsMatch) {
  return `${match.date.slice(8, 10)}/${match.date.slice(5, 7)}/${match.date.slice(0, 4)} · ${match.homeTeam} ${match.homeGoals}–${match.awayGoals} ${match.awayTeam}`;
}

function ShotMap({ match, shots }: { match: AnalyticsMatch; shots: AnalyticsShot[] }) {
  return <div className="match-pitch rounded-md p-3 text-white"><svg viewBox="0 0 100 64" className="mx-auto aspect-[100/64] w-full max-h-[440px]" role="img" aria-label={`Shot map for ${match.homeTeam} against ${match.awayTeam}`}>
    <rect x="1" y="1" width="98" height="62" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth=".45"/><line x1="50" y1="1" x2="50" y2="63" stroke="rgba(255,255,255,.45)" strokeWidth=".35"/><circle cx="50" cy="32" r="9" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth=".35"/><circle cx="50" cy="32" r=".7" fill="white" opacity=".65"/><rect x="1" y="14" width="16" height="36" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth=".35"/><rect x="83" y="14" width="16" height="36" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth=".35"/><rect x="1" y="23" width="6" height="18" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth=".35"/><rect x="93" y="23" width="6" height="18" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth=".35"/>
    {shots.map((shot) => { const home = shot.team === match.homeTeam; const x = home ? shot.x * 100 : 100 - shot.x * 100; const y = shot.y * 64; const goal = shot.result.toLowerCase().includes('goal'); return <circle key={shot.id} cx={x} cy={y} r={1.1 + Math.sqrt(shot.xg) * 3.2} fill={home ? '#5eead4' : '#f9a8d4'} fillOpacity={goal ? .95 : .62} stroke={goal ? '#fff' : 'rgba(255,255,255,.45)'} strokeWidth={goal ? .7 : .2}><title>{shot.minute}&apos; {shot.player} · {shot.result} · {shot.xg.toFixed(2)} xG</title></circle>; })}
  </svg><div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span><i className="mr-1 inline-block size-2 rounded-full bg-teal-300" />{match.homeTeam} attacks →</span><span>Circle size = xG · white ring = goal</span><span>{match.awayTeam} attacks ← <i className="ml-1 inline-block size-2 rounded-full bg-pink-300" /></span></div></div>;
}

function XgTimeline({ match, shots }: { match: AnalyticsMatch; shots: AnalyticsShot[] }) {
  const ceiling = Math.max(1, Math.ceil(Math.max(match.homeXg, match.awayXg) * 2) / 2);
  const stepPath = (team: string) => {
    const events = shots.filter((shot) => shot.team === team).sort((a,b)=>a.minute-b.minute);
    let total = 0;
    let path = 'M 10 44';
    events.forEach((shot) => {
      const x = 10 + Math.min(95, shot.minute) / 95 * 86;
      total += shot.xg;
      const y = 44 - total / ceiling * 34;
      path += ` H ${x.toFixed(2)} V ${y.toFixed(2)}`;
    });
    return `${path} H 96`;
  };
  const grid = [0, .25, .5, .75, 1];
  return <div className="flex h-full min-h-[300px] flex-col justify-center rounded-md bg-card p-2 sm:p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">Cumulative xG</h3><span className="text-sm text-muted-foreground">90 minutes</span></div><svg viewBox="0 0 100 56" className="my-3 h-auto min-h-48 w-full" role="img" aria-label="Cumulative expected goals timeline">
    {grid.map((ratio) => { const y = 44 - ratio * 34; return <g key={ratio}><line x1="10" y1={y} x2="96" y2={y} stroke="currentColor" opacity={ratio === 0 ? .22 : .08} vectorEffect="non-scaling-stroke"/><text x="8" y={y + 1} textAnchor="end" fill="currentColor" opacity=".5" fontSize="2.5">{(ceiling * ratio).toFixed(ratio === 0 ? 0 : 1)}</text></g>; })}
    {[0,45,90].map((minute) => { const x = 10 + minute / 95 * 86; return <g key={minute}><line x1={x} y1="10" x2={x} y2="44" stroke="currentColor" opacity=".06" vectorEffect="non-scaling-stroke"/><text x={x} y="50" textAnchor="middle" fill="currentColor" opacity=".5" fontSize="2.5">{minute}&apos;</text></g>; })}
    <path d={stepPath(match.homeTeam)} fill="none" stroke="#0f766e" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
    <path d={stepPath(match.awayTeam)} fill="none" stroke="#be185d" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
  </svg><div className="flex items-center justify-between gap-3 text-xs font-medium"><span className="flex items-center gap-2 text-teal-700 dark:text-teal-300"><i className="h-0.5 w-5 rounded bg-teal-600"/>{match.homeTeam} <b className="font-mono">{match.homeXg.toFixed(2)}</b></span><span className="flex items-center gap-2 text-pink-700 dark:text-pink-300"><i className="h-0.5 w-5 rounded bg-pink-700"/>{match.awayTeam} <b className="font-mono">{match.awayXg.toFixed(2)}</b></span></div></div>;
}

function inferredShape(rows: AnalyticsPlayerMatch[]) {
  const starters = rows.filter((row)=>row.position !== 'Sub' && row.minutes > 0); const defenders = starters.filter((row)=>row.position.includes('D')).length; const midfielders = starters.filter((row)=>row.position.includes('M')).length; const forwards = starters.filter((row)=>row.position.includes('F')).length;
  return defenders && midfielders ? `${defenders}-${midfielders}-${forwards}` : 'Roles unavailable';
}

function AnalyticsEmpty({ source }: { source: string }) { return <div className="rounded-lg border bg-card px-6 py-16 text-center"><Crosshair className="mx-auto size-8 text-muted-foreground"/><p className="mt-3 font-semibold">No completed match data cached</p><p className="mt-1 text-sm text-muted-foreground">Restart the dashboard to refresh {source}.</p></div>; }

export function MatchCentre({ data }: { data: AnalyticsData }) {
  const rounds = useMemo(() => {
    const chronological = [...data.matches].sort((a,b)=>a.date.localeCompare(b.date));
    const result = new Map<number, AnalyticsMatch[]>();
    chronological.forEach((match,index)=>{ const gameweek=Math.floor(index/10)+1; result.set(gameweek,[...(result.get(gameweek)??[]),match]); });
    return result;
  },[data.matches]);
  const gameweeks = [...rounds.keys()].sort((a,b)=>b-a);
  const ordered = useMemo(()=>[...data.matches].sort((a,b)=>b.date.localeCompare(a.date)),[data.matches]);
  const [gameweek,setGameweek] = useState(gameweeks[0] ?? 1);
  const [team,setTeam] = useState('ALL');
  const [query,setQuery] = useState('');
  const [matchId,setMatchId] = useState<number | null>(ordered[0]?.id ?? null);
  const [view,setView] = useState('shots');
  const [contributionTeam, setContributionTeam] = useState<'home' | 'away' | null>(null);
  const teams = useMemo(()=>[...new Set(data.matches.flatMap((match)=>[match.homeTeam,match.awayTeam]))].sort(),[data.matches]);
  const visibleMatches = useMemo(() => (rounds.get(gameweek)??[]).filter((match)=>{
    const teamMatch=team==='ALL'||match.homeTeam===team||match.awayTeam===team;
    const needle=query.trim().toLowerCase();
    return teamMatch&&(!needle||match.homeTeam.toLowerCase().includes(needle)||match.awayTeam.toLowerCase().includes(needle));
  }).sort((a,b)=>b.date.localeCompare(a.date)), [rounds, gameweek, team, query]);
  useEffect(()=>{ const saved=window.localStorage.getItem('pl-workbench-match'); const savedId=saved?Number(saved):null; if(savedId&&ordered.some((match)=>match.id===savedId)){setMatchId(savedId);const week=[...rounds.entries()].find(([,matches])=>matches.some((match)=>match.id===savedId))?.[0];if(week)setGameweek(week);}else if(ordered.length)setGameweek(Math.max(...rounds.keys())); },[ordered,rounds]);
  useEffect(()=>{ if(matchId)window.localStorage.setItem('pl-workbench-match',String(matchId)); },[matchId]);

  const detailIndex = useMemo(() => {
    const shots = new Map<number, AnalyticsShot[]>();
    const players = new Map<number, AnalyticsPlayerMatch[]>();
    data.shots.forEach((row) => { const group = shots.get(row.matchId) ?? []; group.push(row); shots.set(row.matchId, group); });
    data.playerMatches.forEach((row) => { const group = players.get(row.matchId) ?? []; group.push(row); players.set(row.matchId, group); });
    return { shots, players };
  }, [data.shots, data.playerMatches]);
  const match = visibleMatches.find((item)=>item.id===matchId) ?? visibleMatches[0] ?? ordered[0]; if (!match) return <AnalyticsEmpty source={data.source}/>;
  const shots = (detailIndex.shots.get(match.id) ?? []); const players = (detailIndex.players.get(match.id) ?? []); const homePlayers = players.filter((player)=>player.team===match.homeTeam).sort((a,b)=>b.minutes-a.minutes); const awayPlayers = players.filter((player)=>player.team===match.awayTeam).sort((a,b)=>b.minutes-a.minutes);
  const homeShots=shots.filter((shot)=>shot.team===match.homeTeam).length; const awayShots=shots.length-homeShots;
  const currentIndex=ordered.findIndex((item)=>item.id===match.id);
  const selectAdjacent=(direction:number)=>{ const next=ordered[currentIndex+direction]; if(!next)return; const ascending=[...data.matches].sort((a,b)=>a.date.localeCompare(b.date)); const nextWeek=Math.floor(ascending.findIndex((item)=>item.id===next.id)/10)+1; setGameweek(nextWeek); setTeam('ALL'); setQuery(''); setMatchId(next.id); };
  const statGroups=[
    {title:'Chance creation',rows:[['xG',match.homeXg,match.awayXg,2],['non-penalty xG',match.homeNpxg,match.awayNpxg,2],['shots',homeShots,awayShots,0]]},
    {title:'Territory & pressure',rows:[['deep completions',match.homeDeep,match.awayDeep,0],['PPDA',match.homePpda,match.awayPpda,1]]},
    {title:'Match expectation',rows:[['expected points',match.homeXpts,match.awayXpts,2]]},
  ] as const;
  return <div>
    <div className="match-toolbar">
      <Select value={String(gameweek)} onValueChange={(value) => setGameweek(Number(value))}><SelectTrigger className="w-full" aria-label="Match gameweek"><SelectValue>Gameweek {gameweek}</SelectValue></SelectTrigger><SelectContent>{gameweeks.map((week) => <SelectItem key={week} value={String(week)}>Gameweek {week}</SelectItem>)}</SelectContent></Select>
      <Select value={team} onValueChange={(value) => setTeam(value ?? 'ALL')}><SelectTrigger className="w-full" aria-label="Match team"><SelectValue>{team === 'ALL' ? 'All teams' : team}</SelectValue></SelectTrigger><SelectContent><SelectItem value="ALL">All teams</SelectItem>{teams.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>
      <Select value={visibleMatches.some((item) => item.id === matchId) ? String(matchId) : ''} onValueChange={(value) => { if(value) setMatchId(Number(value)); }}><SelectTrigger className="match-selector w-full" aria-label="Select match"><SelectValue>{visibleMatches.length ? matchLabel(match) : 'No matches found'}</SelectValue></SelectTrigger><SelectContent>{visibleMatches.map((item) => <SelectItem key={item.id} value={String(item.id)}>{matchLabel(item)}</SelectItem>)}</SelectContent></Select>
      <div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a team" aria-label="Find a match team" className="pl-9" /></div>
    </div>
    {!visibleMatches.length ? <div className="border bg-card p-12 text-center text-muted-foreground">No matches found.</div> : <div className="min-w-0">

      <section className="border-b pb-3">
        <div className="flex items-center justify-between gap-2 sm:gap-3"><Button variant="outline" size="icon-lg" disabled={currentIndex===ordered.length-1} onClick={()=>selectAdjacent(1)} aria-label="Previous match"><ChevronLeft/></Button><div className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-2 text-center sm:gap-3"><button aria-label={`View ${match.homeTeam} contributions`} onClick={() => setContributionTeam('home')} className="match-team min-w-0 text-right"><p className="font-bold sm:hidden">{match.homeCode}</p><p className="hidden text-xl font-medium sm:block">{match.homeTeam}</p><p className="text-xs text-muted-foreground sm:text-sm">{inferredShape(homePlayers)} ↗</p></button><div><p className="font-mono text-4xl font-medium tracking-tighter sm:text-7xl">{match.homeGoals}–{match.awayGoals}</p><p className="mt-1 whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:text-xs">{new Date(match.date).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</p></div><button aria-label={`View ${match.awayTeam} contributions`} onClick={() => setContributionTeam('away')} className="match-team min-w-0 text-left"><p className="font-bold sm:hidden">{match.awayCode}</p><p className="hidden text-xl font-medium sm:block">{match.awayTeam}</p><p className="text-xs text-muted-foreground sm:text-sm">{inferredShape(awayPlayers)} ↗</p></button></div><Button variant="outline" size="icon-lg" disabled={currentIndex===0} onClick={()=>selectAdjacent(-1)} aria-label="Next match"><ChevronRight/></Button></div>
        <div className="mt-3 grid gap-x-5 gap-y-3 lg:grid-cols-3">{statGroups.map((group)=><div key={group.title}><p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">{group.title}</p><div className="space-y-1.5">{group.rows.map(([label,home,away,precision])=>{const maximum=Math.max(Number(home),Number(away),.01); return <div key={label}><div className="grid grid-cols-[44px_1fr_auto_1fr_44px] items-center gap-2 text-sm"><span className="text-right font-mono font-bold">{Number(home).toFixed(precision)}</span><div className="flex justify-end"><i className="h-1.5 rounded-full bg-teal-600 dark:bg-teal-400" style={{width:`${Math.max(8,Number(home)/maximum*100)}%`}}/></div><span className="whitespace-nowrap text-sm text-muted-foreground">{label}</span><div><i className="block h-1.5 rounded-full bg-pink-700 dark:bg-pink-400" style={{width:`${Math.max(8,Number(away)/maximum*100)}%`}}/></div><span className="font-mono font-bold">{Number(away).toFixed(precision)}</span></div></div>;})}</div></div>)}</div>
      </section>
      <section className="mt-3 overflow-hidden rounded-xl border bg-card"><div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2"><div><h3 className="font-semibold">Chance analysis</h3></div><Tabs value={view} onValueChange={setView}><TabsList><TabsTrigger value="shots">Shots</TabsTrigger><TabsTrigger value="flow">Match flow</TabsTrigger></TabsList></Tabs></div><div className="p-2.5">{view==='shots'&&<ShotMap match={match} shots={shots}/>} {view==='flow'&&<XgTimeline match={match} shots={shots}/>}</div></section>
      <Dialog open={contributionTeam !== null} onOpenChange={(open) => { if (!open) setContributionTeam(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl p-6">
        <DialogHeader><DialogTitle className="text-2xl font-medium">{contributionTeam === 'home' ? match.homeTeam : match.awayTeam}</DialogTitle><DialogDescription>Player contributions</DialogDescription></DialogHeader>
        <Table><TableHeader><TableRow><TableHead>Player</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Min</TableHead><TableHead className="text-right">Shots</TableHead><TableHead className="text-right">xG</TableHead><TableHead className="text-right">xA</TableHead><TableHead className="text-right">xG+xA</TableHead><TableHead className="text-right">KP</TableHead><TableHead className="text-right">Chain</TableHead></TableRow></TableHeader><TableBody>{(contributionTeam === 'home' ? homePlayers : awayPlayers).map((player) => <TableRow key={player.player}><TableCell className="font-medium">{player.player}</TableCell><TableCell>{player.position}</TableCell><TableCell className="text-right font-mono">{player.minutes}</TableCell><TableCell className="text-right font-mono">{player.shots}</TableCell><TableCell className="text-right font-mono">{player.xg.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{player.xa.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{(player.xg + player.xa).toFixed(2)}</TableCell><TableCell className="text-right font-mono">{player.keyPasses}</TableCell><TableCell className="text-right font-mono">{player.xgChain.toFixed(2)}</TableCell></TableRow>)}</TableBody></Table>
      </DialogContent></Dialog>
      <p className="mt-3 text-sm text-muted-foreground">PPDA is passes allowed per defensive action; lower values usually indicate more aggressive pressing. Listed shapes are inferred from starting role codes.</p>
    </div>}
  </div>;
}

export function TacticalLab({ data }: { data: AnalyticsData }) {
  const teamOptions = useMemo(()=>{ const map=new Map<string,string>(); data.matches.forEach((match)=>{map.set(match.homeCode,match.homeTeam);map.set(match.awayCode,match.awayTeam);});return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1]));},[data.matches]); const [teamCode,setTeamCode]=useState(teamOptions[0]?.[0]??'');
  useEffect(()=>{if(!teamOptions.some(([code])=>code===teamCode))setTeamCode(teamOptions[0]?.[0]??'');},[teamOptions,teamCode]); const teamName=teamOptions.find(([code])=>code===teamCode)?.[1]??'';
  const shotCounts = useMemo(() => {
    const counts = new Map<number, Map<string, number>>();
    data.shots.forEach((shot) => { const teams = counts.get(shot.matchId) ?? new Map<string, number>(); teams.set(shot.team, (teams.get(shot.team) ?? 0) + 1); counts.set(shot.matchId, teams); });
    return counts;
  }, [data.shots]);
  const records=useMemo(()=>data.matches.filter((match)=>match.homeCode===teamCode||match.awayCode===teamCode).sort((a,b)=>b.date.localeCompare(a.date)).map((match)=>{const home=match.homeCode===teamCode;const shotsFor=(shotCounts.get(match.id)?.get(teamName) ?? 0);const shotsAgainst=(shotCounts.get(match.id)?.get(home ? match.awayTeam : match.homeTeam) ?? 0);return{match,opponent:home?match.awayTeam:match.homeTeam,venue:home?'H':'A',goalsFor:home?match.homeGoals:match.awayGoals,goalsAgainst:home?match.awayGoals:match.homeGoals,xgFor:home?match.homeXg:match.awayXg,xgAgainst:home?match.awayXg:match.homeXg,ppda:home?match.homePpda:match.awayPpda,deep:home?match.homeDeep:match.awayDeep,xpts:home?match.homeXpts:match.awayXpts,shotsFor,shotsAgainst};}),[data.matches,teamCode,teamName,shotCounts]);
  if(!records.length)return <AnalyticsEmpty source={data.source}/>; const avg=(getter:(row:typeof records[number])=>number)=>records.reduce((sum,row)=>sum+getter(row),0)/records.length; const xgFor=avg((r)=>r.xgFor),xgAgainst=avg((r)=>r.xgAgainst),ppda=avg((r)=>r.ppda),deep=avg((r)=>r.deep),shotDiff=avg((r)=>r.shotsFor-r.shotsAgainst),xpts=avg((r)=>r.xpts); const press=ppda<9?'Aggressive press':ppda<12?'Balanced press':'Lower press intensity'; const territory=deep>=8?'Frequent deep entries':deep>=5?'Moderate territory':'Limited deep entries'; const chance=xgFor>=1.7?'High chance volume':xgFor>=1.2?'Moderate chance volume':'Low chance volume';
  return <div><div className="mb-4 flex justify-start"><Select value={teamCode} onValueChange={(value)=>setTeamCode(value??teamCode)}><SelectTrigger className="w-full sm:w-72"><SelectValue>{teamCode} · {teamName}</SelectValue></SelectTrigger><SelectContent>{teamOptions.map(([code,name])=><SelectItem key={code} value={code}>{code} · {name}</SelectItem>)}</SelectContent></Select></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[['xG for / match',xgFor.toFixed(2)],['xG against / match',xgAgainst.toFixed(2)],['xPts / match',xpts.toFixed(2)],['PPDA',ppda.toFixed(1)],['Deep completions',deep.toFixed(1)],['Shot difference',shotDiff.toFixed(1)]].map(([label,value])=><div key={label} className="rounded-lg border bg-card p-4"><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-2 font-mono text-2xl font-bold">{value}</p></div>)}</div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[.75fr_1.25fr]"><section className="rounded-lg border bg-card p-4"><h3 className="font-semibold">Profile read</h3><div className="mt-4 space-y-3">{[[Gauge,press,`PPDA ${ppda.toFixed(1)} — lower means opponents complete fewer passes before a defensive action.`],[Route,territory,`${deep.toFixed(1)} deep completions per match.`],[Crosshair,chance,`${xgFor.toFixed(2)} xG created per match.`],[ShieldCheck,xgAgainst<=1.1?'Restricts good chances':'Allows notable chance volume',`${xgAgainst.toFixed(2)} xG conceded per match.`]].map(([Icon,title,description],index)=>{const Component=Icon as typeof Activity;return <div key={index} className="flex gap-3 rounded-md border p-3"><Component className="mt-0.5 size-4 shrink-0 text-primary"/><div><p className="text-sm font-semibold">{title as string}</p><p className="mt-1 text-xs text-muted-foreground">{description as string}</p></div></div>;})}</div></section>
      <section className="overflow-hidden rounded-lg border bg-card"><div className="border-b px-4 py-3"><h3 className="font-semibold">Match log</h3></div><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Opponent</TableHead><TableHead>Score</TableHead><TableHead className="text-right">xG</TableHead><TableHead className="text-right">xGA</TableHead><TableHead className="text-right">PPDA</TableHead><TableHead className="text-right">Deep</TableHead><TableHead className="text-right">Shots</TableHead></TableRow></TableHeader><TableBody>{records.map((row)=><TableRow key={row.match.id}><TableCell className="font-mono text-xs">{row.match.date.slice(0,10)}</TableCell><TableCell className="font-medium">{row.opponent} ({row.venue})</TableCell><TableCell className="font-mono">{row.goalsFor}–{row.goalsAgainst}</TableCell><TableCell className="text-right font-mono">{row.xgFor.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{row.xgAgainst.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{row.ppda.toFixed(1)}</TableCell><TableCell className="text-right font-mono">{row.deep}</TableCell><TableCell className="text-right font-mono">{row.shotsFor}–{row.shotsAgainst}</TableCell></TableRow>)}</TableBody></Table></section></div>
    <div className="mt-4 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">Source: {data.source} · season {data.season} · refreshed {data.fetchedAt.slice(0,16).replace('T',' ')} UTC. Pass networks and off-ball tracking are intentionally omitted because this source does not provide the required pass events or tracking coordinates.</div>
  </div>;
}
