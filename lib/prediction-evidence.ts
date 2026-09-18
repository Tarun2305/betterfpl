import type { DashboardData } from './fpl-data';
import type { HumanEvidence } from './prediction-engine';
import { normalizeName, playerNames } from './forecast-features';

const clean = (text: string) =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const clubAliases: Record<string, string[]> = {
  MCI: ['Manchester City', 'Man City'],
  MUN: ['Manchester United', 'Man Utd'],
  TOT: ['Tottenham', 'Spurs'],
  NFO: ['Nottingham Forest', "Nott'm Forest"],
  BHA: ['Brighton'],
  NEW: ['Newcastle'],
  LEE: ['Leeds'],
  COV: ['Coventry'],
  HUL: ['Hull City'],
  IPS: ['Ipswich'],
};
const words = (s: string) =>
  s
    .replace(/[øØ]/g, 'o')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const contains = (haystack: string, needle: string) =>
  ` ${words(haystack)} `.includes(` ${words(needle)} `);
export function newsRelevance(text: string) {
  if (
    /\b(?:WSL|women['’]?s|women|under.?21|under.?18|U21|U18|non.league|retired|years after|years ago|legend|collector|sponsorship)\b/i.test(
      text,
    )
  )
    return 0;
  if (
    /collector|sponsorship|partnership|virtual events|tickets|merchandise|matchday programme|shirt sale/i.test(
      text,
    )
  )
    return 0;
  return /injur|ruled out|suspend|team news|line.?up|fitness|fit to|training|return|rotation|rested|minutes|substitut|penalt|set.piece|tactic|formation|hamstring|ankle|groin|doubt|bench/i.test(
    text,
  )
    ? 3
    : /preview|manager|press conference|squad|match report/i.test(text)
      ? 1
      : 0;
}
export function linkNews(text: string, fpl: DashboardData) {
  const teams = new Set(
    fpl.teams
      .filter((t) =>
        [t.name, ...(clubAliases[t.shortName] ?? [])].some((n) =>
          contains(text, n),
        ),
      )
      .map((t) => t.shortName),
  );
  const mentioned = new Set<number>();
  // Ignore an ambiguous surname in the speaker prefix ("Andrews: ...").
  const subject = text.replace(/^[^.!?]{1,45}:\s*/, '');
  for (const p of fpl.players) {
    const full =
      contains(subject, p.fullName) ||
      [...playerNames(p)].some(
        (n) =>
          n.length > 8 &&
          normalizeName(p.name) !== n &&
          normalizeName(subject).includes(n),
      );
    const surname =
      p.name.length >= 5 &&
      contains(subject, p.name) &&
      teams.has(p.team) &&
      fpl.players.filter(
        (other) => other.team === p.team && words(other.name) === words(p.name),
      ).length === 1;
    if (full || surname) {
      mentioned.add(p.id);
      teams.add(p.team);
    }
  }
  return { teams: [...teams], playerIds: [...mentioned] };
}
export function validateEvidence(items: unknown): HumanEvidence[] {
  if (!Array.isArray(items)) throw new Error('Evidence must be an array');
  return items.map((item: HumanEvidence) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      typeof item.source !== 'string' ||
      typeof item.text !== 'string' ||
      item.text.length > 1500 ||
      !item.text.trim() ||
      !Array.isArray(item.teams) ||
      item.teams.some((t) => typeof t !== 'string') ||
      !['reported', 'confirmed', 'opinion'].includes(item.kind) ||
      !Number.isFinite(Date.parse(item.publishedAt)) ||
      !Number.isFinite(Date.parse(item.expiresAt)) ||
      Date.parse(item.expiresAt) <= Date.parse(item.publishedAt) ||
      (item.url && !item.url.startsWith('https://'))
    )
      throw new Error('Invalid qualitative evidence item');
    return { ...item, text: clean(item.text) };
  });
}

// Fetch a bounded official-league feed. No browser visits and no AI summarization.
// Headlines are identified as headlines, not purported full-article observations.
export async function fetchOfficialEvidence(
  fpl: DashboardData,
  now = Date.now(),
  fetcher = fetch,
): Promise<HumanEvidence[]> {
  const evidence: HumanEvidence[] = [];
  for (let page = 0; page < 2; page++) {
    const response = await fetcher(
      `https://api.premierleague.com/content/premierleague/text/EN/?page=${page}&pageSize=30&detail=DETAILED`,
      {
        headers: {
          Accept: 'application/json',
          Origin: 'https://www.premierleague.com',
        },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw new Error('Official news feed unavailable');
    const body = (await response.json()) as {
      content?: {
        id?: number;
        title?: string;
        date?: string;
        publishFrom?: number;
        titleUrlSegment?: string;
      }[];
    };
    for (const story of body.content ?? []) {
      if (
        !story.id ||
        typeof story.title !== 'string' ||
        !story.titleUrlSegment
      )
        continue;
      const date =
        typeof story.date === 'string'
          ? Date.parse(story.date)
          : Number(story.publishFrom);
      if (
        !Number.isFinite(date) ||
        date > now ||
        now - date > 7 * 24 * 60 * 60 * 1000
      )
        continue;
      const linked = linkNews(story.title, fpl);
      const mentioned = fpl.players.filter((p) =>
        linked.playerIds.includes(p.id),
      );
      const teamCodes = new Set(linked.teams);
      if (!newsRelevance(story.title)) continue;
      if (!teamCodes.size) continue;
      evidence.push({
        id: `pl-${story.id}`,
        source: 'Premier League — headline only',
        url: `https://www.premierleague.com/en/news/${story.id}/${story.titleUrlSegment}`,
        publishedAt: new Date(date).toISOString(),
        expiresAt: new Date(date + 7 * 24 * 60 * 60 * 1000).toISOString(),
        teams: [...teamCodes],
        playerIds: mentioned.map((p) => p.id),
        kind: 'reported',
        text: clean(story.title).slice(0, 600),
        contentType: 'headline',
        relevance: newsRelevance(story.title),
      });
    }
  }
  return evidence;
}
