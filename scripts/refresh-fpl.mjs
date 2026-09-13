import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public', 'fpl-data.json');
const temporary = `${output}.tmp`;
const positions = ['GKP', 'DEF', 'MID', 'FWD'];
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

async function request(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PL-Workbench/1.0',
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

try {
  const [bootstrap, rawFixtures] = await Promise.all([
    request('https://fantasy.premierleague.com/api/bootstrap-static/'),
    request('https://fantasy.premierleague.com/api/fixtures/'),
  ]);
  const teamById = new Map(bootstrap.teams.map((team) => [team.id, team]));
  const teams = bootstrap.teams.map((team) => ({ id: team.id, code: team.code, name: team.name, shortName: team.short_name, strength: team.strength }));
  const currentEvent = bootstrap.events.find((event) => event.is_current)?.id ?? bootstrap.events.find((event) => event.is_next)?.id ?? null;
  const upcoming = rawFixtures.filter((fixture) => !fixture.finished).sort((a, b) => String(a.kickoff_time).localeCompare(String(b.kickoff_time)));
  const fixtures = upcoming.map((fixture) => {
    const home = teamById.get(fixture.team_h);
    const away = teamById.get(fixture.team_a);
    return { id: fixture.id, event: fixture.event, kickoff: fixture.kickoff_time, homeTeam: home?.name ?? 'TBC', awayTeam: away?.name ?? 'TBC', homeCode: home?.short_name ?? '—', awayCode: away?.short_name ?? '—', homeDifficulty: fixture.team_h_difficulty, awayDifficulty: fixture.team_a_difficulty };
  });
  const nextByTeam = new Map();
  for (const fixture of upcoming) {
    const home = teamById.get(fixture.team_h);
    const away = teamById.get(fixture.team_a);
    if (!nextByTeam.has(fixture.team_h)) nextByTeam.set(fixture.team_h, { label: `${away?.short_name ?? 'TBC'} (H)`, difficulty: fixture.team_h_difficulty });
    if (!nextByTeam.has(fixture.team_a)) nextByTeam.set(fixture.team_a, { label: `${home?.short_name ?? 'TBC'} (A)`, difficulty: fixture.team_a_difficulty });
  }
  const players = bootstrap.elements.map((item) => {
    const team = teamById.get(item.team);
    const next = nextByTeam.get(item.team);
    const price = item.now_cost / 10;
    return {
      id: item.id, name: item.web_name, fullName: `${item.first_name} ${item.second_name}`.trim(), team: team?.short_name ?? '—', teamName: team?.name ?? 'Unknown', position: positions[item.element_type - 1] ?? 'MID', price,
      points: numeric(item.total_points), form: numeric(item.form), selected: numeric(item.selected_by_percent), minutes: numeric(item.minutes), starts: numeric(item.starts), pointsPerGame: numeric(item.points_per_game), value: price ? Number((numeric(item.total_points) / price).toFixed(1)) : 0,
      goals: numeric(item.goals_scored), assists: numeric(item.assists), cleanSheets: numeric(item.clean_sheets), bonus: numeric(item.bonus), bps: numeric(item.bps), ict: numeric(item.ict_index), influence: numeric(item.influence), creativity: numeric(item.creativity), threat: numeric(item.threat),
      xG: numeric(item.expected_goals), xA: numeric(item.expected_assists), xGI: numeric(item.expected_goal_involvements), xGC: numeric(item.expected_goals_conceded), transfersIn: numeric(item.transfers_in_event), transfersOut: numeric(item.transfers_out_event), status: item.status, chance: item.chance_of_playing_next_round, news: item.news ?? '', nextFixture: next?.label ?? 'TBC', nextDifficulty: next?.difficulty ?? 3,
    };
  });
  const data = { players, teams, fixtures, gameweek: currentEvent, fetchedAt: new Date().toISOString(), source: 'live' };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(temporary, JSON.stringify(data), 'utf8');
  await rename(temporary, output);
  console.log(`FPL data updated: ${players.length} players, ${fixtures.length} upcoming fixtures.`);
} catch (error) {
  console.warn(`Could not refresh FPL data. The last cache or demonstration data will be used. ${error instanceof Error ? error.message : ''}`);
}
