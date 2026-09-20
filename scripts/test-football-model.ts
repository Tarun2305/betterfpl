import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distribution,
  scoreGrid,
  trainFootballModel,
  utcTime,
  type ForecastHistory,
} from '../lib/football-model';
import { sampleData } from '../lib/fpl-data';
import { emptyAnalytics } from '../lib/analytics-data';
import { emptyEnrichment } from '../lib/enrichment-data';
import {
  buildPredictionState,
  type PredictionInput,
} from '../lib/prediction-engine';
import { preparePrediction, validatePrediction } from '../lib/prediction-model';
import { linkPlayer, normalizeName } from '../lib/forecast-features';
import {
  statisticalForecast,
  reconcilePlayers,
} from '../lib/statistical-forecast';
import { linkNews, newsRelevance } from '../lib/prediction-evidence';
import { parseFeed, fetchNewsEvidence } from '../lib/prediction-news';
import { planReleases } from '../lib/prediction-schedule';
import { versionedRelease } from '../lib/prediction-version';

const now = Date.parse('2026-09-18T06:00:00Z');
const fixture = {
  ...sampleData.fixtures[1],
  id: 42,
  event: 5,
  kickoff: '2026-09-19T15:00:00Z',
};
const input: PredictionInput = {
  fpl: { ...sampleData, source: 'live', fixtures: [fixture] },
  analytics: emptyAnalytics,
  enrichment: emptyEnrichment,
  fixtureId: 42,
};
const history: ForecastHistory = {
  matches: Array.from({ length: 250 }, (_, i) => ({
    id: i,
    date: new Date(
      Date.parse('2025-01-01T15:00:00Z') + i * 86400000,
    ).toISOString(),
    homeCode: i % 2 ? 'CHE' : 'BRE',
    awayCode: i % 2 ? 'BRE' : 'CHE',
    homeTeam: i % 2 ? 'Chelsea' : 'Brentford',
    awayTeam: i % 2 ? 'Brentford' : 'Chelsea',
    homeGoals: i % 3,
    awayGoals: i % 2,
    homeXg: 1.4,
    awayXg: 0.9,
  })),
  playerMatches: [],
  fetchedAt: '2026-09-18T00:00:00Z',
  seasons: ['2025/26'],
  warnings: [],
};

void test('goal grids and tail categories retain probability mass, means and nonnegative outcomes', () => {
  for (const h of [0.05, 0.8, 2, 6])
    for (const a of [0.05, 1, 4])
      for (const rho of [-0.12, 0, 0.06]) {
        const grid = scoreGrid(h, a, rho),
          p = distribution(grid.map((r) => r.reduce((s, v) => s + v, 0)));
        assert.ok(Math.abs(grid.flat().reduce((s, v) => s + v, 0) - 1) < 1e-10);
        assert.ok(grid.flat().every((v) => v >= 0));
        assert.ok(
          Math.abs(
            Object.values(p.probabilities).reduce((s, v) => s + v, 0) - 1,
          ) < 1e-10,
        );
        assert.ok(
          Math.abs(
            p.score -
              Object.entries(p.probabilities).reduce(
                (s, [k, v]) => s + Number(k) * v,
                0,
              ),
          ) < 1e-10,
        );
      }
});
void test('historical model is fitted and never trains on future matches', () => {
  const cutoff = utcTime(history.matches[220].date),
    a = trainFootballModel(history, cutoff);
  const poisoned = {
    ...history,
    matches: history.matches.map((m, i) =>
      i >= 220 ? { ...m, homeGoals: 99, awayGoals: 99 } : m,
    ),
  };
  const b = trainFootballModel(poisoned, cutoff);
  assert.deepEqual(a, b);
  assert.equal(a.trainingMatches, 220);
  assert.ok(a.evaluation.testMatches > 0);
  assert.ok(Number.isFinite(a.evaluation.logLoss));
});
void test('identities handle aliases, transliteration and transfers without fuzzy surname guesses', () => {
  assert.equal(
    normalizeName('Martin Ødegaard'),
    normalizeName('Martin Odegaard'),
  );
  const p = {
    ...sampleData.players[0],
    fullName: 'Benjamin White',
    name: 'White',
    team: 'ARS',
  };
  const h = {
    ...history,
    matches: [{ ...history.matches[0], homeCode: 'ARS', homeTeam: 'Arsenal' }],
    playerMatches: [
      {
        matchId: 0,
        playerId: 123,
        team: 'Arsenal',
        player: 'Ben White',
        position: 'DR',
        minutes: 90,
        goals: 0,
        assists: 0,
        xg: 0.1,
        xa: 0.1,
        shots: 1,
        keyPasses: 1,
      },
    ],
  };
  assert.equal(linkPlayer(p, h).providerId, 123);
  assert.equal(linkPlayer({ ...p, team: 'CHE' }, h).providerId, 123);
  assert.equal(
    linkPlayer({ ...p, fullName: 'Another White' }, h).rows.length,
    0,
  );
});
void test('news does not confuse a speaker with a player and excludes commercial stories', async () => {
  const fpl = {
    ...sampleData,
    players: [
      {
        ...sampleData.players[0],
        id: 1,
        fullName: 'Kai Andrews',
        name: 'Andrews',
        team: 'COV',
      },
      {
        ...sampleData.players[0],
        id: 2,
        fullName: 'Igor Thiago',
        name: 'Thiago',
        team: 'BRE',
      },
    ],
  };
  assert.ok(
    !linkNews('Andrews: We value Igor Thiago so much', fpl).playerIds.includes(
      1,
    ),
  );
  assert.equal(newsRelevance('Chelsea Women injury update'), 0);
  assert.equal(
    newsRelevance('Retired Liverpool star reveals injury years ago'),
    0,
  );
  const xml =
    '<rss><channel><item><title><![CDATA[Chelsea injury update]]></title><link>https://example.com/story</link><description>Palmer returns to training</description><pubDate>Fri, 18 Sep 2026 05:00:00 GMT</pubDate></item></channel></rss>';
  assert.equal(parseFeed(xml)[0].title, 'Chelsea injury update');
  const result = await fetchNewsEvidence(sampleData, now, async (url) => {
    if (
      (typeof url === 'string'
        ? url
        : url instanceof URL
          ? url.href
          : url.url
      ).includes('bbc')
    )
      return new Response(xml);
    throw new Error('outage');
  });
  assert.equal(result.coverage.sources.length, 1);
  assert.ok(result.coverage.failures.length >= 5);
  assert.equal(result.items.length, 1);
});
void test('statistical outputs and direct Jev projection obey team and appearance bounds', () => {
  const model = trainFootballModel(history, now),
    state = buildPredictionState(
      { ...input, history, footballModel: model },
      fixture,
      now,
    ),
    result = statisticalForecast(state, model, []);
  for (const [team, d] of [
    [fixture.homeCode, result.home],
    [fixture.awayCode, result.away],
  ] as const) {
    const players = result.players.filter((p) => p.team === team);
    assert.ok(players.reduce((s, p) => s + p.goal, 0) <= d.score + 1e-6);
    assert.ok(players.reduce((s, p) => s + p.assist, 0) <= d.score + 1e-6);
  }
  const raw = result.players.map((p) => ({ ...p, goal: 0.99, assist: 0.99 })),
    fixed = reconcilePlayers(
      raw,
      result.home,
      result.away,
      [fixture.homeCode, fixture.awayCode],
      state,
    );
  assert.ok(fixed.adjusted);
  assert.deepEqual(
    raw.map((p) => p.goal),
    raw.map(() => 0.99),
  );
  const player = state.players.find((p) => p.team === fixture.homeCode)!;
  const unavailable = statisticalForecast(state, model, [
    {
      playerId: player.id,
      out: 1,
      bench: 0,
      restricted: 0,
      penaltyTaker: 0,
      evidenceIds: [],
    },
  ]);
  assert.equal(unavailable.players.find((p) => p.id === player.id)?.goal, 0);
});
void test('one model response yields both forecasts; malformed semantic answers fail validation', () => {
  const p = preparePrediction(input, fixture, now),
    probs = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [i, i === 2 ? 1 : 0]),
    );
  const answers = Object.fromEntries(
    Object.entries(p.payload.questions).map(([id, q]) => [
      id,
      q.type === 'score'
        ? {
            type: 'score' as const,
            score: 5,
            confidence: 1,
            legend: {},
            probabilities: probs,
          }
        : { type: 'noul' as const, noul: 0.1 },
    ]),
  );
  const result = validatePrediction(
    p,
    {
      model: p.payload.model,
      answers,
      usage: { input_tokens: 100, output_tokens: 20 },
    },
    1,
    now,
  );
  assert.equal(result.home.score, 2);
  assert.ok(result.statistical);
  assert.ok(result.rawJev);
  delete answers.home;
  assert.throws(() =>
    validatePrediction(
      p,
      {
        model: p.payload.model,
        answers,
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      1,
      now,
    ),
  );
});
void test('release migration preserves timing and never reopens started gameweeks', () => {
  const schedule = {
    season: '2026/27',
    fetchedAt: new Date(now).toISOString(),
    events: [{ id: 4, finished: true, dataChecked: true }],
    fixtures: [
      {
        id: 42,
        event: 5,
        kickoff: fixture.kickoff,
        started: false,
        finished: false,
      },
    ],
  };
  const [old] = planReleases(schedule, now),
    updated = versionedRelease(old);
  assert.equal(updated.dueAt, old.dueAt);
  assert.equal(updated.stage, old.stage);
  assert.deepEqual(updated.fixtureIds, old.fixtureIds);
  assert.notEqual(updated.id, old.id);
  assert.equal(planReleases(schedule, Date.parse(fixture.kickoff)).length, 0);
});
import {
  compactPredictionState,
  assertPredictionPayload,
  STATE_BYTE_LIMIT,
} from '../lib/prediction-payload';
void test('compact Jev payload preserves identities and rates, bounds context before sending', () => {
  const state = buildPredictionState(input, fixture, now);
  state.qualitativeEvidence = Array.from({ length: 16 }, (_, i) => ({
    id: String(i),
    source: 'Test feed',
    publishedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 1000).toISOString(),
    teams: [fixture.homeCode],
    kind: 'reported' as const,
    text: 'Reported availability update. '.repeat(50),
  }));
  const compact = compactPredictionState(state);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) <= STATE_BYTE_LIMIT);
  assert.deepEqual(
    compact.players,
    state.players.map((p) => ({ id: p.id, providerId: p.providerId })),
  );
  assert.equal(compact.playerRows[0][12], state.players[0].nonPenaltyXgPer90);
  assert.equal(compact.playerRows[0][20], state.players[0].minutes.expected);
  assert.ok(compact.qualitativeEvidence.length > 0);
  assert.throws(
    () =>
      assertPredictionPayload({
        model: 'test',
        state: 'x'.repeat(24001),
        questions: {},
      }),
    /context budget/,
  );
  assert.throws(
    () =>
      assertPredictionPayload({
        model: 'test',
        state: {},
        questions: { huge: { type: 'noul', instructions: 'x'.repeat(50000) } },
      }),
    /context budget/,
  );
});
