'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Search, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AnalyticsData, AnalyticsPlayerMatch } from '@/lib/analytics-data';
import type { DashboardData, Player } from '@/lib/fpl-data';

export type Aggregate = {
  key: string;
  team: string;
  teamCode: string;
  player: string;
  position: string;
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  xg: number;
  xa: number;
  keyPasses: number;
  xgChain: number;
  xgBuildup: number;
  rows: AnalyticsPlayerMatch[];
  fplPlayer?: Player;
};

type PlayerMetric = 'xgi90' | 'xg90' | 'xa90' | 'shots90' | 'keyPasses90' | 'chain90' | 'minutes';

const metricLabels: Record<PlayerMetric, string> = {
  xgi90: 'xG + xA / 90',
  xg90: 'xG / 90',
  xa90: 'xA / 90',
  shots90: 'Shots / 90',
  keyPasses90: 'Key passes / 90',
  chain90: 'xG chain / 90',
  minutes: 'Minutes',
};

function normalized(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function per90(value: number, minutes: number) {
  return minutes ? value * 90 / minutes : 0;
}

function findFplPlayer(playerName: string, teamCode: string, players: Player[]) {
  const candidates = players.filter((player) => player.team === teamCode);
  const target = normalized(playerName);
  const exact = candidates.find((player) => normalized(player.fullName) === target || normalized(player.name) === target);
  if (exact) return exact;
  const finalToken = target.split(' ').at(-1);
  const surnameMatches = candidates.filter((player) => {
    const full = normalized(player.fullName);
    const short = normalized(player.name);
    return short === finalToken || full.split(' ').at(-1) === finalToken || target.endsWith(` ${short}`);
  });
  return surnameMatches.length === 1 ? surnameMatches[0] : undefined;
}

export function aggregatePlayers(fpl: DashboardData, analytics: AnalyticsData) {
  const teamCodes = new Map<string, string>();
  analytics.matches.forEach((match) => {
    teamCodes.set(match.homeTeam, match.homeCode);
    teamCodes.set(match.awayTeam, match.awayCode);
  });
  const buckets = new Map<string, Aggregate>();
  analytics.playerMatches.forEach((row) => {
    const key = `${row.team}::${row.player}`;
    const existing = buckets.get(key) ?? {
      key,
      team: row.team,
      teamCode: teamCodes.get(row.team) ?? '',
      player: row.player,
      position: row.position,
      appearances: 0,
      starts: 0,
      minutes: 0,
      goals: 0,
      assists: 0,
      shots: 0,
      xg: 0,
      xa: 0,
      keyPasses: 0,
      xgChain: 0,
      xgBuildup: 0,
      rows: [],
    };
    existing.appearances += row.minutes > 0 ? 1 : 0;
    existing.starts += row.position !== 'Sub' && row.minutes > 0 ? 1 : 0;
    existing.minutes += row.minutes;
    existing.goals += row.goals;
    existing.assists += row.assists;
    existing.shots += row.shots;
    existing.xg += row.xg;
    existing.xa += row.xa;
    existing.keyPasses += row.keyPasses;
    existing.xgChain += row.xgChain;
    existing.xgBuildup += row.xgBuildup;
    existing.rows.push(row);
    if (row.position !== 'Sub') existing.position = row.position;
    buckets.set(key, existing);
  });
  return [...buckets.values()].map((item) => ({ ...item, fplPlayer: findFplPlayer(item.player, item.teamCode, fpl.players) }));
}

function metricValue(player: Aggregate, metric: PlayerMetric) {
  if (metric === 'minutes') return player.minutes;
  if (metric === 'xgi90') return per90(player.xg + player.xa, player.minutes);
  if (metric === 'xg90') return per90(player.xg, player.minutes);
  if (metric === 'xa90') return per90(player.xa, player.minutes);
  if (metric === 'shots90') return per90(player.shots, player.minutes);
  if (metric === 'keyPasses90') return per90(player.keyPasses, player.minutes);
  return per90(player.xgChain, player.minutes);
}

function dateForMatch(matchId: number, analytics: AnalyticsData) {
  return analytics.matches.find((match) => match.id === matchId)?.date ?? '';
}

function opponentForMatch(matchId: number, team: string, analytics: AnalyticsData) {
  const match = analytics.matches.find((item) => item.id === matchId);
  if (!match) return '—';
  return match.homeTeam === team ? `${match.awayTeam} (H)` : `${match.homeTeam} (A)`;
}

function PlayerAnalysis({ fpl, analytics, shortlist, onToggleShortlist }: { fpl: DashboardData; analytics: AnalyticsData; shortlist: number[]; onToggleShortlist: (id: number) => void }) {
  const players = useMemo(() => aggregatePlayers(fpl, analytics), [fpl, analytics]);
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('ALL');
  const [minimumMinutes, setMinimumMinutes] = useState('90');
  const [metric, setMetric] = useState<PlayerMetric>('xgi90');
  const [ascending, setAscending] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const teams = useMemo(() => [...new Set(players.map((player) => player.team))].sort(), [players]);
  const visible = useMemo(() => players
    .filter((player) => player.minutes >= Number(minimumMinutes))
    .filter((player) => team === 'ALL' || player.team === team)
    .filter((player) => `${player.player} ${player.team} ${player.fplPlayer?.name ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => ascending ? metricValue(a, metric) - metricValue(b, metric) : metricValue(b, metric) - metricValue(a, metric)),
  [players, minimumMinutes, team, query, metric, ascending]);
  const selected = players.find((player) => player.key === selectedKey) ?? visible[0];
  const recentRows = selected ? [...selected.rows].sort((a, b) => dateForMatch(b.matchId, analytics).localeCompare(dateForMatch(a.matchId, analytics))) : [];
  const linkedCount = players.filter((player) => player.fplPlayer).length;

  if (!players.length) return <div className="rounded-lg border bg-card px-6 py-16 text-center"><p className="font-semibold">No advanced player data cached</p><p className="mt-1 text-sm text-muted-foreground">Restart the dashboard to refresh SoccerData.</p></div>;

  return <div>
    <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_220px_180px_240px]">
      <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player or club" className="pl-9"/></div>
      <Select value={team} onValueChange={(value) => setTeam(value ?? 'ALL')}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="ALL">All clubs</SelectItem>{teams.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>
      <Select value={minimumMinutes} onValueChange={(value) => setMinimumMinutes(value ?? '90')}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="0">Any minutes</SelectItem><SelectItem value="90">90+ minutes</SelectItem><SelectItem value="180">180+ minutes</SelectItem><SelectItem value="270">270+ minutes</SelectItem></SelectContent></Select>
      <div className="flex gap-2"><Select value={metric} onValueChange={(value) => setMetric((value ?? 'xgi90') as PlayerMetric)}><SelectTrigger className="min-w-0 flex-1"><SelectValue/></SelectTrigger><SelectContent>{Object.entries(metricLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" onClick={() => setAscending((current) => !current)} aria-label="Reverse sort order">{ascending ? <ArrowUp className="size-4"/> : <ArrowDown className="size-4"/>}</Button></div>
    </div>
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)]">
      <section className="overflow-hidden rounded-lg border bg-card"><div className="flex items-center justify-between border-b px-4 py-3"><h3 className="font-semibold">Season player metrics</h3><span className="text-xs text-muted-foreground">{visible.length} shown · {linkedCount}/{players.length} linked to FPL</span></div><div className="max-h-[680px] overflow-auto"><Table><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead className="w-14">Save</TableHead><TableHead>Player</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Min</TableHead><TableHead className="text-right">xG/90</TableHead><TableHead className="text-right">xA/90</TableHead><TableHead className="text-right">Shots/90</TableHead><TableHead className="text-right">KP/90</TableHead><TableHead className="text-right">Chain/90</TableHead><TableHead className="text-right">FPL</TableHead></TableRow></TableHeader><TableBody>{visible.map((player) => { const saved = player.fplPlayer ? shortlist.includes(player.fplPlayer.id) : false; return <TableRow key={player.key} className={selected?.key === player.key ? 'bg-muted/60' : ''}><TableCell>{player.fplPlayer ? <Button variant="ghost" size="icon-sm" onClick={() => onToggleShortlist(player.fplPlayer!.id)} aria-label={`${saved ? 'Remove' : 'Add'} ${player.player} ${saved ? 'from' : 'to'} shortlist`}>{saved ? <Check className="size-4 text-emerald-600"/> : <Star className="size-4"/>}</Button> : <span className="text-xs text-muted-foreground">—</span>}</TableCell><TableCell><button onClick={() => setSelectedKey(player.key)} className="text-left hover:underline"><span className="font-semibold">{player.player}</span><span className="block text-xs text-muted-foreground">{player.team} · {player.appearances} apps</span></button></TableCell><TableCell><Badge variant="outline">{player.position}</Badge></TableCell><TableCell className="text-right font-mono">{player.minutes}</TableCell><TableCell className="text-right font-mono">{per90(player.xg, player.minutes).toFixed(2)}</TableCell><TableCell className="text-right font-mono">{per90(player.xa, player.minutes).toFixed(2)}</TableCell><TableCell className="text-right font-mono">{per90(player.shots, player.minutes).toFixed(2)}</TableCell><TableCell className="text-right font-mono">{per90(player.keyPasses, player.minutes).toFixed(2)}</TableCell><TableCell className="text-right font-mono">{per90(player.xgChain, player.minutes).toFixed(2)}</TableCell><TableCell className="text-right font-mono">{player.fplPlayer ? player.fplPlayer.points : '—'}</TableCell></TableRow>; })}</TableBody></Table></div></section>
      {selected && <aside className="rounded-lg border bg-card"><div className="border-b p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-bold">{selected.player}</h3><p className="text-sm text-muted-foreground">{selected.team} · {selected.position} · {selected.starts} starts</p></div>{selected.fplPlayer && <Badge variant="secondary">£{selected.fplPlayer.price.toFixed(1)}m · {selected.fplPlayer.points} pts</Badge>}</div></div>
        <div className="grid grid-cols-3 gap-px border-b bg-border">{[['xG + xA', (selected.xg + selected.xa).toFixed(2)], ['Goal delta', (selected.goals - selected.xg).toFixed(2)], ['Build-up / 90', per90(selected.xgBuildup, selected.minutes).toFixed(2)], ['Shots', selected.shots], ['Key passes', selected.keyPasses], ['Minutes', selected.minutes]].map(([label, value]) => <div key={label} className="bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-bold">{value}</p></div>)}</div>
        {selected.fplPlayer && <div className="grid grid-cols-3 gap-2 border-b p-4 text-sm"><div><p className="text-xs text-muted-foreground">FPL form</p><p className="font-mono font-semibold">{selected.fplPlayer.form.toFixed(1)}</p></div><div><p className="text-xs text-muted-foreground">Ownership</p><p className="font-mono font-semibold">{selected.fplPlayer.selected.toFixed(1)}%</p></div><div><p className="text-xs text-muted-foreground">FPL xGI</p><p className="font-mono font-semibold">{selected.fplPlayer.xGI.toFixed(2)}</p></div></div>}
        <div><div className="border-b px-4 py-3"><h4 className="font-semibold">Recent matches</h4></div><div className="max-h-80 overflow-auto"><Table><TableHeader><TableRow><TableHead>Opponent</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Min</TableHead><TableHead className="text-right">xG</TableHead><TableHead className="text-right">xA</TableHead><TableHead className="text-right">Shots</TableHead></TableRow></TableHeader><TableBody>{recentRows.map((row) => <TableRow key={row.matchId}><TableCell><span className="font-medium">{opponentForMatch(row.matchId, selected.team, analytics)}</span><span className="block text-xs text-muted-foreground">{dateForMatch(row.matchId, analytics).slice(0, 10)}</span></TableCell><TableCell>{row.position}</TableCell><TableCell className="text-right font-mono">{row.minutes}</TableCell><TableCell className="text-right font-mono">{row.xg.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{row.xa.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{row.shots}</TableCell></TableRow>)}</TableBody></Table></div></div>
      </aside>}
    </div>
    <p className="mt-3 text-xs text-muted-foreground">Per-90 values use actual Understat minutes. FPL links are matched locally by club and player name; an em dash means no safe automatic match was found.</p>
  </div>;
}

export function FixtureEdges({ fpl, analytics }: { fpl: DashboardData; analytics: AnalyticsData }) {
  const nextEvent = fpl.fixtures.map((fixture) => fixture.event).filter((event): event is number => event !== null).sort((a, b) => a - b)[0];
  const teamForm = useMemo(() => {
    const map = new Map<string, { matches: number; xgFor: number; xgAgainst: number; deep: number; ppda: number }>();
    analytics.matches.forEach((match) => {
      [[match.homeCode, match.homeXg, match.awayXg, match.homeDeep, match.homePpda], [match.awayCode, match.awayXg, match.homeXg, match.awayDeep, match.awayPpda]].forEach(([code, xgFor, xgAgainst, deep, ppda]) => {
        const key = String(code); const current = map.get(key) ?? { matches: 0, xgFor: 0, xgAgainst: 0, deep: 0, ppda: 0 };
        current.matches += 1; current.xgFor += Number(xgFor); current.xgAgainst += Number(xgAgainst); current.deep += Number(deep); current.ppda += Number(ppda); map.set(key, current);
      });
    });
    return map;
  }, [analytics.matches]);
  const edges = useMemo(() => fpl.fixtures.filter((fixture) => fixture.event === nextEvent).flatMap((fixture) => [
    { team: fixture.homeCode, opponent: fixture.awayCode, venue: 'H', difficulty: fixture.homeDifficulty },
    { team: fixture.awayCode, opponent: fixture.homeCode, venue: 'A', difficulty: fixture.awayDifficulty },
  ]).map((fixture) => {
    const own = teamForm.get(fixture.team); const opponent = teamForm.get(fixture.opponent);
    const attackXg = own ? own.xgFor / own.matches : 0; const opponentXga = opponent ? opponent.xgAgainst / opponent.matches : 0;
    const expectedThreat = (attackXg + opponentXga) / 2; const deep = own ? own.deep / own.matches : 0; const ppda = opponent ? opponent.ppda / opponent.matches : 0;
    const fixtureEase = (6 - fixture.difficulty) / 5;
    const score = expectedThreat * .55 + deep / 10 * .15 + ppda / 12 * .15 + fixtureEase * .15;
    return { ...fixture, attackXg, opponentXga, expectedThreat, deep, opponentPpda: ppda, score, sample: Math.min(own?.matches ?? 0, opponent?.matches ?? 0) };
  }).sort((a, b) => b.score - a.score), [fpl.fixtures, nextEvent, teamForm]);
  if (!analytics.matches.length) return <div className="rounded-lg border bg-card px-6 py-16 text-center"><p className="font-semibold">No match analytics cached</p><p className="mt-1 text-sm text-muted-foreground">Restart the dashboard to refresh SoccerData.</p></div>;
  if (!edges.length) return <div className="rounded-lg border bg-card px-6 py-16 text-center"><p className="font-semibold">No upcoming fixture data available</p></div>;
  return <div><div className="mb-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border bg-card p-4"><p className="text-sm font-medium text-muted-foreground">Gameweek</p><p className="mt-1 font-mono text-2xl font-bold">{nextEvent}</p></div><div className="rounded-lg border bg-card p-4"><p className="text-sm font-medium text-muted-foreground">Highest attacking edge</p><p className="mt-1 text-xl font-bold">{edges[0].team} vs {edges[0].opponent}</p></div><div className="rounded-lg border bg-card p-4"><p className="text-sm font-medium text-muted-foreground">Evidence window</p><p className="mt-1 text-xl font-bold">{analytics.matches.length} league matches</p></div></div>
    <section className="overflow-hidden rounded-lg border bg-card"><div className="border-b px-4 py-3"><h3 className="font-semibold">Upcoming attacking matchups</h3><p className="mt-1 text-sm text-muted-foreground">Ranks every club side of the next gameweek, not the fixture as a whole.</p></div><Table containerClassName="max-h-[calc(100vh-260px)] overflow-auto"><TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_var(--border)]"><TableRow><TableHead className="w-12">Rank</TableHead><TableHead>Attack</TableHead><TableHead>Opponent</TableHead><TableHead>Venue</TableHead><TableHead className="text-right">FPL FDR</TableHead><TableHead className="text-right">Attack xG</TableHead><TableHead className="text-right">Opponent xGA</TableHead><TableHead className="text-right">Expected threat</TableHead><TableHead className="text-right">Deep / match</TableHead><TableHead className="text-right">Opponent PPDA</TableHead><TableHead className="text-right">Sample</TableHead></TableRow></TableHeader><TableBody>{edges.map((edge, index) => <TableRow key={`${edge.team}-${edge.opponent}`}><TableCell className="font-mono text-muted-foreground">{index + 1}</TableCell><TableCell className="font-bold">{edge.team}</TableCell><TableCell>{edge.opponent}</TableCell><TableCell><Badge variant="outline">{edge.venue}</Badge></TableCell><TableCell className="text-right font-mono">{edge.difficulty}</TableCell><TableCell className="text-right font-mono">{edge.attackXg.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{edge.opponentXga.toFixed(2)}</TableCell><TableCell className="text-right font-mono font-bold text-primary">{edge.expectedThreat.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{edge.deep.toFixed(1)}</TableCell><TableCell className="text-right font-mono">{edge.opponentPpda.toFixed(1)}</TableCell><TableCell className="text-right font-mono">{edge.sample}</TableCell></TableRow>)}</TableBody></Table></section>
    <p className="mt-3 text-sm text-muted-foreground">Expected threat averages the attack&apos;s current xG and its opponent&apos;s xG conceded. The ordering blends that with deep completions, opponent PPDA and FPL fixture difficulty. Early-season samples are small, so treat this as a comparison aid rather than a prediction.</p>
  </div>;
}

export function AnalysisLab({ fpl, analytics, shortlist, onToggleShortlist }: { fpl: DashboardData; analytics: AnalyticsData; shortlist: number[]; onToggleShortlist: (id: number) => void }) {
  const [tab, setTab] = useState('players');
  return <div><div className="mb-4 flex justify-start"><Tabs value={tab} onValueChange={(value) => setTab(value)}><TabsList><TabsTrigger value="players">Player intelligence</TabsTrigger><TabsTrigger value="fixtures">Fixture edges</TabsTrigger></TabsList></Tabs></div>{tab === 'players' ? <PlayerAnalysis {...{ fpl, analytics, shortlist, onToggleShortlist }}/> : <FixtureEdges {...{ fpl, analytics }}/>}</div>;
}
