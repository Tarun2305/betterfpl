import type { PredictionInput } from './prediction-engine';
import type { Fixture, Player } from './fpl-data';
import {
  clamp,
  finite,
  logistic,
  minutesFeatures,
  teamCode,
  utcTime,
  type ForecastHistory,
  type HistoricalPlayer,
} from './football-model';

export const normalizeName = (s: string) =>
  s
    .replace(/[øØ]/g, 'o')
    .replace(/[łŁ]/g, 'l')
    .replace(/ß/g, 'ss')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
// Explicit aliases, not fuzzy guesses. Provider IDs carry identity across transfers.
const aliases: Record<string, string[]> = {
  'Benjamin White': ['Ben White'],
  'Bruno Borges Fernandes': ['Bruno Fernandes'],
  'Levi Samuels Colwill': ['Levi Colwill'],
  'Pedro Lomba Neto': ['Pedro Neto'],
  'Matty Cash': ['Matthew Cash'],
  'Emiliano Buendía Stati': ['Emiliano Buendia'],
  'Diego Gómez Amarilla': ['Diego Gomez'],
  'Yéremy Pino Santos': ['Yeremy Pino'],
  'Tanaka Ao': ['Ao Tanaka'],
  'Rúben dos Santos Gato Alves Dias': ['Ruben Dias'],
  'Daniel Ballard': ['Dan Ballard'],
  'Oli McBurnie': ['Oliver McBurnie'],
  'Jair Paula da Cunha Filho': ['Jair Cunha'],
  'Josh King': ['Joshua King'],
  'Diogo Dalot Teixeira': ['Diogo Dalot'],
  'Matheus Santos Carneiro da Cunha': ['Matheus Cunha'],
  'António João Pereira de Albuquerque Tavares da Silva': [
    'António Silva',
    'Antonio Silva',
  ],
};
export function playerNames(p: Pick<Player, 'fullName' | 'name'>) {
  return new Set(
    [p.fullName, p.name, ...(aliases[p.fullName] ?? [])].map(normalizeName),
  );
}
export function linkPlayer(p: Player, history: ForecastHistory) {
  const names = playerNames(p),
    byId = new Map(history.matches.map((m) => [m.id, m]));
  const candidates = history.playerMatches.filter((r) =>
    names.has(normalizeName(r.player)),
  );
  const current = candidates.filter((r) => {
    const m = byId.get(r.matchId);
    return (
      m &&
      ((r.team === m.homeTeam && teamCode(m.homeCode) === p.team) ||
        (r.team === m.awayTeam && teamCode(m.awayCode) === p.team))
    );
  });
  const ids = [
    ...new Set(
      (current.length ? current : candidates)
        .map((r) => r.playerId)
        .filter((id): id is number => finite(id)),
    ),
  ];
  if (ids.length === 1)
    return {
      rows: history.playerMatches.filter((r) => r.playerId === ids[0]),
      providerId: ids[0],
      method: 'verified name/team to provider ID' as const,
    };
  if (ids.length > 1)
    return { rows: [], providerId: null, method: 'ambiguous' as const };
  return {
    rows: current,
    providerId: null,
    method: current.length
      ? ('exact alias and team' as const)
      : ('unmatched' as const),
  };
}
const round = (x: number | null) =>
  x === null ? null : Math.round(x * 1000) / 1000;
export function fallbackHistory(input: PredictionInput): ForecastHistory {
  return {
    matches: input.analytics.matches,
    playerMatches: input.analytics.playerMatches,
    fetchedAt: input.analytics.fetchedAt,
    seasons: [input.analytics.season],
    warnings: ['Historical archive unavailable; current-season coverage only.'],
  };
}
export function buildFeatures(
  input: PredictionInput,
  fixture: Fixture,
  now: number,
) {
  const cutoff = Math.min(now, Date.parse(fixture.kickoff!)),
    raw = input.history ?? fallbackHistory(input);
  const matches = raw.matches
    .filter((m) => utcTime(m.date) < cutoff)
    .map((m) => ({
      ...m,
      homeCode: teamCode(m.homeCode),
      awayCode: teamCode(m.awayCode),
    }));
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const history = {
    ...raw,
    matches,
    playerMatches: raw.playerMatches.filter((r) => matchById.has(r.matchId)),
  };
  const teams = [fixture.homeCode, fixture.awayCode].map((code) => {
    const rows = matches
      .filter((m) => m.homeCode === code || m.awayCode === code)
      .sort((a, b) => utcTime(b.date) - utcTime(a.date));
    const recent = rows.slice(0, 6);
    const summarize = (limit: number) => {
      const sample = rows.slice(0, limit);
      const mean = (metric: 'homeXg' | 'awayXg', forTeam: boolean) => {
        const vals = sample
          .map((m) => {
            const home = m.homeCode === code;
            return m[
              home === forTeam
                ? metric
                : metric === 'homeXg'
                  ? 'awayXg'
                  : 'homeXg'
            ];
          })
          .filter(finite);
        return vals.length
          ? round(vals.reduce((s, v) => s + v, 0) / vals.length)
          : null;
      };
      return {
        matches: sample.length,
        xgFor: mean('homeXg', true),
        xgAgainst: mean('homeXg', false),
      };
    };
    const elo = input.enrichment.clubElo.find(
      (r) =>
        r.teamCode === code &&
        r.source === 'ClubElo' &&
        utcTime(r.date.length === 10 ? `${r.date}T00:00:00` : r.date) <
          cutoff &&
        cutoff - utcTime(`${r.date.slice(0, 10)}T00:00:00`) <= 7 * 86400000,
    );
    return {
      code,
      name: input.fpl.teams.find((t) => t.shortName === code)?.name ?? code,
      elo: elo ? { rating: elo.elo, source: elo.source } : null,
      lastSix: summarize(6),
      lastThirty: summarize(30),
      daysSinceLastLeagueMatch: rows[0]
        ? round((cutoff - utcTime(rows[0].date)) / 86400000)
        : null,
      recentMatches: recent.map((m) => ({
        date: m.date,
        venue: m.homeCode === code ? 'home' : 'away',
        opponent: m.homeCode === code ? m.awayCode : m.homeCode,
        goalsFor: m.homeCode === code ? m.homeGoals : m.awayGoals,
        goalsAgainst: m.homeCode === code ? m.awayGoals : m.homeGoals,
        xgFor: round(m.homeCode === code ? m.homeXg : m.awayXg),
        xgAgainst: round(m.homeCode === code ? m.awayXg : m.homeXg),
      })),
    };
  });
  const players = input.fpl.players
    .filter((p) => [fixture.homeCode, fixture.awayCode].includes(p.team))
    .map((p) => {
      const linked = linkPlayer(p, history),
        rows = linked.rows.sort(
          (a, b) =>
            utcTime(matchById.get(a.matchId)!.date) -
            utcTime(matchById.get(b.matchId)!.date),
        );
      const currentRows = rows.filter((r) => {
        const m = matchById.get(r.matchId)!;
        return (m.homeTeam === r.team ? m.homeCode : m.awayCode) === p.team;
      });
      // Fill observed non-appearances only after the player's first appearance for this club.
      const first = currentRows[0]
        ? utcTime(matchById.get(currentRows[0].matchId)!.date)
        : Infinity;
      const currentFixtures = matches
        .filter(
          (m) =>
            (m.homeCode === p.team || m.awayCode === p.team) &&
            utcTime(m.date) >= first,
        )
        .sort((a, b) => utcTime(a.date) - utcTime(b.date));
      const recent = currentFixtures
        .slice(-6)
        .map(
          (m) =>
            currentRows.find((r) => r.matchId === m.id) ??
            ({
              matchId: m.id,
              player: p.fullName,
              team: p.teamName,
              position: 'DNP',
              minutes: 0,
              goals: 0,
              assists: 0,
              xg: 0,
              xa: 0,
              shots: 0,
              keyPasses: 0,
            } as HistoricalPlayer),
        );
      const appearances = recent.length ? recent : rows.slice(-6),
        x = minutesFeatures(appearances),
        fit = input.footballModel?.minutes;
      const seasonStart = Date.parse(
        `${input.analytics.season.slice(0, 4)}-07-01T00:00:00Z`,
      );
      const seasonGames = Math.max(
        1,
        matches.filter(
          (m) =>
            (m.homeCode === p.team || m.awayCode === p.team) &&
            utcTime(m.date) >= seasonStart,
        ).length,
      );
      const baseStart =
        fit && appearances.length >= 2
          ? logistic(fit.start, x)
          : (p.starts + 0.5) / (seasonGames + 2);
      const baseAppear =
        fit && appearances.length >= 2
          ? logistic(fit.appear, x)
          : Math.max(baseStart, (p.minutes / 75 + 1) / (seasonGames + 3));
      const availability =
        p.chance === 0 || ['s', 'u', 'n'].includes(p.status)
          ? 0
          : finite(p.chance)
            ? clamp(p.chance / 100)
            : p.status === 'i'
              ? 0
              : 1;
      const start = clamp(baseStart) * availability,
        appear = Math.max(start, clamp(baseAppear) * availability);
      const starterRows = appearances.filter(
        (r) => r.minutes > 0 && !['Sub', 'DNP'].includes(r.position),
      );
      const startMinutes = clamp(
        (starterRows.reduce((s, r) => s + r.minutes, 0) +
          3 * (fit?.starterMinutes ?? 75)) /
          (starterRows.length + 3),
        45,
        90,
      );
      const benchMinutes = clamp(fit?.benchMinutes ?? 20, 5, 45),
        expectedMinutes =
          start * startMinutes + (appear - start) * benchMinutes;
      const prior = input.footballModel?.allocation.positionRates[p.position];
      const posPrior =
        prior?.goal ??
        (p.position === 'FWD'
          ? 0.35
          : p.position === 'MID'
            ? 0.18
            : p.position === 'DEF'
              ? 0.06
              : 0.005);
      let weightedMinutes = 0,
        npxg = 0,
        xa = 0,
        penalties = 0,
        knownXgMinutes = 0,
        knownXaMinutes = 0;
      for (const r of rows) {
        const w = Math.exp(
          (-Math.LN2 * (cutoff - utcTime(matchById.get(r.matchId)!.date))) /
            (365 * 86400000),
        );
        weightedMinutes += r.minutes * w;
        if (finite(r.npxg ?? r.xg)) {
          npxg += (r.npxg ?? r.xg ?? 0) * w;
          knownXgMinutes += r.minutes * w;
        }
        if (finite(r.xa)) {
          xa += r.xa * w;
          knownXaMinutes += r.minutes * w;
        }
        penalties += (r.penalties ?? 0) * w;
      }
      // Missing and zero are distinct. FPL is a labelled fallback, not added to overlapping Understat totals.
      const fplXg =
          p.predictionStats?.xg === undefined ? p.xG : p.predictionStats.xg,
        fplXa =
          p.predictionStats?.xa === undefined ? p.xA : p.predictionStats.xa;
      if (!knownXgMinutes && p.minutes > 0 && finite(fplXg)) {
        knownXgMinutes = p.minutes;
        npxg = fplXg;
      }
      if (!knownXaMinutes && p.minutes > 0 && finite(fplXa)) {
        knownXaMinutes = p.minutes;
        xa = fplXa;
      }
      const rateG = (npxg * 90 + posPrior * 900) / (knownXgMinutes + 900),
        rateA =
          (xa * 90 +
            (prior?.assist ?? (p.position === 'MID' ? 0.15 : 0.08)) * 900) /
          (knownXaMinutes + 900);
      return {
        id: p.id,
        name: p.fullName,
        displayName: p.name,
        team: p.team,
        position: p.position,
        status: p.status,
        chanceOfPlaying: p.chance,
        news: p.news.slice(0, 400),
        seasonMinutes: p.minutes,
        seasonStarts: p.starts,
        goals: p.goals,
        fplAssists: p.assists,
        xg: finite(fplXg) ? round(fplXg) : null,
        xa: finite(fplXa) ? round(fplXa) : null,
        historyLink: linked.method,
        providerId: linked.providerId,
        historyMinutes: Math.round(weightedMinutes),
        nonPenaltyXgPer90: round(rateG)!,
        xaPer90: round(rateA)!,
        penaltyAttempts: round(penalties)!,
        penaltiesOrder: p.predictionStats?.penaltiesOrder ?? null,
        minutes: {
          startProbability: round(start)!,
          appearanceProbability: round(appear)!,
          starterMinutes: round(startMinutes)!,
          benchMinutes: round(benchMinutes)!,
          expected: round(expectedMinutes)!,
        },
        recentAppearances: appearances
          .slice(-4)
          .reverse()
          .map((r) => ({
            date: matchById.get(r.matchId)!.date,
            minutes: r.minutes,
            position: r.position,
            goals: r.goals,
            assists: r.assists,
            xg: round(r.xg),
            xa: round(r.xa),
          })),
      };
    });
  // Marginal selection estimates cannot imply more than a full lineup or 990 minutes.
  for (const code of [fixture.homeCode, fixture.awayCode])
    for (const goalkeeper of [true, false]) {
      const group = players.filter(
          (p) => p.team === code && (p.position === 'GKP') === goalkeeper,
        ),
        slots = goalkeeper ? 1 : 10;
      const starts = group.reduce((s, p) => s + p.minutes.startProbability, 0);
      for (const p of group) {
        p.minutes.startProbability *= Math.min(
          1,
          slots / Math.max(0.01, starts),
        );
        p.minutes.expected =
          p.minutes.startProbability * p.minutes.starterMinutes +
          (p.minutes.appearanceProbability - p.minutes.startProbability) *
            p.minutes.benchMinutes;
      }
      const total = group.reduce((s, p) => s + p.minutes.expected, 0),
        scale = Math.min(1, (90 * slots) / Math.max(0.01, total));
      for (const p of group) {
        p.minutes.startProbability = round(p.minutes.startProbability * scale)!;
        p.minutes.appearanceProbability = round(
          p.minutes.appearanceProbability * scale,
        )!;
        p.minutes.expected = round(p.minutes.expected * scale)!;
      }
    }
  return {
    teams,
    players,
    coverage: {
      seasons: raw.seasons,
      teamMatches: matches.length,
      playersLinked: players.filter(
        (p) => p.providerId !== null || p.recentAppearances.length,
      ).length,
      players: players.length,
      warnings: raw.warnings,
      latestMatch:
        matches
          .map((m) => m.date)
          .sort()
          .at(-1) ?? null,
    },
  };
}
