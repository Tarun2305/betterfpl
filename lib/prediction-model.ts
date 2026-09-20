import { createHash } from 'node:crypto';
import {
  noul,
  score,
  TypeSafeClient,
  type Questions,
  type ScoreResponse,
  type SystemOneResult,
} from '@typesafe-ai/sdk';
import type { Fixture } from './fpl-data';
import {
  buildPredictionState,
  type PredictionInput,
  type FixturePrediction,
  type NewsSignal,
} from './prediction-engine';
import { distribution, trainFootballModel } from './football-model';
import { fallbackHistory } from './forecast-features';
import { statisticalForecast, reconcilePlayers } from './statistical-forecast';
import { ENGINE_VERSION } from './prediction-version';
import {
  compactPredictionState,
  assertPredictionPayload,
} from './prediction-payload';

export const MODEL = 'jev-1.13.0';
export const QUESTION_VERSION = 'football-dual-v2';
export function preparePrediction(
  input: PredictionInput,
  fixture: Fixture,
  now = Date.now(),
) {
  const fullState = buildPredictionState(input, fixture, now);
  const eligible = fullState.players.filter(
    (p) => p.position !== 'GKP' && p.minutes.appearanceProbability > 0,
  );
  // Keep squad totals/availability, but remove detailed histories for unavailable reserves.
  const state = {
    ...fullState,
    players: fullState.players.map((p) => ({
      ...p,
      recentAppearances: p.minutes.expected >= 10 ? p.recentAppearances : [],
    })),
  };
  const compactState = compactPredictionState(state);
  const questions: Questions = {};
  const rules = 'Apply definitions and estimated minutes.';
  for (const [side, code] of [
    ['home', fixture.homeCode],
    ['away', fixture.awayCode],
  ])
    questions[side] = score(
      'How many goals will ' + code + ' score in fixture? ' + rules,
      [
        'no goals',
        'one goal',
        'two goals',
        'three goals',
        'four goals',
        'five goals',
        'six goals',
        'seven goals',
        'eight goals',
        'nine or more goals',
      ].map((count) => code + ' scores ' + count + '.') as [
        string,
        string,
        ...string[],
      ],
    );
  for (const p of eligible) {
    const index = state.players.findIndex((row) => row.id === p.id),
      player = 'playerRows[' + index + '] (' + p.name + ', ' + p.team + ')';
    questions['goal_' + p.id] = noul(
      'Will ' + player + ' score in fixture? ' + rules,
    );
    questions['assist_' + p.id] = noul(
      'Will ' + player + ' assist in fixture? ' + rules,
    );
  }
  // Independent semantic questions share the same request. Statistical computation consumes
  // their answers after the durable paid-request checkpoint; no hidden second request.
  const newsPlayers = state.players.filter(
    (p) =>
      compactState.qualitativeEvidence.some((e) =>
        e.playerIds?.includes(p.id),
      ) ||
      (p.news && p.minutes.appearanceProbability > 0),
  );
  for (const p of newsPlayers) {
    const context =
      'Does reporting explicitly establish playerRows[' +
      state.players.findIndex((row) => row.id === p.id) +
      '] ';
    const evidenceRule = ' Apply definitions.humanEvidence.';
    questions['out_' + p.id] = noul(
      context + 'is ruled out of fixture?' + evidenceRule,
    );
    questions['bench_' + p.id] = noul(
      context + 'will start fixture on the bench?' + evidenceRule,
    );
    questions['restricted_' + p.id] = noul(
      context +
        'has an explicit minutes restriction for fixture?' +
        evidenceRule,
    );
    questions['penalty_' + p.id] = noul(
      context + 'is the current first-choice penalty taker?' + evidenceRule,
    );
  }
  const footballModel =
    input.footballModel ??
    trainFootballModel(input.history ?? fallbackHistory(input), now);
  const { sources, ...content } = state;
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        version: QUESTION_VERSION,
        model: MODEL,
        state: { ...content, analyticsSeason: sources.analyticsSeason },
        questions,
        footballModel,
      }),
    )
    .digest('hex');
  const payload = { model: MODEL, state: compactState, questions };
  assertPredictionPayload(payload);
  return {
    payload,
    fullState: state,
    fingerprint,
    eligible,
    newsPlayers,
    footballModel,
    newsCoverage: input.newsCoverage,
    stateBytes: Buffer.byteLength(JSON.stringify(payload)),
    questionCount: Object.keys(questions).length,
  };
}
export type PreparedPrediction = ReturnType<typeof preparePrediction>;
function goals(answer: ScoreResponse) {
  const entries = Object.entries(answer.probabilities);
  if (
    entries.length !== 10 ||
    entries.some(
      ([k, v]) => !/^\d$/.test(k) || !Number.isFinite(v) || v < 0 || v > 1,
    ) ||
    Math.abs(entries.reduce((s, [, v]) => s + v, 0) - 1) > 0.025
  )
    throw new Error('Invalid goal distribution');
  return distribution(
    Array.from({ length: 10 }, (_, i) => answer.probabilities[i]),
  );
}
export function validatePrediction(
  prepared: PreparedPrediction,
  response: SystemOneResult<Questions>,
  elapsedMs: number,
  now = Date.now(),
): FixturePrediction {
  const h = response.answers.home,
    a = response.answers.away;
  if (
    h?.type !== 'score' ||
    a?.type !== 'score' ||
    response.model !== MODEL ||
    !Number.isFinite(response.usage?.input_tokens) ||
    !Number.isFinite(response.usage?.output_tokens)
  )
    throw new Error('Invalid model response');
  const probability = (key: string) => {
    const answer = response.answers[key];
    if (
      answer?.type !== 'noul' ||
      !Number.isFinite(answer.noul) ||
      answer.noul < 0 ||
      answer.noul > 1
    )
      throw new Error('Invalid probability ' + key);
    return answer.noul;
  };
  const rawPlayers = prepared.eligible.map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    goal: probability('goal_' + p.id),
    assist: probability('assist_' + p.id),
    expectedMinutes: p.minutes.expected,
  }));
  const signals: NewsSignal[] = prepared.newsPlayers.map((p) => ({
    playerId: p.id,
    out: probability('out_' + p.id),
    bench: probability('bench_' + p.id),
    restricted: probability('restricted_' + p.id),
    penaltyTaker: probability('penalty_' + p.id),
    evidenceIds: prepared.payload.state.qualitativeEvidence
      .filter((e) => e.playerIds?.includes(p.id))
      .map((e) => e.id),
  }));
  const home = goals(h),
    away = goals(a),
    state = prepared.fullState;
  const reconciled = reconcilePlayers(
    rawPlayers,
    home,
    away,
    [state.fixture.homeCode, state.fixture.awayCode],
    state,
  );
  return {
    fixtureId: state.fixture.id,
    home,
    away,
    players: reconciled.players,
    model: response.model,
    usage: response.usage,
    elapsedMs,
    fingerprint: prepared.fingerprint,
    createdAt: new Date(now).toISOString(),
    evidence: prepared.payload.state.qualitativeEvidence,
    engineVersion: ENGINE_VERSION,
    coverage: state.coverage,
    newsCoverage: prepared.newsCoverage,
    warnings: reconciled.adjusted
      ? [
          'Jev player probabilities were reduced to respect appearance and team-goal bounds. This consistency adjustment is not calibration.',
        ]
      : [],
    rawJev: { home, away, players: rawPlayers },
    statistical: statisticalForecast(state, prepared.footballModel, signals),
  };
}
export async function evaluatePrediction(prepared: PreparedPrediction) {
  const start = performance.now();
  const response = await new TypeSafeClient({
    timeout: 60000,
    retry: { maxRetries: 0 },
    logLevel: 'off',
  }).systemOne(prepared.payload);
  return validatePrediction(
    prepared,
    response,
    Math.round(performance.now() - start),
  );
}
