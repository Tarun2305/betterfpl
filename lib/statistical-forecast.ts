import type {
  buildPredictionState,
  ForecastResult,
  NewsSignal,
  PlayerPrediction,
} from './prediction-engine';
import {
  clamp,
  distribution,
  rates,
  scoreGrid,
  type FootballModel,
} from './football-model';

export function statisticalForecast(
  state: ReturnType<typeof buildPredictionState>,
  model: FootballModel,
  signals: NewsSignal[],
): ForecastResult {
  const adjusted = state.players.map((p) => {
    const signal = signals.find((s) => s.playerId === p.id),
      base = p.minutes;
    // These are conditional mixtures of observed roster/minute scenarios, not invented xG bonuses.
    const available = 1 - (signal?.out ?? 0),
      start = base.startProbability * available * (1 - (signal?.bench ?? 0));
    const appear = Math.max(start, base.appearanceProbability * available);
    const starterMinutes =
      base.starterMinutes * (1 - (signal?.restricted ?? 0)) +
      Math.min(base.starterMinutes, model.allocation.restrictedMinutes) *
        (signal?.restricted ?? 0);
    const expected =
      start * starterMinutes + (appear - start) * base.benchMinutes;
    return {
      ...p,
      start,
      appear,
      starterMinutes,
      expected,
      penaltyWeight:
        p.penaltyAttempts +
        (p.penaltiesOrder === 1 ? 1 : 0) +
        (signal?.penaltyTaker ?? 0),
    };
  });
  const [h, a] = rates(model, state.fixture.homeCode, state.fixture.awayCode),
    grid = scoreGrid(h, a, model.rho);
  const home = distribution(grid.map((row) => row.reduce((x, y) => x + y, 0))),
    away = distribution(
      grid[0].map((_, i) => grid.reduce((s, row) => s + row[i], 0)),
    );
  let jointScore = { home: 0, away: 0, probability: 0 };
  const outcomes = { home: 0, draw: 0, away: 0 };
  grid.forEach((row, x) =>
    row.forEach((probability, y) => {
      outcomes[x > y ? 'home' : x === y ? 'draw' : 'away'] += probability;
      if (probability > jointScore.probability)
        jointScore = { home: x, away: y, probability };
    }),
  );
  const players: PlayerPrediction[] = [];
  for (const [code, lambda] of [
    [state.fixture.homeCode, h],
    [state.fixture.awayCode, a],
  ] as const) {
    const squad = adjusted.filter((p) => p.team === code),
      penaltyTotal = squad.reduce((s, p) => s + p.penaltyWeight * p.appear, 0);
    const weights = squad.map((p) => ({
      p,
      g:
        (p.nonPenaltyXgPer90 * p.expected) / 90 +
        (model.allocation.penaltyGoalsPerTeamMatch *
          p.penaltyWeight *
          p.appear) /
          Math.max(0.01, penaltyTotal),
      a: (p.xaPer90 * p.expected) / 90,
    }));
    const totalG = weights.reduce((s, r) => s + r.g, 0),
      totalA = weights.reduce((s, r) => s + r.a, 0);
    for (const { p, g, a: aw } of weights) {
      // Reserve a small unallocated share for own goals/unmodelled squad changes.
      const expectedGoals =
          (lambda * model.allocation.scoredShare * g) / Math.max(0.01, totalG),
        expectedAssists =
          (lambda * model.allocation.assistedShare * aw) /
          Math.max(0.01, totalA);
      const eventProbability = (events: number) => {
        const perMinute = events / Math.max(1, p.expected);
        return (
          p.start * (1 - Math.exp(-perMinute * p.starterMinutes)) +
          (p.appear - p.start) *
            (1 - Math.exp(-perMinute * p.minutes.benchMinutes))
        );
      };
      if (p.position !== 'GKP')
        players.push({
          id: p.id,
          name: p.name,
          team: p.team,
          goal: clamp(eventProbability(expectedGoals)),
          assist: clamp(eventProbability(expectedAssists)),
          expectedMinutes: p.expected,
        });
    }
  }
  return {
    home,
    away,
    players,
    model: model.version,
    jointScore,
    outcomes,
    newsSignals: signals,
    training: {
      ...model.evaluation,
      matches: model.trainingMatches,
      through: model.trainedThrough,
    },
    warnings: [
      ...state.coverage.warnings,
      'Player allocation and news-driven minutes are not yet prospectively calibrated. Team rates use fitted historical attack/defence; news changes player selection scenarios.',
      ...(state.players.some(
        (p) => p.historyLink === 'unmatched' || p.historyLink === 'ambiguous',
      )
        ? [
            'Some players use position priors because their history could not be linked.',
          ]
        : []),
    ],
  };
}

/** Enforce necessary bounds while retaining the direct Jev forecasts and raw answers.
 * This is an explicit consistency projection, not football calibration.
 */
export function reconcilePlayers(
  players: PlayerPrediction[],
  home: ForecastResult['home'],
  away: ForecastResult['away'],
  codes: [string, string],
  state: ReturnType<typeof buildPredictionState>,
) {
  const result = players.map((p) => ({ ...p }));
  let adjusted = false;
  for (const [index, code] of codes.entries()) {
    const distribution = index === 0 ? home : away,
      mean = distribution.score,
      pTeamScores = 1 - distribution.probabilities['0'];
    const team = result.filter((p) => p.team === code);
    for (const metric of ['goal', 'assist'] as const) {
      for (const p of team) {
        const minutes = state.players.find((row) => row.id === p.id)?.minutes;
        const cap = Math.min(pTeamScores, minutes?.appearanceProbability ?? 1);
        if (p[metric] > cap) {
          p[metric] = cap;
          adjusted = true;
        }
      }
      const sum = team.reduce((s, p) => s + p[metric], 0);
      if (sum > mean && sum > 0) {
        for (const p of team) p[metric] *= mean / sum;
        adjusted = true;
      }
    }
  }
  return { players: result, adjusted };
}
