'use client';



import { useCallback, useEffect, useMemo, useState } from 'react';

import { Activity, ArrowDown, ArrowUp, CalendarDays, Check, ChevronsUpDown, ClipboardList, Crosshair, GitCompareArrows, Menu, Moon, Plus, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Star, Sun, TrendingUp, Users, X } from 'lucide-react';

import { PlannerWorkspace } from '@/components/planner-workspace';

import { ClubBadge } from '@/components/club-badge';

import { MatchCentre, TacticalLab } from '@/components/analytics-workbench';

import { FixtureEdges, aggregatePlayers } from '@/components/analysis-lab';

import { Badge } from '@/components/ui/badge';

import { Button } from '@/components/ui/button';

import { Checkbox } from '@/components/ui/checkbox';

import { Input } from '@/components/ui/input';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { Textarea } from '@/components/ui/textarea';

import { sampleData, teamBadgeCodes, type DashboardData, type Player } from '@/lib/fpl-data';

import { emptyAnalytics, type AnalyticsData } from '@/lib/analytics-data';

import { emptyEnrichment, type EnrichmentData, type WhoScoredPlayer } from '@/lib/enrichment-data';



type View = 'players' | 'shortlist' | 'compare' | 'fixtures' | 'matches' | 'teams' | 'tactics' | 'projections' | 'planner';

type SortKey = 'points' | 'form' | 'selected' | 'price' | 'minutes' | 'value' | 'xGI' | 'transfersIn';

type PlayerMeta = { status: 'watch' | 'target' | 'avoid'; notes: string; tags: string };

type MetaMap = Record<number, PlayerMeta>;

type ImportedFplTeam = {

  id: number;

  teamName: string;

  managerName: string;

  overallPoints: number;

  overallRank: number;

  event: number;

  eventPoints: number;

  bank: number;

  value: number;

  picks: { playerId: number; position: number; multiplier: number; captain: boolean; viceCaptain: boolean; purchasePrice: number; sellingPrice: number }[];

};



const navItems: { id: View; label: string; icon: typeof Users }[] = [

  { id: 'players', label: 'Players', icon: Users },

  { id: 'shortlist', label: 'Shortlist', icon: Star },

  { id: 'compare', label: 'Compare', icon: GitCompareArrows },

  { id: 'fixtures', label: 'Fixtures', icon: CalendarDays },

  { id: 'matches', label: 'Match centre', icon: Crosshair },

  { id: 'teams', label: 'Teams', icon: ShieldCheck },

  { id: 'tactics', label: 'Tactical lab', icon: Activity },

  { id: 'projections', label: 'Projections', icon: TrendingUp },

  { id: 'planner', label: 'GW planner', icon: ClipboardList },

];



function fdrClass(difficulty: number) {

  if (difficulty <= 2) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';

  if (difficulty >= 4) return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';

  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';

}



function formClass(form: number) {

  if (form < 2) return 'font-bold text-rose-800 dark:text-rose-300';

  if (form < 4) return 'font-bold text-orange-800 dark:text-orange-300';

  if (form < 6) return 'font-bold text-amber-700 dark:text-amber-300';

  if (form < 8) return 'font-bold text-teal-700 dark:text-teal-300';

  return 'font-bold text-emerald-800 dark:text-emerald-300';

}



const numberFormatter = new Intl.NumberFormat('en-GB');

function formatNumber(value: number) {

  return numberFormatter.format(value);

}



function formatFixtureDate(value: string | null) {

  if (!value) return 'TBC';

  const date = new Date(value);

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return `${weekdays[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]}`;

}



function fixtureRun(data: DashboardData, teamCode: string, count = 5) {

  return data.fixtures.filter((fixture) => fixture.homeCode === teamCode || fixture.awayCode === teamCode).slice(0, count).map((fixture) => {

    const home = fixture.homeCode === teamCode;

    return { event: fixture.event, opponent: home ? fixture.awayCode : fixture.homeCode, venue: home ? 'H' : 'A', difficulty: home ? fixture.homeDifficulty : fixture.awayDifficulty };

  });

}



function availabilityFactor(player: Player) {

  if (player.status === 'u') return 0;

  if (player.chance !== null) return player.chance / 100;

  return player.status === 'd' ? 0.75 : 1;

}



function minutesReliability(player: Player, gameweek: number | null) {

  const possible = Math.max(1, (gameweek ?? Math.max(player.starts, 1)) * 90);

  return Math.min(100, Math.round((player.minutes / possible) * 100));

}



function expectedPoints(player: Player, data: DashboardData, fixtureCount = 1) {

  const run = fixtureRun(data, player.team, fixtureCount);

  if (!run.length) return 0;

  const base = player.form > 0 ? player.form * 0.6 + player.pointsPerGame * 0.4 : player.pointsPerGame;

  const reliability = 0.65 + minutesReliability(player, data.gameweek) / 100 * 0.35;

  const factors: Record<number, number> = { 1: 1.2, 2: 1.1, 3: 1, 4: 0.86, 5: 0.72 };

  return run.reduce((sum, fixture) => sum + base * (factors[fixture.difficulty] ?? 1) * reliability * availabilityFactor(player), 0);

}



function per90(value: number, minutes: number) {

  return minutes ? value * 90 / minutes : 0;

}



function SortButton({ label, column, sortKey, direction, onSort }: { label: string; column: SortKey; sortKey: SortKey; direction: 'asc' | 'desc'; onSort: (key: SortKey) => void }) {

  const active = sortKey === column;

  return <button className="ml-auto inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => onSort(column)}>{label}{active ? direction === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}</button>;

}

function normalizedName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findWhoScoredPlayer(player: Player, rows: WhoScoredPlayer[]) {
  const candidates = rows.filter((row) => row.teamCode === player.team);
  const names = [normalizedName(player.fullName), normalizedName(player.name)];
  const exact = candidates.find((row) => names.includes(normalizedName(row.player)));
  if (exact) return exact;
  const surname = normalizedName(player.fullName).split(' ').at(-1);
  const surnameMatches = candidates.filter((row) => normalizedName(row.player).split(' ').at(-1) === surname);
  return surnameMatches.length === 1 ? surnameMatches[0] : undefined;
}



export default function Home() {

  const [data, setData] = useState<DashboardData>(sampleData);

  const [analytics, setAnalytics] = useState<AnalyticsData>(emptyAnalytics);

  const [enrichment, setEnrichment] = useState<EnrichmentData>(emptyEnrichment);

  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<View>('players');

  const [query, setQuery] = useState('');

  const [position, setPosition] = useState('ALL');

  const [team, setTeam] = useState('ALL');

  const [maxPrice, setMaxPrice] = useState('20');

  const [sortKey, setSortKey] = useState<SortKey>('points');

  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');

  const [shortlist, setShortlist] = useState<number[]>([]);

  const [compare, setCompare] = useState<number[]>([]);

  const [plan, setPlan] = useState<number[]>([]);

  const [captainId, setCaptainId] = useState<number | null>(null);

  const [selectedTeam, setSelectedTeam] = useState('ARS');

  const [meta, setMeta] = useState<MetaMap>({});

  const [activePlayerId, setActivePlayerId] = useState<number | null>(null);

  const [playerPanelTab, setPlayerPanelTab] = useState('overview');

  const [projectionTab, setProjectionTab] = useState('players');

  const [projectionQuery, setProjectionQuery] = useState('');

  const [menuOpen, setMenuOpen] = useState(false);

  const [darkMode, setDarkMode] = useState(false);

  const [entryId, setEntryId] = useState('');

  const [importedTeam, setImportedTeam] = useState<ImportedFplTeam | null>(null);

  const [importedPlayerIds, setImportedPlayerIds] = useState<number[]>([]);

  const [entryLoading, setEntryLoading] = useState(false);

  const [entryError, setEntryError] = useState('');



  const loadData = useCallback(async () => {

    setLoading(true);

    await Promise.all([

      (async () => {

        try {

          const response = await fetch('/api/data/fpl', { cache: 'no-store' });

          if (!response.ok) throw new Error('Unable to load the local data service');

          const payload = await response.json() as DashboardData;

          setData({ ...payload, teams: payload.teams.map((item) => ({ ...item, code: item.code ?? teamBadgeCodes[item.shortName] })) });

        } catch {

          setData(sampleData);

        }

      })(),

      (async () => {

        try {

          const response = await fetch('/api/data/enrichment', { cache: 'no-store' });

          if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Unable to load enrichment cache');

          setEnrichment(await response.json());

        } catch {

          setEnrichment(emptyEnrichment);

        }

      })(),

      (async () => {

        try {

          const response = await fetch('/api/data/analytics', { cache: 'no-store' });

          if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Unable to load analytics cache');

          setAnalytics(await response.json());

        } catch {

          setAnalytics(emptyAnalytics);

        }

      })(),

    ]);

    setLoading(false);

  }, []);



  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {

    try {

      setShortlist(JSON.parse(localStorage.getItem('pl-workbench-shortlist') ?? '[]'));

      setMeta(JSON.parse(localStorage.getItem('pl-workbench-meta') ?? '{}'));

      setPlan(JSON.parse(localStorage.getItem('pl-workbench-plan') ?? '[]'));

      setCaptainId(JSON.parse(localStorage.getItem('pl-workbench-captain') ?? 'null'));

    } catch { /* Ignore malformed local preferences. */ }

  }, []);

  useEffect(() => { localStorage.setItem('pl-workbench-shortlist', JSON.stringify(shortlist)); }, [shortlist]);

  useEffect(() => { localStorage.setItem('pl-workbench-meta', JSON.stringify(meta)); }, [meta]);

  useEffect(() => { localStorage.setItem('pl-workbench-plan', JSON.stringify(plan)); }, [plan]);

  useEffect(() => { localStorage.setItem('pl-workbench-captain', JSON.stringify(captainId)); }, [captainId]);

  useEffect(() => {

    const savedTheme = localStorage.getItem('better-fpl-theme');

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const dark = savedTheme ? savedTheme === 'dark' : prefersDark;

    setDarkMode(dark);

    document.documentElement.classList.toggle('dark', dark);

    setEntryId(localStorage.getItem('better-fpl-entry') ?? '');

  }, []);

  useEffect(() => {

    document.documentElement.classList.toggle('dark', darkMode);

    localStorage.setItem('better-fpl-theme', darkMode ? 'dark' : 'light');

  }, [darkMode]);



  useEffect(() => {

    const modelContext = (document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;

    if (!modelContext?.registerTool) return;

    const lifecycle = new AbortController();

    try {

      void Promise.resolve(modelContext.registerTool({

        name: 'shortlist_players',

        title: 'Shortlist players',

        description: 'Add one or more FPL player IDs to the visible local shortlist.',

        inputSchema: { type: 'object', properties: { playerIds: { type: 'array', items: { type: 'number' }, minItems: 1 } }, required: ['playerIds'], additionalProperties: false },

        annotations: { readOnlyHint: false, untrustedContentHint: false },

        execute(input: unknown) {

          const ids = (input as { playerIds?: unknown }).playerIds;

          if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'number')) throw new Error('playerIds must be an array of numbers');

          const valid = ids.filter((id) => data.players.some((player) => player.id === id));

          setShortlist((current) => [...new Set([...current, ...valid])]);

          setView('shortlist');

          return { addedPlayerIds: valid, shortlistCount: new Set([...shortlist, ...valid]).size };

        },

      }, { signal: lifecycle.signal })).catch(() => undefined);

    } catch { /* Browser does not support WebMCP registration. */ }

    return () => lifecycle.abort();

  }, [data.players, shortlist]);



  useEffect(() => { setPlayerPanelTab('overview'); }, [activePlayerId]);



  const combinedPlayerAnalytics = useMemo(() => aggregatePlayers(data, analytics), [data, analytics]);

  const analyticsMatchesById = useMemo(() => new Map(analytics.matches.map((match) => [match.id, match])), [analytics.matches]);

  const activePlayer = data.players.find((player) => player.id === activePlayerId) ?? null;

  const activePlayerAnalytics = activePlayer ? combinedPlayerAnalytics.find((item) => item.fplPlayer?.id === activePlayer.id) : undefined;

  const activePlayerHistory = activePlayerAnalytics ? [...activePlayerAnalytics.rows].sort((a, b) => (analyticsMatchesById.get(b.matchId)?.date ?? '').localeCompare(analyticsMatchesById.get(a.matchId)?.date ?? '')) : [];

  const activePlayerUpcomingFixtures = activePlayer ? data.fixtures.filter((fixture) => fixture.homeCode === activePlayer.team || fixture.awayCode === activePlayer.team).slice(0, 5) : [];

  const activeWhoScoredPlayer = activePlayer ? findWhoScoredPlayer(activePlayer, enrichment.whoScoredPlayers) : undefined;

  const listedPlayers = useMemo(() => view === 'shortlist' ? data.players.filter((player) => shortlist.includes(player.id)) : data.players, [view, data.players, shortlist]);

  const visiblePlayers = useMemo(() => listedPlayers

    .filter((player) => `${player.name} ${player.fullName} ${player.team} ${player.teamName}`.toLowerCase().includes(query.toLowerCase()))

    .filter((player) => position === 'ALL' || player.position === position)

    .filter((player) => team === 'ALL' || player.team === team)

    .filter((player) => player.price <= Number(maxPrice))

    .sort((a, b) => direction === 'desc' ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]),

  [listedPlayers, query, position, team, maxPrice, sortKey, direction]);



  const comparedPlayers = compare.map((id) => data.players.find((player) => player.id === id)).filter(Boolean) as Player[];

  const projectedPlayers = useMemo(() => data.players.map((player) => ({

    player,

    next: expectedPoints(player, data, 1),

    next3: expectedPoints(player, data, 3),

    reliability: minutesReliability(player, data.gameweek),

    xgi90: per90(player.xGI, player.minutes),

    run: fixtureRun(data, player.team, 3),

  })).sort((a, b) => b.next3 - a.next3), [data]);

  const visibleProjectedPlayers = useMemo(() => {

    const needle = projectionQuery.trim().toLowerCase();

    return needle ? projectedPlayers.filter(({player}) => `${player.name} ${player.fullName} ${player.team} ${player.teamName} ${player.position}`.toLowerCase().includes(needle)) : projectedPlayers;

  }, [projectedPlayers, projectionQuery]);

  const plannedPlayers = plan.map((id) => data.players.find((player) => player.id === id)).filter(Boolean) as Player[];

  const activeTeam = data.teams.find((item) => item.shortName === selectedTeam) ?? data.teams[0];

  const teamByShortName = useMemo(() => new Map(data.teams.map((item) => [item.shortName, item])), [data.teams]);

  const clubEloByCode = useMemo(() => new Map(enrichment.clubElo.map((item) => [item.teamCode, item])), [enrichment.clubElo]);

  const activeTeamPlayers = activeTeam ? data.players.filter((player) => player.team === activeTeam.shortName) : [];

  const activeTeamRun = activeTeam ? fixtureRun(data, activeTeam.shortName, 6) : [];

  const planCost = plannedPlayers.reduce((sum, player) => sum + player.price, 0);

  const captainPlayer = plannedPlayers.find((player) => player.id === captainId);

  const planProjection = plannedPlayers.reduce((sum, player) => sum + expectedPoints(player, data, 1), 0) + (captainPlayer ? expectedPoints(captainPlayer, data, 1) : 0);

  const planPositions = (['GKP', 'DEF', 'MID', 'FWD'] as const).map((positionName) => ({ position: positionName, players: plannedPlayers.filter((player) => player.position === positionName), target: { GKP: 2, DEF: 5, MID: 5, FWD: 3 }[positionName] }));

  const overLimitTeams = [...new Set(plannedPlayers.map((player) => player.team))].filter((teamCode) => plannedPlayers.filter((player) => player.team === teamCode).length > 3);

  const previewIncoming = plannedPlayers.filter((player) => importedTeam && !importedPlayerIds.includes(player.id));

  const previewOutgoing = data.players.filter((player) => importedTeam && importedPlayerIds.includes(player.id) && !plan.includes(player.id));

  const fixturesByEvent = useMemo(() => {

    const map = new Map<number, DashboardData['fixtures']>();

    const nextEvents = [...new Set(data.fixtures.map((fixture) => fixture.event).filter((event): event is number => event !== null))].sort((a, b) => a - b).slice(0, 4);

    data.fixtures.filter((fixture) => fixture.event !== null && nextEvents.includes(fixture.event)).forEach((fixture) => {

      const key = fixture.event ?? 0;

      map.set(key, [...(map.get(key) ?? []), fixture]);

    });

    return [...map.entries()].sort((a, b) => a[0] - b[0]);

  }, [data.fixtures]);



  function toggleShortlist(id: number) {

    setShortlist((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  }

  function toggleCompare(id: number) {

    setCompare((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 3 ? [...current, id] : current);

  }

  function togglePlan(id: number) {

    setPlan((current) => {

      if (current.includes(id)) {

        if (captainId === id) setCaptainId(null);

        return current.filter((item) => item !== id);

      }

      return current.length < 15 ? [...current, id] : current;

    });

  }

  function handleSort(key: SortKey) {

    if (sortKey === key) setDirection((current) => current === 'desc' ? 'asc' : 'desc');

    else { setSortKey(key); setDirection('desc'); }

  }

  function updateMeta(id: number, patch: Partial<PlayerMeta>) {

    setMeta((current) => {

      const existing = current[id] ?? { status: 'watch', notes: '', tags: '' };

      return { ...current, [id]: { ...existing, ...patch } };

    });

  }



  async function importFplTeam() {

    const numericId = Number(entryId.trim());

    if (!Number.isInteger(numericId) || numericId < 1) { setEntryError('Enter the numeric team ID from your FPL URL.'); return; }

    if (data.source !== 'live') { setEntryError('Live player data must be available before importing a squad. Refresh the page and try again.'); return; }

    setEntryLoading(true);

    setEntryError('');

    try {

      const response = await fetch(`/api/fpl-team?id=${numericId}${data.gameweek ? `&event=${data.gameweek}` : ''}`, { cache: 'no-store' });

      const payload = await response.json() as ImportedFplTeam & { error?: string };

      if (!response.ok) throw new Error(payload.error || 'Unable to load that FPL team.');

      const available = new Set(data.players.map((player) => player.id));

      const playerIds = payload.picks.map((pick) => pick.playerId).filter((id) => available.has(id));

      if (playerIds.length !== 15) throw new Error('The squad could not be matched to the current player catalogue. Refresh FPL data and try again.');

      setImportedTeam(payload);

      setImportedPlayerIds(playerIds);

      setPlan(playerIds);

      setCaptainId(payload.picks.find((pick) => pick.captain)?.playerId ?? null);

      localStorage.setItem('better-fpl-entry', String(numericId));

    } catch (error) {

      setEntryError(error instanceof Error ? error.message : 'Unable to load that FPL team.');

    } finally {

      setEntryLoading(false);

    }

  }



  const table = (

    <div className="overflow-hidden rounded-lg border bg-card">

      <div>

        <Table containerClassName="max-h-[calc(100vh-155px)] overflow-auto">

          <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_var(--border)]"><TableRow>

            <TableHead className="w-20">Save</TableHead><TableHead>Player</TableHead><TableHead>Pos</TableHead>

            <TableHead className="text-right"><SortButton label="Price" column="price" {...{ sortKey, direction }} onSort={handleSort} /></TableHead>

            <TableHead className="text-right"><SortButton label="Points" column="points" {...{ sortKey, direction }} onSort={handleSort} /></TableHead>

            <TableHead className="text-right"><SortButton label="Form" column="form" {...{ sortKey, direction }} onSort={handleSort} /></TableHead>

            <TableHead className="text-right"><SortButton label="Owned" column="selected" {...{ sortKey, direction }} onSort={handleSort} /></TableHead>

            <TableHead className="text-right"><SortButton label="xGI" column="xGI" {...{ sortKey, direction }} onSort={handleSort} /></TableHead>

            <TableHead className="text-right"><SortButton label="Pts / £m" column="value" {...{ sortKey, direction }} onSort={handleSort} /></TableHead><TableHead>Next</TableHead>

          </TableRow></TableHeader>

          <TableBody>{visiblePlayers.slice(0, 100).map((player) => {

            const saved = shortlist.includes(player.id); const selected = compare.includes(player.id); const playerMeta = meta[player.id];

            return <TableRow key={player.id} className={saved ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''}>

              <TableCell><div className="flex items-center gap-1"><Button size="icon-sm" variant="ghost" onClick={() => toggleShortlist(player.id)} aria-label={`${saved ? 'Remove' : 'Add'} ${player.name} ${saved ? 'from' : 'to'} shortlist`}><Star className={`size-4 ${saved ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground'}`} /></Button><Checkbox checked={selected} onCheckedChange={() => toggleCompare(player.id)} disabled={!selected && compare.length >= 3} aria-label={`Compare ${player.name}`} /></div></TableCell>

              <TableCell><div className="flex items-center gap-2"><ClubBadge code={teamByShortName.get(player.team)?.code} shortName={player.team} name={player.teamName} /><button onClick={() => setActivePlayerId(player.id)} className="text-left hover:underline"><span className="font-semibold">{player.name}</span><span className="block text-sm text-muted-foreground">{player.team}{playerMeta ? ` · ${playerMeta.status}` : ''}</span></button></div></TableCell>

              <TableCell><Badge variant="outline">{player.position}</Badge></TableCell><TableCell className="text-right font-mono">£{player.price.toFixed(1)}</TableCell><TableCell className="text-right font-mono font-bold">{player.points}</TableCell><TableCell className={`text-right font-mono ${formClass(player.form)}`}>{player.form.toFixed(1)}</TableCell><TableCell className="text-right font-mono">{player.selected.toFixed(1)}%</TableCell><TableCell className="text-right font-mono">{player.xGI.toFixed(1)}</TableCell><TableCell className="text-right font-mono text-emerald-700 dark:text-emerald-400">{player.value.toFixed(1)}</TableCell><TableCell><span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${fdrClass(player.nextDifficulty)}`}>{player.nextFixture}</span></TableCell>

            </TableRow>;

          })}</TableBody>

        </Table>

      </div>

      {visiblePlayers.length === 0 && <div className="px-6 py-14 text-center"><p className="font-semibold">No players match these filters</p><button className="mt-2 text-sm text-primary hover:underline" onClick={() => { setQuery(''); setPosition('ALL'); setTeam('ALL'); setMaxPrice('20'); }}>Clear filters</button></div>}

    </div>

  );



  return (

    <main className="min-h-screen bg-background text-foreground">

      <header className="site-header sticky top-0 z-40 border-b bg-background/95 backdrop-blur">

        <div className="mx-auto grid max-w-[1700px] grid-cols-[1fr_auto_1fr] items-center px-4 py-3 sm:px-8">

          <div className="flex justify-start"><Button size="icon" variant="ghost" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu /></Button></div><h1 className="wordmark text-center">Better<span>FPL</span></h1>

          <div className="flex justify-end"><Button size="icon" variant="ghost" onClick={() => setDarkMode((current) => !current)} aria-label={darkMode ? 'Use light mode' : 'Use dark mode'}>{darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button></div>

        </div>

      </header>



      <Sheet open={menuOpen} onOpenChange={setMenuOpen}><SheetContent side="left" className="border-r bg-sidebar p-0 data-[side=left]:w-[290px]" aria-label="Navigation menu"><SheetHeader className="border-b px-5 py-4"><SheetTitle className="text-xl font-black text-primary">BetterFPL</SheetTitle><SheetDescription>Choose a workspace</SheetDescription></SheetHeader><nav className="space-y-1 px-3 py-3">{navItems.map((item) => { const Icon = item.icon; const count = item.id === 'shortlist' ? shortlist.length : item.id === 'compare' ? compare.length : item.id === 'planner' ? plan.length : null; return <button key={item.id} onClick={() => { setView(item.id); setMenuOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${view === item.id ? 'border-primary bg-primary text-primary-foreground' : 'border-transparent text-sidebar-foreground hover:border-sidebar-border hover:bg-sidebar-accent'}`}><Icon className="size-5" />{item.label}{count !== null && <Badge variant="secondary" className="ml-auto">{count}</Badge>}</button>; })}</nav></SheetContent></Sheet>



      <div className="mx-auto max-w-[1700px]">

        <section className="min-w-0 px-4 py-4 sm:px-8"><div className="mb-3 flex items-end justify-between"><h2 className="workspace-title">{navItems.find((item) => item.id === view)?.label}</h2></div>

          {data.message && <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"><span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" /><p>{data.message}</p></div>}



          {(view === 'players' || view === 'shortlist') && <>

            <div className="mb-3 flex flex-col gap-2 rounded-xl border bg-card p-2 xl:flex-row xl:items-center">

              <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player or team" className="pl-9" aria-label="Search players" /></div>

              <Tabs value={position} onValueChange={setPosition}><TabsList>{['ALL', 'GKP', 'DEF', 'MID', 'FWD'].map((item) => <TabsTrigger key={item} value={item}>{item}</TabsTrigger>)}</TabsList></Tabs>

              <Select value={team} onValueChange={(value) => setTeam(value ?? 'ALL')}><SelectTrigger className="w-full xl:w-40"><SelectValue>{team === 'ALL' ? 'All teams' : team}</SelectValue></SelectTrigger><SelectContent><SelectItem value="ALL">All teams</SelectItem>{data.teams.map((item) => <SelectItem key={item.id} value={item.shortName}>{item.shortName} · {item.name}</SelectItem>)}</SelectContent></Select>

              <Select value={maxPrice} onValueChange={(value) => setMaxPrice(value ?? '20')}><SelectTrigger className="w-full xl:w-32"><SelectValue>{maxPrice === '20' ? 'Any price' : `≤ £${maxPrice}m`}</SelectValue></SelectTrigger><SelectContent>{['20','12','10','8','6','5'].map((value) => <SelectItem key={value} value={value}>{value === '20' ? 'Any price' : `≤ £${value}m`}</SelectItem>)}</SelectContent></Select>

              <Button variant="outline" onClick={() => { setQuery(''); setPosition('ALL'); setTeam('ALL'); setMaxPrice('20'); }}><SlidersHorizontal className="size-4" />Reset</Button>

            </div>

            {table}

          </>}



          {view === 'compare' && <div>

            {comparedPlayers.length === 0 ? <div className="rounded-xl border bg-card px-6 py-12 text-center"><GitCompareArrows className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-semibold">Your comparison tray is empty</p><Button className="mt-4" onClick={() => setView('players')}>Choose players</Button></div> : <div className="overflow-hidden rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>Metric</TableHead>{comparedPlayers.map((player) => <TableHead key={player.id}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><ClubBadge code={teamByShortName.get(player.team)?.code} shortName={player.team} name={player.teamName} /><span>{player.name}<span className="block text-xs font-normal text-muted-foreground">{player.team} · £{player.price.toFixed(1)}m</span></span></div><Button size="icon-sm" variant="ghost" onClick={() => toggleCompare(player.id)}><X className="size-4" /></Button></div></TableHead>)}</TableRow></TableHeader><TableBody>{[

              ['Total points',(p:Player)=>p.points],['Form',(p:Player)=>p.form.toFixed(1)],['Points / game',(p:Player)=>p.pointsPerGame.toFixed(1)],['Points / £m',(p:Player)=>p.value.toFixed(1)],['Minutes',(p:Player)=>formatNumber(p.minutes)],['Goals',(p:Player)=>p.goals],['Assists',(p:Player)=>p.assists],['Expected goals',(p:Player)=>p.xG.toFixed(1)],['Expected assists',(p:Player)=>p.xA.toFixed(1)],['Expected involvements',(p:Player)=>p.xGI.toFixed(1)],['ICT index',(p:Player)=>p.ict.toFixed(1)],['Net transfers GW',(p:Player)=>formatNumber(p.transfersIn-p.transfersOut)],

            ].map(([label, getter]) => <TableRow key={label as string}><TableCell className="font-medium text-muted-foreground">{label as string}</TableCell>{comparedPlayers.map((player) => <TableCell key={player.id} className={`font-mono font-semibold ${label === 'Form' ? formClass(player.form) : ''}`}>{(getter as (p:Player)=>string|number)(player)}</TableCell>)}</TableRow>)}</TableBody></Table></div>}

          </div>}



          {view === 'fixtures' && <div className="grid gap-3 xl:grid-cols-2">{fixturesByEvent.map(([event, fixtures]) => <section key={event} className="rounded-xl border bg-card"><div className="border-b px-4 py-2.5"><h3 className="font-semibold">Gameweek {event || 'TBC'}</h3></div><div className="divide-y">{fixtures.map((fixture) => { const homeElo = clubEloByCode.get(fixture.homeCode); const awayElo = clubEloByCode.get(fixture.awayCode); const eloTitle = homeElo?.source === 'ClubElo' ? 'ClubElo rating' : 'Local results-based Elo (ClubElo fallback)'; return <div key={fixture.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2 text-sm"><div className="text-right"><div><span className="font-semibold">{fixture.homeTeam}</span><span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${fdrClass(fixture.homeDifficulty)}`}>{fixture.homeDifficulty}</span></div>{homeElo && <p className="mt-0.5 font-mono text-xs text-muted-foreground" title={eloTitle}>Elo {Math.round(homeElo.elo)}</p>}</div><div className="text-center"><p className="font-mono text-xs text-muted-foreground">{formatFixtureDate(fixture.kickoff)}</p><p className="text-xs text-muted-foreground">vs</p>{homeElo && awayElo && <p className="mt-0.5 font-mono text-[11px] font-semibold text-primary" title={`${eloTitle} difference`}>{Math.abs(Math.round(homeElo.elo-awayElo.elo))} Δ</p>}</div><div><div><span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${fdrClass(fixture.awayDifficulty)}`}>{fixture.awayDifficulty}</span><span className="font-semibold">{fixture.awayTeam}</span></div>{awayElo && <p className="mt-0.5 font-mono text-xs text-muted-foreground" title={eloTitle}>Elo {Math.round(awayElo.elo)}</p>}</div></div>; })}</div></section>)}</div>}



          {view === 'matches' && <MatchCentre data={analytics} />}



          {view === 'teams' && activeTeam && <div>

            <div className="mb-4 flex justify-start"><Select value={activeTeam.shortName} onValueChange={(value) => setSelectedTeam(value ?? activeTeam.shortName)}><SelectTrigger className="w-full sm:w-72"><SelectValue>{activeTeam.shortName} · {activeTeam.name}</SelectValue></SelectTrigger><SelectContent>{data.teams.map((item) => <SelectItem key={item.id} value={item.shortName}>{item.shortName} · {item.name}</SelectItem>)}</SelectContent></Select></div>

            <div className="planner-metrics grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">{[

              ['Squad FPL points',activeTeamPlayers.reduce((sum,player)=>sum+player.points,0).toFixed(0)],

              ['Goals',activeTeamPlayers.reduce((sum,player)=>sum+player.goals,0).toFixed(0)],

              ['Expected involvements',activeTeamPlayers.reduce((sum,player)=>sum+player.xGI,0).toFixed(1)],

              ['Clean-sheet returns',activeTeamPlayers.reduce((sum,player)=>sum+player.cleanSheets,0).toFixed(0)],

              ['Avg next-six FDR',(activeTeamRun.reduce((sum,item)=>sum+item.difficulty,0)/Math.max(activeTeamRun.length,1)).toFixed(2)],

            ].map(([label,value]) => <div key={label} className="rounded-lg border bg-card p-4"><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-2 font-mono text-2xl font-bold">{value}</p></div>)}</div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[1.35fr_1fr]">

              <section className="overflow-hidden rounded-xl border bg-card"><div className="flex items-center justify-between border-b px-4 py-2.5"><h3 className="font-semibold">Leading assets</h3><span className="text-sm text-muted-foreground">Projected over next 3</span></div><Table><TableHeader><TableRow><TableHead>Player</TableHead><TableHead>Pos</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Form</TableHead><TableHead className="text-right">xGI/90</TableHead><TableHead className="text-right">Proj.</TableHead></TableRow></TableHeader><TableBody>{activeTeamPlayers.sort((a,b)=>expectedPoints(b,data,3)-expectedPoints(a,data,3)).slice(0,10).map((player)=><TableRow key={player.id}><TableCell><div className="flex items-center gap-2"><ClubBadge code={teamByShortName.get(player.team)?.code} shortName={player.team} name={player.teamName} /><button className="font-semibold hover:underline" onClick={()=>setActivePlayerId(player.id)}>{player.name}</button></div></TableCell><TableCell><Badge variant="outline">{player.position}</Badge></TableCell><TableCell className="text-right font-mono">£{player.price.toFixed(1)}</TableCell><TableCell className={`text-right font-mono ${formClass(player.form)}`}>{player.form.toFixed(1)}</TableCell><TableCell className="text-right font-mono">{per90(player.xGI,player.minutes).toFixed(2)}</TableCell><TableCell className="text-right font-mono font-bold">{expectedPoints(player,data,3).toFixed(1)}</TableCell></TableRow>)}</TableBody></Table></section>

              <section className="rounded-lg border bg-card"><div className="border-b px-4 py-3"><h3 className="font-semibold">Fixture run</h3></div><div className="space-y-2 p-4">{activeTeamRun.map((item,index)=><div key={`${item.event}-${index}`} className="grid grid-cols-[54px_1fr_auto] items-center rounded-md border px-3 py-2"><span className="text-sm text-muted-foreground">GW {item.event ?? '—'}</span><span className="font-semibold">{item.opponent} <span className="font-normal text-muted-foreground">({item.venue})</span></span><span className={`rounded px-2 py-1 text-xs font-bold ${fdrClass(item.difficulty)}`}>{item.difficulty}</span></div>)}</div><div className="border-t px-4 py-3 text-sm text-muted-foreground">Team totals are sums of FPL player records, not Opta team-event data.</div></section>

            </div>

          </div>}



          {view === 'tactics' && <TacticalLab data={analytics} />}



          {view === 'projections' && <div>

            <div className="mb-4 flex justify-start"><Tabs value={projectionTab} onValueChange={setProjectionTab}><TabsList className="group-data-horizontal/tabs:h-11"><TabsTrigger className="px-5 text-base font-bold" value="players">Player projections</TabsTrigger><TabsTrigger className="px-5 text-base font-bold" value="fixtures">Fixture edges</TabsTrigger></TabsList></Tabs></div>

            {projectionTab === 'players' ? <>

              <div className="relative mb-3 max-w-md"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input value={projectionQuery} onChange={(event)=>setProjectionQuery(event.target.value)} placeholder="Search projected players or teams" aria-label="Search projected players" className="h-10 pl-9 text-base font-semibold"/></div>

              <div className="overflow-hidden rounded-xl border bg-card"><Table containerClassName="max-h-[calc(100vh-170px)] overflow-auto"><TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_var(--border)]"><TableRow><TableHead className="w-20">Plan</TableHead><TableHead>Player</TableHead><TableHead>Next 3</TableHead><TableHead className="text-right">xPts next</TableHead><TableHead className="text-right">xPts 3GW</TableHead><TableHead className="text-right">xGI / 90</TableHead><TableHead className="text-right">Minutes reliability</TableHead><TableHead className="text-right">Net transfers</TableHead></TableRow></TableHeader><TableBody>{visibleProjectedPlayers.slice(0,100).map(({player,next,next3,reliability,xgi90,run})=><TableRow key={player.id}><TableCell><Button size="icon-sm" variant={plan.includes(player.id)?'secondary':'ghost'} onClick={()=>togglePlan(player.id)} disabled={!plan.includes(player.id)&&plan.length>=15} aria-label={`${plan.includes(player.id)?'Remove':'Add'} ${player.name} ${plan.includes(player.id)?'from':'to'} planner`}>{plan.includes(player.id)?<Check className="size-4"/>:<Plus className="size-4"/>}</Button></TableCell><TableCell><div className="flex items-center gap-2"><ClubBadge code={teamByShortName.get(player.team)?.code} shortName={player.team} name={player.teamName} /><button className="text-left hover:underline" onClick={()=>setActivePlayerId(player.id)}><span className="font-semibold">{player.name}</span><span className="block text-sm text-muted-foreground">{player.team} · {player.position} · £{player.price.toFixed(1)}m</span></button></div></TableCell><TableCell><div className="flex gap-1">{run.map((item,index)=><span key={`${item.event}-${index}`} className={`rounded px-1.5 py-1 text-xs font-semibold ${fdrClass(item.difficulty)}`}>{item.opponent}</span>)}</div></TableCell><TableCell className="text-right font-mono font-semibold">{next.toFixed(1)}</TableCell><TableCell className="text-right font-mono font-bold text-primary">{next3.toFixed(1)}</TableCell><TableCell className="text-right font-mono">{xgi90.toFixed(2)}</TableCell><TableCell className="text-right"><div className="ml-auto flex w-28 items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{width:`${reliability}%`}} /></div><span className="w-8 font-mono text-sm text-muted-foreground">{reliability}%</span></div></TableCell><TableCell className={`text-right font-mono ${player.transfersIn-player.transfersOut>=0?'text-emerald-700':'text-rose-700'}`}>{formatNumber(player.transfersIn-player.transfersOut)}</TableCell></TableRow>)}</TableBody></Table></div>

              {visibleProjectedPlayers.length===0&&<div className="rounded-lg border px-6 py-12 text-center text-sm text-muted-foreground">No projected players match that search.</div>}

              <p className="mt-3 text-sm text-muted-foreground">These are planning estimates, not bookmaker odds or an official FPL prediction. Double gameweeks are counted when present in the fixture feed.</p>

            </> : <FixtureEdges fpl={data} analytics={analytics} />}

          </div>}



          {view === 'planner' && <div>

            <section className="planner-import mb-3 border-b pb-3">

              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">

                <div className="flex-1"><label htmlFor="fpl-entry" className="mb-1.5 block text-sm font-bold">FPL team ID</label><div className="flex max-w-lg gap-2"><Input id="fpl-entry" inputMode="numeric" value={entryId} onChange={(event)=>setEntryId(event.target.value.replace(/\D/g,''))} onKeyDown={(event)=>{if(event.key==='Enter')void importFplTeam();}} placeholder="e.g. 1234567" className="h-10 text-base font-semibold"/><Button onClick={()=>void importFplTeam()} disabled={entryLoading}>{entryLoading?'Loading…':'Load team'}</Button></div><p className="mt-2 text-sm text-muted-foreground">fantasy.premierleague.com/entry/<b>1234567</b></p></div>

                <div className="flex gap-2">{importedTeam&&<Button variant="outline" onClick={()=>{setPlan(importedPlayerIds);setCaptainId(importedTeam.picks.find((pick)=>pick.captain)?.playerId??null);}}><RotateCcw className="size-4"/>Reset preview</Button>}</div>

              </div>

              {entryError&&<p className="mt-3 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{entryError}</p>}

              {importedTeam&&<div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-[1fr_auto]"><div><h3 className="text-xl font-black">{importedTeam.teamName}</h3><p className="text-sm text-muted-foreground">{importedTeam.managerName} · loaded from GW {importedTeam.event}</p></div><div className="flex flex-wrap gap-x-6 gap-y-2 text-sm sm:text-right"><div><p className="text-muted-foreground">Overall</p><p className="font-mono font-bold">{formatNumber(importedTeam.overallPoints)} pts</p></div><div><p className="text-muted-foreground">Rank</p><p className="font-mono font-bold">{formatNumber(importedTeam.overallRank)}</p></div><div><p className="text-muted-foreground">Value + bank</p><p className="font-mono font-bold">£{importedTeam.value.toFixed(1)}m + £{importedTeam.bank.toFixed(1)}m</p></div></div></div>}

            </section>

            <div className="planner-metrics grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">{[

              ['Players',`${plan.length}/15`],['Budget',`£${planCost.toFixed(1)}m`],['Remaining',`£${Math.max(0,100-planCost).toFixed(1)}m`],['Projected next GW',planProjection.toFixed(1)],['Team-limit flags',overLimitTeams.length?overLimitTeams.join(', '):'None'],

            ].map(([label,value])=><div key={label} className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 font-mono text-xl font-bold">{value}</p></div>)}</div>

            {importedTeam&&<div className="mt-4 grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-2"><div><p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Previewed in ({previewIncoming.length})</p><div className="mt-2 flex flex-wrap gap-2">{previewIncoming.length?previewIncoming.map((player)=><Badge key={player.id} variant="secondary">{player.name}</Badge>):<span className="text-sm text-muted-foreground">No incoming players</span>}</div></div><div><p className="text-sm font-bold text-rose-800 dark:text-rose-300">Previewed out ({previewOutgoing.length})</p><div className="mt-2 flex flex-wrap gap-2">{previewOutgoing.length?previewOutgoing.map((player)=><Badge key={player.id} variant="outline">{player.name}</Badge>):<span className="text-sm text-muted-foreground">No outgoing players</span>}</div></div></div>}

            <PlannerWorkspace data={data} projections={projectedPlayers} plan={plan} captainId={captainId} shortlist={shortlist} onToggle={togglePlan} onCaptain={setCaptainId} onPlayer={setActivePlayerId} onReplace={(outgoing, incoming) => { setPlan((current) => current.includes(outgoing) && !current.includes(incoming) ? current.map((id) => id === outgoing ? incoming : id) : current); if (captainId === outgoing) setCaptainId(incoming); }} />

            <div className="mt-4 rounded-lg border bg-card p-4"><h3 className="font-semibold">Squad checks</h3><div className="mt-3 flex flex-wrap gap-2"><Badge variant={plan.length===15?'secondary':'outline'}>{plan.length===15?'15 players complete':`${15-plan.length} places open`}</Badge><Badge variant={planCost<=100?'secondary':'destructive'}>{planCost<=100?'Within £100m':'Over budget'}</Badge><Badge variant={overLimitTeams.length===0?'secondary':'destructive'}>{overLimitTeams.length===0?'Club limits clear':'More than 3 from a club'}</Badge><Badge variant={planPositions.every((group)=>group.players.length===group.target)?'secondary':'outline'}>{planPositions.every((group)=>group.players.length===group.target)?'Position structure complete':'Position structure incomplete'}</Badge></div></div>

          </div>}

        </section>

      </div>



      <Sheet open={Boolean(activePlayer)} onOpenChange={(open) => { if (!open) setActivePlayerId(null); }}><SheetContent className="data-[side=right]:w-full data-[side=right]:sm:w-3/4 data-[side=right]:sm:max-w-4xl overflow-y-auto [&_.text-xs]:text-sm"><SheetHeader>{activePlayer && <div className="flex items-center gap-3"><ClubBadge code={teamByShortName.get(activePlayer.team)?.code} shortName={activePlayer.team} name={activePlayer.teamName} className="size-11" /><div><SheetTitle className="text-xl">{activePlayer.fullName}</SheetTitle><SheetDescription className="text-base">{activePlayer.teamName} · {activePlayer.position} · £{activePlayer.price.toFixed(1)}m</SheetDescription></div></div>}</SheetHeader>{activePlayer && <>

        <div className="px-4"><Tabs value={playerPanelTab} onValueChange={setPlayerPanelTab}><TabsList className="grid w-full grid-cols-3"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="advanced">Advanced</TabsTrigger><TabsTrigger value="matches">Matches</TabsTrigger></TabsList></Tabs></div>



        {playerPanelTab === 'overview' && <div className="space-y-4 px-4 pb-5">

          <div className="grid grid-cols-3 gap-2">{[['Points',activePlayer.points],['Form',activePlayer.form.toFixed(1)],['Next xPts',expectedPoints(activePlayer,data,1).toFixed(1)],['xGI',activePlayer.xGI.toFixed(1)],['xGI / 90',per90(activePlayer.xGI,activePlayer.minutes).toFixed(2)],['Minutes',formatNumber(activePlayer.minutes)]].map(([label,value]) => <div key={label} className="min-w-0 rounded-xl border bg-muted/35 p-2.5"><p className="truncate text-sm font-medium text-muted-foreground">{label}</p><p className={`mt-1 truncate font-mono text-2xl font-black leading-none tracking-tight sm:text-3xl ${label === 'Form' ? formClass(activePlayer.form) : ''}`}>{value}</p></div>)}</div>

          {activePlayer.news && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Availability note</p><p className="mt-1">{activePlayer.news}</p></div>}

          <section><h3 className="font-semibold">FPL underlying data</h3><div className="mt-2 divide-y rounded-md border text-base">{[['Expected goals',activePlayer.xG.toFixed(2)],['Expected assists',activePlayer.xA.toFixed(2)],['Influence',activePlayer.influence.toFixed(1)],['Creativity',activePlayer.creativity.toFixed(1)],['Threat',activePlayer.threat.toFixed(1)],['Bonus points',activePlayer.bonus]].map(([label,value]) => <div key={label} className="flex justify-between px-3 py-2.5"><span className="text-muted-foreground">{label}</span><span className="font-mono font-semibold">{value}</span></div>)}</div></section>

          <section id="shortlist"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Your decision</h3><div className="flex gap-2"><Button variant={plan.includes(activePlayer.id)?'secondary':'outline'} size="sm" onClick={()=>togglePlan(activePlayer.id)}>{plan.includes(activePlayer.id)?<><Check className="size-4"/>In planner</>:<><Plus className="size-4"/>Plan</>}</Button><Button variant={shortlist.includes(activePlayer.id) ? 'secondary' : 'default'} size="sm" onClick={() => toggleShortlist(activePlayer.id)}>{shortlist.includes(activePlayer.id) ? <><Check className="size-4" />Shortlisted</> : <><Star className="size-4" />Add to shortlist</>}</Button></div></div><div className="mt-3 space-y-3"><div><label className="mb-1 block text-sm font-medium">Status</label><Select value={meta[activePlayer.id]?.status ?? 'watch'} onValueChange={(value) => updateMeta(activePlayer.id,{status:(value ?? 'watch') as PlayerMeta['status']})}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="watch">Watch</SelectItem><SelectItem value="target">Target</SelectItem><SelectItem value="avoid">Avoid</SelectItem></SelectContent></Select></div><div><label className="mb-1 block text-sm font-medium" htmlFor="tags">Tags</label><Input id="tags" value={meta[activePlayer.id]?.tags ?? ''} onChange={(event)=>updateMeta(activePlayer.id,{tags:event.target.value})} placeholder="set pieces, minutes risk, differential" /></div><div><label className="mb-1 block text-sm font-medium" htmlFor="notes">Notes</label><Textarea id="notes" value={meta[activePlayer.id]?.notes ?? ''} onChange={(event)=>updateMeta(activePlayer.id,{notes:event.target.value})} placeholder="Why are you watching this player?" rows={5} /></div><p className="text-xs text-muted-foreground">Saved automatically in this browser on this PC.</p></div></section>

        </div>}



        {playerPanelTab === 'advanced' && <div className="space-y-4 px-4 pb-5">{activePlayerAnalytics ? <>

          <div className="grid grid-cols-3 gap-2">{[['xG / 90',per90(activePlayerAnalytics.xg,activePlayerAnalytics.minutes).toFixed(2)],['xA / 90',per90(activePlayerAnalytics.xa,activePlayerAnalytics.minutes).toFixed(2)],['xGI / 90',per90(activePlayerAnalytics.xg+activePlayerAnalytics.xa,activePlayerAnalytics.minutes).toFixed(2)],['Shots / 90',per90(activePlayerAnalytics.shots,activePlayerAnalytics.minutes).toFixed(2)],['Key passes / 90',per90(activePlayerAnalytics.keyPasses,activePlayerAnalytics.minutes).toFixed(2)],['xG chain / 90',per90(activePlayerAnalytics.xgChain,activePlayerAnalytics.minutes).toFixed(2)]].map(([label,value]) => <div key={label} className="min-w-0 rounded-xl border bg-muted/35 p-2.5"><p className="truncate text-sm font-medium text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-2xl font-black leading-none tracking-tight sm:text-3xl">{value}</p></div>)}</div>

          <section><h3 className="font-semibold">Understat season totals</h3><div className="mt-2 divide-y rounded-md border text-base">{[['Primary role',activePlayerAnalytics.position],['Appearances',activePlayerAnalytics.appearances],['Starts',activePlayerAnalytics.starts],['Minutes',activePlayerAnalytics.minutes],['Goals',activePlayerAnalytics.goals],['Assists',activePlayerAnalytics.assists],['Expected goals',activePlayerAnalytics.xg.toFixed(2)],['Expected assists',activePlayerAnalytics.xa.toFixed(2)],['Shots',activePlayerAnalytics.shots],['Key passes',activePlayerAnalytics.keyPasses],['xG build-up',activePlayerAnalytics.xgBuildup.toFixed(2)]].map(([label,value]) => <div key={label} className="flex justify-between px-3 py-2.5"><span className="text-muted-foreground">{label}</span><span className="font-mono font-semibold">{value}</span></div>)}</div></section>

          <p className="text-sm text-muted-foreground">Per-90 figures use actual Understat minutes and are kept separate from the official FPL totals.</p>

        </> : <div className="rounded-lg border px-5 py-12 text-center"><p className="font-semibold">No safe Understat match</p><p className="mt-1 text-sm text-muted-foreground">This player could not be linked automatically by club and name.</p></div>}

          {activeWhoScoredPlayer && <section><div className="mb-2 flex items-center justify-between gap-3"><h3 className="font-semibold">WhoScored event profile</h3><span className="text-sm text-muted-foreground">{activeWhoScoredPlayer.matches} matches</span></div><div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border">{[
            ['Pass completion', activeWhoScoredPlayer.passesAttempted ? `${Math.round(activeWhoScoredPlayer.passesCompleted / activeWhoScoredPlayer.passesAttempted * 100)}%` : '—'],
            ['Touches / match', (activeWhoScoredPlayer.touches / Math.max(1, activeWhoScoredPlayer.matches)).toFixed(1)],
            ['Def. actions / match', ((activeWhoScoredPlayer.tacklesWon + activeWhoScoredPlayer.interceptions + activeWhoScoredPlayer.clearances) / Math.max(1, activeWhoScoredPlayer.matches)).toFixed(1)],
            ['Take-ons won', activeWhoScoredPlayer.takeOnsWon],
            ['Aerials won', activeWhoScoredPlayer.aerialsWon],
            ['Dispossessed / match', (activeWhoScoredPlayer.dispossessed / Math.max(1, activeWhoScoredPlayer.matches)).toFixed(1)],
          ].map(([label, value]) => <div key={label} className="min-w-0 bg-card p-2.5"><p className="truncate text-sm font-medium text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-xl font-black leading-none">{value}</p></div>)}</div></section>}

        </div>}



        {playerPanelTab === 'matches' && <div className="space-y-4 px-4 pb-5">

          <section><h3 className="mb-2 font-semibold">Upcoming fixtures</h3><div className="grid gap-2 sm:grid-cols-2">{activePlayerUpcomingFixtures.map((fixture) => { const home = fixture.homeCode === activePlayer.team; const opponent = home ? fixture.awayTeam : fixture.homeTeam; const difficulty = home ? fixture.homeDifficulty : fixture.awayDifficulty; return <div key={fixture.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border px-3 py-2.5"><span className="font-mono text-sm text-muted-foreground">GW {fixture.event ?? '—'}</span><div><p className="font-semibold">{opponent} <span className="font-normal text-muted-foreground">({home?'H':'A'})</span></p><p className="text-sm text-muted-foreground">{formatFixtureDate(fixture.kickoff)}</p></div><span className={`rounded px-2 py-1 text-xs font-bold ${fdrClass(difficulty)}`}>{difficulty}</span></div>; })}</div>{activePlayerUpcomingFixtures.length === 0 && <div className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground">No upcoming fixtures available.</div>}</section>

          <section><h3 className="mb-2 font-semibold">Recent matches</h3>{activePlayerHistory.length ? <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Opponent</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Min</TableHead><TableHead className="text-right">xG</TableHead><TableHead className="text-right">xA</TableHead><TableHead className="text-right">Shots / KP</TableHead></TableRow></TableHeader><TableBody>{activePlayerHistory.map((row) => { const match = analyticsMatchesById.get(row.matchId); const home = match?.homeCode === activePlayer.team; const opponent = match ? home ? match.awayTeam : match.homeTeam : '—'; return <TableRow key={row.matchId}><TableCell><span className="font-medium">{opponent} <span className="text-muted-foreground">({home?'H':'A'})</span></span><span className="block font-mono text-xs text-muted-foreground">{match?.date.slice(0,10) ?? '—'}</span></TableCell><TableCell><Badge variant="outline">{row.position}</Badge></TableCell><TableCell className="text-right font-mono">{row.minutes}</TableCell><TableCell className="text-right font-mono">{row.xg.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{row.xa.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{row.shots} / {row.keyPasses}</TableCell></TableRow>; })}</TableBody></Table></div> : <div className="rounded-lg border px-5 py-12 text-center"><p className="font-semibold">No match log available</p><p className="mt-1 text-sm text-muted-foreground">No safely linked Understat appearances were found.</p></div>}</section>

        </div>}

      </>}</SheetContent></Sheet>

    </main>

  );

}

