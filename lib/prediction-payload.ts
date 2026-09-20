import type { Questions, JsonValue } from '@typesafe-ai/sdk';
import type { buildPredictionState } from './prediction-engine';

// Conservative UTF-8 byte ceilings, deliberately below Jev's 32k state +
// longest-question and 64k total token limits. These are not billing estimates.
export const STATE_BYTE_LIMIT = 20000;
export const REQUEST_BYTE_LIMIT = 48000;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
export function compactPredictionState(
  state: ReturnType<typeof buildPredictionState>,
) {
  const result = {
    fixture: state.fixture,
    gameweek: state.gameweek,
    teams: state.teams,
    sources: state.sources,
    coverage: state.coverage,
    definitions: {
      ...state.definitions,
      table:
        'playerRows uses playerColumns in order. Recent rows use [minutes,position,goals,conventionalAssists,xg,xa], newest first. players retains matching IDs for auditing.',
    },
    players: state.players.map((p) => ({ id: p.id, providerId: p.providerId })),
    playerColumns: [
      'id',
      'name',
      'team',
      'position',
      'status',
      'chanceOfPlaying',
      'seasonMinutes',
      'seasonStarts',
      'goals',
      'fplAssists',
      'xg',
      'xa',
      'nonPenaltyXgPer90',
      'xaPer90',
      'penaltyAttempts',
      'penaltiesOrder',
      'startProbability',
      'appearanceProbability',
      'starterMinutes',
      'benchMinutes',
      'expectedMinutes',
      'historyLink',
      'news',
      'recent',
    ],
    playerRows: state.players.map(
      (p) =>
        [
          p.id,
          p.name,
          p.team,
          p.position,
          p.status,
          p.chanceOfPlaying,
          p.seasonMinutes,
          p.seasonStarts,
          p.goals,
          p.fplAssists,
          p.xg,
          p.xa,
          p.nonPenaltyXgPer90,
          p.xaPer90,
          p.penaltyAttempts,
          p.penaltiesOrder,
          p.minutes.startProbability,
          p.minutes.appearanceProbability,
          p.minutes.starterMinutes,
          p.minutes.benchMinutes,
          p.minutes.expected,
          p.historyLink,
          p.news,
          p.recentAppearances.map((r) => [
            r.minutes,
            r.position,
            r.goals,
            r.assists,
            r.xg,
            r.xa,
          ]),
        ] as JsonValue[],
    ),
    qualitativeEvidence: state.qualitativeEvidence.map((e) => ({
      ...e,
      text: e.text.slice(0, 900),
    })),
  };
  // Retain every player's current availability/rates. Trim redundant recent rows
  // for the least likely participants first, then lowest-ranked evidence.
  const order = state.players
    .map((p, i) => ({ i, minutes: p.minutes.expected }))
    .sort((a, b) => a.minutes - b.minutes);
  for (const { i } of order) {
    if (bytes(result) <= STATE_BYTE_LIMIT) break;
    result.playerRows[i][23] = [];
  }
  while (
    bytes(result) > STATE_BYTE_LIMIT &&
    result.qualitativeEvidence.length > 1
  )
    result.qualitativeEvidence.pop();
  if (bytes(result) > STATE_BYTE_LIMIT)
    throw new Error('Jev state exceeds safe context budget before sending');
  return result;
}
export function assertPredictionPayload(payload: {
  state: unknown;
  questions: Questions;
  model: string;
}) {
  const longest = Math.max(0, ...Object.values(payload.questions).map(bytes));
  if (
    bytes(payload.state) + longest > 24000 ||
    bytes(payload) > REQUEST_BYTE_LIMIT
  )
    throw new Error('Jev request exceeds safe context budget before sending');
}
