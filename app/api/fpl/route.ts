import { sampleData, type DashboardData, type Fixture, type Player, type Team } from '@/lib/fpl-data';

export const dynamic = 'force-dynamic';

const positions = ['GKP', 'DEF', 'MID', 'FWD'] as const;

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET() {
  try {
    const [bootstrapResponse, fixturesResponse] = await Promise.all([
      fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { headers: { Accept: 'application/json' } }),
      fetch('https://fantasy.premierleague.com/api/fixtures/', { headers: { Accept: 'application/json' } }),
    ]);
    if (!bootstrapResponse.ok || !fixturesResponse.ok) throw new Error('FPL source did not respond successfully');

    const bootstrap = await bootstrapResponse.json() as any;
    const rawFixtures = await fixturesResponse.json() as any[];
    const teams: Team[] = bootstrap.teams.map((team: any) => ({ id: team.id, code: team.code, name: team.name, shortName: team.short_name, strength: team.strength }));
    const teamById = new Map(bootstrap.teams.map((team: any) => [team.id, team]));
    const currentEvent = bootstrap.events.find((event: any) => event.is_current)?.id ?? bootstrap.events.find((event: any) => event.is_next)?.id ?? null;

    const fixtures: Fixture[] = rawFixtures.filter((fixture: any) => !fixture.finished).map((fixture: any) => {
      const home: any = teamById.get(fixture.team_h);
      const away: any = teamById.get(fixture.team_a);
      return { id: fixture.id, event: fixture.event, kickoff: fixture.kickoff_time, homeTeam: home?.name ?? 'TBC', awayTeam: away?.name ?? 'TBC', homeCode: home?.short_name ?? '—', awayCode: away?.short_name ?? '—', homeDifficulty: fixture.team_h_difficulty, awayDifficulty: fixture.team_a_difficulty };
    });

    const nextByTeam = new Map<number, { label: string; difficulty: number }>();
    for (const fixture of rawFixtures.filter((item: any) => !item.finished).sort((a: any, b: any) => String(a.kickoff_time).localeCompare(String(b.kickoff_time)))) {
      const home: any = teamById.get(fixture.team_h);
      const away: any = teamById.get(fixture.team_a);
      if (!nextByTeam.has(fixture.team_h)) nextByTeam.set(fixture.team_h, { label: `${away?.short_name ?? 'TBC'} (H)`, difficulty: fixture.team_h_difficulty });
      if (!nextByTeam.has(fixture.team_a)) nextByTeam.set(fixture.team_a, { label: `${home?.short_name ?? 'TBC'} (A)`, difficulty: fixture.team_a_difficulty });
    }

    const players: Player[] = bootstrap.elements.map((item: any) => {
      const team: any = teamById.get(item.team);
      const next = nextByTeam.get(item.team);
      const price = item.now_cost / 10;
      return {
        id: item.id,
        name: item.web_name,
        fullName: `${item.first_name} ${item.second_name}`.trim(),
        team: team?.short_name ?? '—',
        teamName: team?.name ?? 'Unknown',
        position: positions[item.element_type - 1] ?? 'MID',
        price,
        points: number(item.total_points),
        form: number(item.form),
        selected: number(item.selected_by_percent),
        minutes: number(item.minutes),
        starts: number(item.starts),
        pointsPerGame: number(item.points_per_game),
        value: price ? Number((number(item.total_points) / price).toFixed(1)) : 0,
        goals: number(item.goals_scored), assists: number(item.assists), cleanSheets: number(item.clean_sheets), bonus: number(item.bonus), bps: number(item.bps),
        ict: number(item.ict_index), influence: number(item.influence), creativity: number(item.creativity), threat: number(item.threat),
        xG: number(item.expected_goals), xA: number(item.expected_assists), xGI: number(item.expected_goal_involvements), xGC: number(item.expected_goals_conceded),
        transfersIn: number(item.transfers_in_event), transfersOut: number(item.transfers_out_event), status: item.status, chance: item.chance_of_playing_next_round, news: item.news ?? '',
        nextFixture: next?.label ?? 'TBC', nextDifficulty: next?.difficulty ?? 3,
      };
    });

    const data: DashboardData = { players, teams, fixtures, gameweek: currentEvent, fetchedAt: new Date().toISOString(), source: 'live' };
    return Response.json(data, { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=900' } });
  } catch {
    return Response.json({ ...sampleData, fetchedAt: new Date().toISOString(), message: 'The public FPL feed is currently unreachable. The dashboard is using its bundled demonstration dataset and will retry when refreshed.' });
  }
}
