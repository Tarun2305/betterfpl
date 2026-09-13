export type AnalyticsMatch = {
  id: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeCode: string;
  awayCode: string;
  homeGoals: number;
  awayGoals: number;
  homeXg: number;
  awayXg: number;
  homeNpxg: number;
  awayNpxg: number;
  homePpda: number;
  awayPpda: number;
  homeDeep: number;
  awayDeep: number;
  homeXpts: number;
  awayXpts: number;
};

export type AnalyticsShot = {
  id: number;
  matchId: number;
  team: string;
  player: string;
  assist: string;
  minute: number;
  xg: number;
  x: number;
  y: number;
  bodyPart: string;
  situation: string;
  result: string;
};

export type AnalyticsPlayerMatch = {
  matchId: number;
  team: string;
  player: string;
  position: string;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  xg: number;
  xa: number;
  keyPasses: number;
  xgChain: number;
  xgBuildup: number;
};

export type AnalyticsData = {
  matches: AnalyticsMatch[];
  shots: AnalyticsShot[];
  playerMatches: AnalyticsPlayerMatch[];
  season: string;
  fetchedAt: string;
  source: string;
};

export const emptyAnalytics: AnalyticsData = {
  matches: [], shots: [], playerMatches: [], season: '', fetchedAt: '', source: 'Unavailable',
};
