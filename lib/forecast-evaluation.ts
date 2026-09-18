import type { SavedFixture } from './prediction-worker';
import type { ForecastHistory } from './football-model';
import { teamCode } from './football-model';

type Metric = {
  n: number;
  brier: number;
  logLoss: number;
  bins: { n: number; probability: number; events: number }[];
};
const metric = (): Metric => ({
  n: 0,
  brier: 0,
  logLoss: 0,
  bins: Array.from({ length: 10 }, () => ({ n: 0, probability: 0, events: 0 })),
});
function observe(m: Metric, p: number, y: number) {
  m.n++;
  m.brier += (p - y) ** 2;
  m.logLoss -=
    y * Math.log(Math.max(1e-12, p)) +
    (1 - y) * Math.log(Math.max(1e-12, 1 - p));
  const bin = m.bins[Math.min(9, Math.floor(p * 10))];
  bin.n++;
  bin.probability += p;
  bin.events += y;
}
function finish(m: Metric) {
  return {
    ...m,
    brier: m.n ? m.brier / m.n : null,
    logLoss: m.n ? m.logLoss / m.n : null,
    bins: m.bins.map((b) => ({
      ...b,
      meanProbability: b.n ? b.probability / b.n : null,
      eventRate: b.n ? b.events / b.n : null,
    })),
  };
}
export function evaluateSavedForecasts(
  records: SavedFixture[],
  history: ForecastHistory,
) {
  const groups = new Map<
    string,
    {
      fixtures: number;
      teamLogLoss: number;
      teamRps: number;
      goal: Metric;
      assist: Metric;
      unlinked: number;
    }
  >();
  for (const item of records) {
    if (item.status !== 'complete' || !item.result || !item.request) continue;
    const state = item.request.state,
      fixture = state.fixture;
    if (Date.parse(item.result.createdAt) >= Date.parse(fixture.kickoff!))
      continue;
    const actual = history.matches.find(
      (m) =>
        teamCode(m.homeCode) === fixture.homeCode &&
        teamCode(m.awayCode) === fixture.awayCode &&
        m.date.slice(0, 10) === fixture.kickoff?.slice(0, 10),
    );
    if (!actual) continue;
    for (const [variant, result] of [
      ['jev', item.result],
      ['statistical', item.result.statistical],
    ] as const) {
      if (!result) continue;
      const key = [
        variant,
        item.result.release ?? 'unknown',
        item.result.engineVersion ?? 'legacy',
      ].join('/');
      const group = groups.get(key) ?? {
        fixtures: 0,
        teamLogLoss: 0,
        teamRps: 0,
        goal: metric(),
        assist: metric(),
        unlinked: 0,
      };
      group.fixtures++;
      for (const [p, goals] of [
        [result.home, actual.homeGoals],
        [result.away, actual.awayGoals],
      ] as const) {
        group.teamLogLoss -= Math.log(
          Math.max(1e-12, p.probabilities[String(Math.min(9, goals))] ?? 0),
        );
        let cumulative = 0;
        for (let k = 0; k < 9; k++) {
          cumulative += p.probabilities[String(k)] ?? 0;
          group.teamRps += (cumulative - Number(goals <= k)) ** 2 / 9;
        }
      }
      const roster = history.playerMatches.filter(
        (r) => r.matchId === actual.id,
      );
      for (const player of result.players) {
        const identity = state.players.find(
          (p) => p.id === player.id,
        )?.providerId;
        if (!identity || roster.length < 20) {
          group.unlinked++;
          continue;
        }
        const row = roster.find((r) => r.playerId === identity);
        observe(group.goal, player.goal, Number((row?.goals ?? 0) > 0));
        observe(group.assist, player.assist, Number((row?.assists ?? 0) > 0));
      }
      groups.set(key, group);
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    note: 'Only archived pre-kickoff predictions with observed results. Stages and engine versions are separate; no retrospective Jev calls. Missing player identities are excluded, not labelled as zero.',
    groups: Object.fromEntries(
      [...groups].map(([key, g]) => [
        key,
        {
          fixtures: g.fixtures,
          teamLogLoss: g.teamLogLoss / (2 * g.fixtures),
          teamRps: g.teamRps / (2 * g.fixtures),
          goals: finish(g.goal),
          assists: finish(g.assist),
          unlinkedPlayerOutcomes: g.unlinked,
        },
      ]),
    ),
  };
}
