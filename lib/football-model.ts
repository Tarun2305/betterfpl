/** A fitted, time-decayed attack/defence Poisson model with Dixon–Coles correction.
 * Training and validation use completed matches only; no current squad aggregates.
 */
export const FOOTBALL_VERSION = 'dc-minutes-v1';
export const clamp = (x: number, lo = 0, hi = 1) =>
  Math.max(lo, Math.min(hi, x));
export const finite = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x);
export const utcTime = (s: string) =>
  Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(s) ? s : `${s}Z`);
export const teamCode = (s: string) =>
  ({ BRI: 'BHA', LED: 'LEE', FLH: 'FUL', NOT: 'NFO' })[s] ?? s;
export type HistoricalMatch = {
  id: number;
  date: string;
  homeCode: string;
  awayCode: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  homeXg: number | null;
  awayXg: number | null;
  homeNpxg?: number | null;
  awayNpxg?: number | null;
  season?: string;
};
export type HistoricalPlayer = {
  matchId: number;
  playerId?: number;
  teamId?: number;
  player: string;
  team: string;
  position: string;
  minutes: number;
  goals: number;
  assists: number;
  xg: number | null;
  xa: number | null;
  npxg?: number | null;
  shots: number | null;
  keyPasses: number | null;
  penalties?: number;
  redCards?: number;
};
export type ForecastHistory = {
  matches: HistoricalMatch[];
  playerMatches: HistoricalPlayer[];
  fetchedAt: string;
  warnings: string[];
  seasons: string[];
};
export type TeamFit = {
  intercept: number;
  homeAdvantage: number;
  attack: Record<string, number>;
  defence: Record<string, number>;
  halfLife: number;
  xgWeight: number;
  rho: number;
};
export type MinutesFit = {
  start: number[];
  appear: number[];
  starterMinutes: number;
  benchMinutes: number;
  examples: number;
  validationBrier: number | null;
};
export type FootballModel = TeamFit & {
  version: string;
  trainedThrough: string;
  trainingMatches: number;
  minutes: MinutesFit;
  allocation: {
    scoredShare: number;
    assistedShare: number;
    penaltyGoalsPerTeamMatch: number;
    restrictedMinutes: number;
    positionRates: Record<string, { goal: number; assist: number }>;
  };
  evaluation: {
    testMatches: number;
    logLoss: number | null;
    baselineLogLoss: number | null;
    homeRps: number | null;
    awayRps: number | null;
    selectedOn: string;
    note: string;
  };
};
export const sigmoid = (v: number) => 1 / (1 + Math.exp(-clamp(v, -25, 25)));
export function rates(model: TeamFit, home: string, away: string) {
  return [
    Math.exp(
      clamp(
        model.intercept +
          model.homeAdvantage +
          (model.attack[home] ?? 0) +
          (model.defence[away] ?? 0),
        -3,
        2,
      ),
    ),
    Math.exp(
      clamp(
        model.intercept +
          (model.attack[away] ?? 0) +
          (model.defence[home] ?? 0),
        -3,
        2,
      ),
    ),
  ];
}
export function poisson(lambda: number, max = 15) {
  const p = [Math.exp(-lambda)];
  for (let k = 1; k < max; k++) p.push((p[k - 1] * lambda) / k);
  p.push(Math.max(0, 1 - p.reduce((a, b) => a + b, 0)));
  return p;
}
export function scoreGrid(home: number, away: number, rho = 0) {
  const hp = poisson(home),
    ap = poisson(away);
  const grid = hp.map((h, x) =>
    ap.map((a, y) => {
      const correction =
        x === 0 && y === 0
          ? 1 - home * away * rho
          : x === 0 && y === 1
            ? 1 + home * rho
            : x === 1 && y === 0
              ? 1 + away * rho
              : x === 1 && y === 1
                ? 1 - rho
                : 1;
      return h * a * Math.max(0.01, correction);
    }),
  );
  const total = grid.flat().reduce((a, b) => a + b, 0);
  return grid.map((row) => row.map((v) => v / total));
}
export function distribution(values: number[]) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!finite(total) || total <= 0 || values.some((v) => !finite(v) || v < 0))
    throw new Error('Invalid probability distribution');
  const p = values.map((v) => v / total),
    capped = Array<number>(10).fill(0);
  p.forEach((v, i) => (capped[Math.min(i, 9)] += v));
  const entropy = -capped.reduce(
    (s, v) => s + (v > 0 ? v * Math.log(v) : 0),
    0,
  );
  return {
    score: capped.reduce((s, v, i) => s + i * v, 0),
    mode: capped.indexOf(Math.max(...capped)),
    confidence: 1 - entropy / Math.log(10),
    probabilities: Object.fromEntries(capped.map((v, i) => [i, v])),
  };
}
function fit(
  matches: HistoricalMatch[],
  halfLife: number,
  xgWeight: number,
): TeamFit {
  const codes = [...new Set(matches.flatMap((m) => [m.homeCode, m.awayCode]))];
  const attack = Object.fromEntries(codes.map((c) => [c, 0])),
    defence = { ...attack };
  const latest = matches.length ? utcTime(matches[matches.length - 1].date) : 0;
  const rows = matches.map((m) => ({
    m,
    w: Math.exp(
      (-Math.LN2 * (latest - utcTime(m.date))) / (halfLife * 86400000),
    ),
  }));
  const wsum = rows.reduce((s, r) => s + r.w, 0) || 1;
  let intercept = Math.log(
      Math.max(
        0.3,
        matches.reduce((s, m) => s + m.awayGoals, 0) /
          Math.max(1, matches.length),
      ),
    ),
    homeAdvantage = 0.15;
  for (let iteration = 0; iteration < 240; iteration++) {
    let gi = 0,
      gh = 0;
    const ga = Object.fromEntries(codes.map((c) => [c, 0])),
      gd = { ...ga };
    for (const { m, w } of rows) {
      const [lh, la] = rates(
        {
          intercept,
          homeAdvantage,
          attack,
          defence,
          halfLife,
          xgWeight,
          rho: 0,
        },
        m.homeCode,
        m.awayCode,
      );
      const yh = finite(m.homeXg)
        ? m.homeGoals * (1 - xgWeight) + m.homeXg * xgWeight
        : m.homeGoals;
      const ya = finite(m.awayXg)
        ? m.awayGoals * (1 - xgWeight) + m.awayXg * xgWeight
        : m.awayGoals;
      const eh = w * (lh - yh),
        ea = w * (la - ya);
      gi += eh + ea;
      gh += eh;
      ga[m.homeCode] += eh;
      gd[m.awayCode] += eh;
      ga[m.awayCode] += ea;
      gd[m.homeCode] += ea;
    }
    intercept -= (0.12 * gi) / wsum;
    homeAdvantage -= (0.12 * gh) / wsum;
    for (const c of codes) {
      attack[c] -= (0.8 * (ga[c] + 2 * attack[c])) / wsum;
      defence[c] -= (0.8 * (gd[c] + 2 * defence[c])) / wsum;
    }
  }
  return {
    intercept,
    homeAdvantage,
    attack,
    defence,
    halfLife,
    xgWeight,
    rho: 0,
  };
}
function loss(model: TeamFit, rows: HistoricalMatch[]) {
  return (
    rows.reduce((s, m) => {
      const [h, a] = rates(model, m.homeCode, m.awayCode);
      return (
        s -
        Math.log(
          Math.max(
            1e-12,
            scoreGrid(h, a, model.rho)[Math.min(15, m.homeGoals)][
              Math.min(15, m.awayGoals)
            ],
          ),
        )
      );
    }, 0) / Math.max(1, rows.length)
  );
}
function rps(p: number[], observed: number) {
  let predicted = 0,
    sum = 0;
  for (let i = 0; i < p.length - 1; i++) {
    predicted += p[i];
    sum += (predicted - (observed <= i ? 1 : 0)) ** 2;
  }
  return sum / (p.length - 1);
}
export function minutesFeatures(
  history: { minutes: number; position: string }[],
) {
  const rows = history.slice(-6),
    n = rows.length || 1;
  return [
    1,
    rows.reduce(
      (s, r) => s + Number(r.minutes > 0 && r.position !== 'Sub'),
      0,
    ) / n,
    rows.reduce((s, r) => s + Math.min(90, r.minutes), 0) / (90 * n),
    Number((rows.at(-1)?.minutes ?? 0) > 0),
    Math.min(rows.length, 6) / 6,
  ];
}
export function logistic(beta: number[], x: number[]) {
  return sigmoid(beta.reduce((s, b, i) => s + b * x[i], 0));
}
export function fitMinutes(history: ForecastHistory): MinutesFit {
  const matches = new Map(history.matches.map((m) => [m.id, m]));
  const byPlayer = new Map<string, HistoricalPlayer[]>();
  for (const p of history.playerMatches) {
    if (!matches.has(p.matchId)) continue;
    const key = String(p.playerId ?? `${p.team}:${p.player}`);
    const rows = byPlayer.get(key) ?? [];
    rows.push(p);
    byPlayer.set(key, rows);
  }
  const examples: {
    x: number[];
    start: number;
    appear: number;
    date: number;
    minutes: number;
  }[] = [];
  for (const rows of byPlayer.values()) {
    rows.sort(
      (a, b) =>
        utcTime(matches.get(a.matchId)!.date) -
        utcTime(matches.get(b.matchId)!.date),
    );
    const previous: HistoricalPlayer[] = [];
    for (const row of rows) {
      if (previous.length >= 2)
        examples.push({
          x: minutesFeatures(previous),
          start: Number(row.minutes > 0 && row.position !== 'Sub'),
          appear: Number(row.minutes > 0),
          date: utcTime(matches.get(row.matchId)!.date),
          minutes: row.minutes,
        });
      previous.push(row);
    }
  }
  examples.sort((a, b) => a.date - b.date);
  const train = (items: typeof examples, key: 'start' | 'appear') => {
    const b = [0, 1, 1, 0, 0];
    for (let it = 0; it < 150; it++) {
      const g = Array(5).fill(0);
      for (const row of items) {
        const error = logistic(b, row.x) - row[key];
        row.x.forEach((v, i) => (g[i] += error * v));
      }
      b.forEach(
        (_, i) =>
          (b[i] -= (0.4 * (g[i] + 0.5 * b[i])) / Math.max(1, items.length)),
      );
    }
    return b;
  };
  if (examples.length < 50)
    return {
      start: [-2, 2, 1, 0, 0],
      appear: [-1, 2, 1, 0, 0],
      starterMinutes: 75,
      benchMinutes: 20,
      examples: examples.length,
      validationBrier: null,
    };
  const boundary = examples[Math.floor(examples.length * 0.8)].date,
    trainRows = examples.filter((r) => r.date < boundary),
    test = examples.filter((r) => r.date >= boundary),
    beta = train(trainRows, 'start');
  const starters = examples.filter((r) => r.start),
    bench = examples.filter((r) => !r.start && r.appear);
  return {
    start: train(examples, 'start'),
    appear: train(examples, 'appear'),
    starterMinutes:
      starters.reduce((s, r) => s + r.minutes, 0) /
      Math.max(1, starters.length),
    benchMinutes:
      bench.reduce((s, r) => s + r.minutes, 0) / Math.max(1, bench.length),
    examples: examples.length,
    validationBrier: test.length
      ? test.reduce((s, r) => s + (logistic(beta, r.x) - r.start) ** 2, 0) /
        test.length
      : null,
  };
}
export function trainFootballModel(
  history: ForecastHistory,
  cutoff = Date.now(),
): FootballModel {
  const rows = history.matches
    .filter(
      (m) =>
        utcTime(m.date) < cutoff && finite(m.homeGoals) && finite(m.awayGoals),
    )
    .map((m) => ({
      ...m,
      homeCode: teamCode(m.homeCode),
      awayCode: teamCode(m.awayCode),
    }))
    .sort((a, b) => utcTime(a.date) - utcTime(b.date));
  const tuneAt = rows[Math.floor(rows.length * 0.65)]?.date,
    testAt = rows[Math.floor(rows.length * 0.82)]?.date;
  const train = rows.filter((m) => m.date < (tuneAt ?? '')),
    tune = rows.filter(
      (m) => m.date >= (tuneAt ?? '') && m.date < (testAt ?? ''),
    ),
    test = rows.filter((m) => m.date >= (testAt ?? ''));
  let choice = { halfLife: 240, xgWeight: 0.5, rho: 0 },
    best = Infinity;
  if (rows.length >= 200)
    for (const halfLife of [120, 240, 365])
      for (const xgWeight of [0, 0.5]) {
        const candidate = fit(train, halfLife, xgWeight);
        for (const rho of [-0.12, -0.06, 0, 0.06]) {
          candidate.rho = rho;
          const error = loss(candidate, tune);
          if (error < best) {
            best = error;
            choice = { halfLife, xgWeight, rho };
          }
        }
      }
  const pretest = rows.filter((m) => m.date < (testAt ?? '')),
    validation = {
      ...fit(pretest, choice.halfLife, choice.xgWeight),
      rho: choice.rho,
    };
  const awayMean = Math.max(
    0.01,
    pretest.reduce((sum, m) => sum + m.awayGoals, 0) /
      Math.max(1, pretest.length),
  );
  const homeMean = Math.max(
    0.01,
    pretest.reduce((sum, m) => sum + m.homeGoals, 0) /
      Math.max(1, pretest.length),
  );
  const baseline = {
    ...validation,
    intercept: Math.log(awayMean),
    homeAdvantage: Math.log(homeMean / awayMean),
    attack: {},
    defence: {},
    rho: 0,
  };
  const homeRps =
    test.reduce((s, m) => {
      const [h, a] = rates(validation, m.homeCode, m.awayCode);
      return (
        s +
        rps(
          scoreGrid(h, a, validation.rho).map((r) =>
            r.reduce((x, y) => x + y, 0),
          ),
          m.homeGoals,
        )
      );
    }, 0) / Math.max(1, test.length);
  const awayRps =
    test.reduce((s, m) => {
      const [h, a] = rates(validation, m.homeCode, m.awayCode),
        g = scoreGrid(h, a, validation.rho);
      return (
        s +
        rps(
          g[0].map((_, i) => g.reduce((n, row) => n + row[i], 0)),
          m.awayGoals,
        )
      );
    }, 0) / Math.max(1, test.length);
  const allowed = new Set(rows.map((m) => m.id));
  const playerRows = history.playerMatches.filter((p) =>
    allowed.has(p.matchId),
  );
  const totalGoals = rows.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0);
  const scored = playerRows.reduce((s, p) => s + p.goals, 0),
    assisted = playerRows.reduce((s, p) => s + p.assists, 0);
  const shortStarts = playerRows.filter(
    (p) =>
      p.position !== 'Sub' &&
      p.position !== 'DNP' &&
      p.minutes > 0 &&
      p.minutes < 60,
  );
  const positionRates: Record<string, { goal: number; assist: number }> = {};
  for (const pos of ['GKP', 'DEF', 'MID', 'FWD']) {
    const selected = playerRows.filter(
      (p) =>
        (p.position === 'GK'
          ? 'GKP'
          : p.position.startsWith('D')
            ? 'DEF'
            : p.position.startsWith('F')
              ? 'FWD'
              : 'MID') === pos && p.minutes > 0,
    );
    const gm = selected.filter((p) => finite(p.npxg ?? p.xg)),
      am = selected.filter((p) => finite(p.xa));
    positionRates[pos] = {
      goal:
        (gm.reduce((s, p) => s + (p.npxg ?? p.xg ?? 0), 0) * 90) /
        Math.max(
          90,
          gm.reduce((s, p) => s + p.minutes, 0),
        ),
      assist:
        (am.reduce((s, p) => s + (p.xa ?? 0), 0) * 90) /
        Math.max(
          90,
          am.reduce((s, p) => s + p.minutes, 0),
        ),
    };
  }
  return {
    ...fit(rows, choice.halfLife, choice.xgWeight),
    rho: choice.rho,
    version: FOOTBALL_VERSION,
    trainedThrough: rows.at(-1)?.date ?? '',
    trainingMatches: rows.length,
    minutes: fitMinutes({
      ...history,
      matches: rows,
      playerMatches: playerRows,
    }),
    allocation: {
      scoredShare: totalGoals ? clamp(scored / totalGoals) : 0.97,
      assistedShare: totalGoals ? clamp(assisted / totalGoals) : 0.7,
      penaltyGoalsPerTeamMatch:
        rows.reduce(
          (sum, m) =>
            sum +
            Math.max(0, (m.homeXg ?? 0) - (m.homeNpxg ?? m.homeXg ?? 0)) +
            Math.max(0, (m.awayXg ?? 0) - (m.awayNpxg ?? m.awayXg ?? 0)),
          0,
        ) / Math.max(1, 2 * rows.length),
      restrictedMinutes: shortStarts.length
        ? shortStarts.reduce((s, p) => s + p.minutes, 0) / shortStarts.length
        : 45,
      positionRates,
    },
    evaluation: {
      testMatches: rows.length >= 200 ? test.length : 0,
      logLoss: rows.length >= 200 ? loss(validation, test) : null,
      baselineLogLoss: rows.length >= 200 ? loss(baseline, test) : null,
      homeRps: rows.length >= 200 ? homeRps : null,
      awayRps: rows.length >= 200 ? awayRps : null,
      selectedOn: tuneAt ?? '',
      note: 'Chronological 65/17/18 split, date-grouped. Team model only; news and player probabilities require prospective evaluation. Minutes validation covers observed rosters, not all registered players.',
    },
  };
}
