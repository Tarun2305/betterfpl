export type WhoScoredPlayer = {
  player: string;
  team: string;
  teamCode: string;
  matches: number;
  passesAttempted: number;
  passesCompleted: number;
  touches: number;
  tacklesWon: number;
  interceptions: number;
  takeOnsWon: number;
  aerialsWon: number;
  clearances: number;
  dispossessed: number;
};

export type ClubEloRating = {
  team: string;
  teamCode: string;
  elo: number;
  rank: number | null;
  date: string;
  source: 'ClubElo' | 'Local Elo';
};

export type EnrichmentData = {
  whoScoredPlayers: WhoScoredPlayer[];
  clubElo: ClubEloRating[];
  fetchedAt: string;
  whoScoredFetchedAt: string | null;
  clubEloFetchedAt: string | null;
};

export const emptyEnrichment: EnrichmentData = {
  whoScoredPlayers: [],
  clubElo: [],
  fetchedAt: '',
  whoScoredFetchedAt: null,
  clubEloFetchedAt: null,
};
