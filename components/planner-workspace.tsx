'use client';

import { useMemo, useState } from 'react';
import { ArrowLeftRight, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClubBadge } from '@/components/club-badge';
import type { DashboardData, Player } from '@/lib/fpl-data';

type Projection = { player: Player; next: number; next3: number };
type Props = { data: DashboardData; projections: Projection[]; plan: number[]; captainId: number | null; shortlist: number[]; onToggle: (id: number) => void; onCaptain: (id: number | null) => void; onPlayer: (id: number) => void; onReplace: (outgoing: number, incoming: number) => void };
const positions = ['GKP', 'DEF', 'MID', 'FWD'] as const;
const targets = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };

export function PlannerWorkspace({ data, projections, plan, captainId, shortlist, onToggle, onCaptain, onPlayer, onReplace }: Props) {
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState('ALL');
  const [team, setTeam] = useState('ALL');
  const [price, setPrice] = useState('20');
  const [savedOnly, setSavedOnly] = useState(false);
  const [replacement, setReplacement] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState('squad');
  function browsePosition(pos: string, id: number | null = null) {
    setPosition(pos);
    setReplacement(id);
    setQuery('');
    setTeam('ALL');
    setPrice('20');
    setSavedOnly(false);
    setMobilePanel('pool');
  }
  const playerMap = useMemo(() => new Map(projections.map((row) => [row.player.id, row])), [projections]);
  const teamMap = useMemo(() => new Map(data.teams.map((club) => [club.shortName, club])), [data.teams]);
  const squad = plan.flatMap((id) => playerMap.get(id) ? [playerMap.get(id)!] : []);
  const outgoing = replacement !== null && plan.includes(replacement) ? playerMap.get(replacement)?.player : undefined;
  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projections.filter(({ player }) =>
      `${player.name} ${player.fullName} ${player.teamName}`.toLowerCase().includes(needle) &&
      (outgoing ? player.position === outgoing.position && !plan.includes(player.id) : position === 'ALL' || player.position === position) &&
      (team === 'ALL' || player.team === team) && player.price <= Number(price) && (!savedOnly || shortlist.includes(player.id)));
  }, [projections, query, position, team, price, savedOnly, shortlist, outgoing, plan]);

  return <><Tabs className="planner-mobile-tabs mt-3" value={mobilePanel} onValueChange={setMobilePanel}><TabsList className="w-full"><TabsTrigger className="flex-1" value="squad">Squad · {plan.length}/15</TabsTrigger><TabsTrigger className="flex-1" value="pool">Player pool</TabsTrigger></TabsList></Tabs><div className="planner-workspace" data-mobile-panel={mobilePanel}>
    <section className="planner-squad min-w-0 border bg-card">
      <div className="flex items-center justify-between border-b p-3"><h3 className="text-base font-semibold">Your squad</h3><span className="font-mono text-sm">{plan.length} / 15</span></div>
      {positions.map((pos) => { const rows = squad.filter(({ player }) => player.position === pos); return <div key={pos}>
        <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-1.5 text-xs tracking-wider"><span>{pos}</span><span className="font-mono">{rows.length} / {targets[pos]}</span></div>
        {rows.map(({ player, next }) => <div key={player.id} className={`squad-row ${outgoing?.id === player.id ? 'bg-accent' : ''}`}>
          <button className="flex min-w-0 items-center gap-2 text-left hover:text-primary" onClick={() => onPlayer(player.id)}><ClubBadge code={teamMap.get(player.team)?.code} shortName={player.team} name={player.teamName} className="size-6" /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{player.name}</span><span className="block truncate text-xs text-muted-foreground">{player.team} · £{player.price.toFixed(1)} · {next.toFixed(1)} xPts</span></span></button>
          <Button size="icon-sm" variant={captainId === player.id ? 'default' : 'ghost'} aria-label={`${captainId === player.id ? 'Remove captaincy from' : 'Captain'} ${player.name}`} onClick={() => onCaptain(captainId === player.id ? null : player.id)}>C</Button>
          <Button size="icon-sm" variant={outgoing?.id === player.id ? 'secondary' : 'ghost'} aria-label={`Replace ${player.name}`} onClick={() => outgoing?.id === player.id ? setReplacement(null) : browsePosition(player.position, player.id)}><ArrowLeftRight className="size-4" /></Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Remove ${player.name} from squad`} onClick={() => onToggle(player.id)}><X className="size-4" /></Button>
        </div>)}
        {rows.length < targets[pos] && <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-primary" onClick={() => browsePosition(pos)}><Plus className="size-4" />{targets[pos] - rows.length} open {pos} {targets[pos] - rows.length === 1 ? 'place' : 'places'}</button>}
      </div>; })}
    </section>
    <section className="planner-catalog min-w-0 border bg-card">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold">{outgoing ? `Replace ${outgoing.name}` : 'Player pool'}</h3>{outgoing ? <Button size="sm" variant="ghost" onClick={() => setReplacement(null)}>Cancel</Button> : <Button size="sm" variant={savedOnly ? 'secondary' : 'ghost'} onClick={() => setSavedOnly(!savedOnly)}>Shortlist</Button>}</div>
        <div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Search planner players" placeholder="Search players" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" /></div>
        {!outgoing && <Tabs value={position} onValueChange={setPosition}><TabsList className="w-full">{['ALL', ...positions].map((pos) => <TabsTrigger className="flex-1" key={pos} value={pos}>{pos}</TabsTrigger>)}</TabsList></Tabs>}
        <div className="grid grid-cols-2 gap-2"><Select value={team} onValueChange={(value) => setTeam(value ?? 'ALL')}><SelectTrigger className="w-full" aria-label="Planner club"><SelectValue>{team === 'ALL' ? 'All clubs' : team}</SelectValue></SelectTrigger><SelectContent><SelectItem value="ALL">All clubs</SelectItem>{data.teams.map((club) => <SelectItem key={club.id} value={club.shortName}>{club.name}</SelectItem>)}</SelectContent></Select><Select value={price} onValueChange={(value) => setPrice(value ?? '20')}><SelectTrigger className="w-full" aria-label="Planner maximum price"><SelectValue>{price === '20' ? 'Any price' : `≤ £${price}m`}</SelectValue></SelectTrigger><SelectContent>{['20','12','10','8','6','5'].map((value) => <SelectItem key={value} value={value}>{value === '20' ? 'Any price' : `≤ £${value}m`}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="flex justify-between border-b px-3 py-1.5 text-xs text-muted-foreground"><span>{candidates.length} players</span><span>Next GW / 3 GW</span></div>
      <div className="planner-catalog-list">{candidates.map(({ player, next, next3 }) => { const selected = plan.includes(player.id); return <div key={player.id} className="pool-row flex items-center gap-2 border-b px-3 py-2 last:border-0 hover:bg-muted/40">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-primary" onClick={() => onPlayer(player.id)}><ClubBadge code={teamMap.get(player.team)?.code} shortName={player.team} name={player.teamName} className="size-6" /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{player.name}</span><span className="block truncate text-xs text-muted-foreground">{player.team} · {player.position} · £{player.price.toFixed(1)}m</span></span></button>
        <div className="text-right font-mono text-sm"><span>{next.toFixed(1)}</span><span className="ml-3 text-muted-foreground">{next3.toFixed(1)}</span></div>
        <Button size="icon-sm" variant={selected ? 'secondary' : 'outline'} disabled={!outgoing && !selected && plan.length >= 15} aria-label={`${outgoing ? 'Replace ' + outgoing.name + ' with' : selected ? 'Remove' : 'Add'} ${player.name}`} onClick={() => { if (outgoing) { onReplace(outgoing.id, player.id); setReplacement(null); } else onToggle(player.id); }}>{outgoing ? <ArrowLeftRight className="size-4" /> : selected ? <X className="size-4" /> : <Plus className="size-4" />}</Button>
      </div>; })}{!candidates.length && <p className="p-8 text-center text-sm text-muted-foreground">No players match these filters.</p>}</div>
    </section>
  </div></>;
}
