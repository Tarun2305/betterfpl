import { createHash } from 'node:crypto';
import type { DashboardData } from './fpl-data';
import type { HumanEvidence } from './prediction-engine';
import {
  fetchOfficialEvidence,
  linkNews,
  newsRelevance,
} from './prediction-evidence';

export const NEWS_FEEDS = [
  { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
  {
    name: 'The Guardian',
    url: 'https://www.theguardian.com/football/premierleague/rss',
  },
  { name: 'Sky Sports', url: 'https://www.skysports.com/rss/12040' },
  { name: 'ESPN', url: 'https://www.espn.com/espn/rss/soccer/news' },
  {
    name: 'The Independent',
    url: 'https://www.independent.co.uk/sport/football/rss',
  },
  {
    name: 'Evening Standard',
    url: 'https://www.standard.co.uk/sport/football/rss',
  },
];
export const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
      const c =
        n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ' ';
    })
    .replace(
      /&(?:amp|quot|apos|lt|gt|nbsp);/g,
      (v) =>
        ({
          '&amp;': '&',
          '&quot;': '"',
          '&apos;': "'",
          '&lt;': '<',
          '&gt;': '>',
          '&nbsp;': ' ',
        })[v]!,
    )
    .replace(/\s+/g, ' ')
    .trim();
export function parseFeed(xml: string) {
  if (!/<(?:rss|feed)\b/i.test(xml)) throw new Error('Invalid RSS/Atom feed');
  return [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .slice(0, 80)
    .map(([, , body]) => {
      const tag = (name: string) =>
        body.match(
          new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'),
        )?.[1] ?? '';
      return {
        title: decode(tag('title')),
        description: decode(
          tag('description') || tag('summary') || tag('content:encoded'),
        ),
        url:
          decode(tag('link')) ||
          body.match(/<link[^>]+href=["']([^"']+)/i)?.[1] ||
          '',
        date: decode(tag('pubDate') || tag('published') || tag('updated')),
      };
    });
}
async function boundedText(url: string, fetcher: typeof fetch, max = 1500000) {
  const response = await fetcher(url, {
    headers: {
      'User-Agent': 'BetterFPL/1.0 (football team-news research)',
      Accept: 'application/rss+xml, application/xml, text/html',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  let size = 0,
    text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error('Response exceeds limit');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export async function fetchNewsEvidence(
  fpl: DashboardData,
  now = Date.now(),
  fetcher = fetch,
) {
  const sources: string[] = [],
    failures: string[] = [];
  const results = await Promise.allSettled(
    NEWS_FEEDS.map(async (source) => {
      const stories = parseFeed(await boundedText(source.url, fetcher));
      const items: HumanEvidence[] = [];
      for (const story of stories) {
        const date = Date.parse(story.date);
        if (
          !Number.isFinite(date) ||
          date > now ||
          now - date > 7 * 86400000 ||
          !story.url.startsWith('https://')
        )
          continue;
        const text = [story.title, story.description]
            .filter(Boolean)
            .join('. ')
            .slice(0, 1500),
          relevance = newsRelevance(text),
          linked = linkNews(text, fpl);
        if (!relevance || !linked.teams.length) continue;
        items.push({
          id: createHash('sha256').update(story.url).digest('hex').slice(0, 20),
          source: source.name,
          url: story.url,
          publishedAt: new Date(date).toISOString(),
          expiresAt: new Date(date + 3 * 86400000).toISOString(),
          teams: linked.teams,
          playerIds: linked.playerIds,
          kind: 'reported',
          text,
          contentType: story.description ? 'feed-excerpt' : 'headline',
          relevance,
        });
      }
      return { name: source.name, items };
    }),
  );
  const items: HumanEvidence[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      sources.push(r.value.name);
      items.push(...r.value.items);
    } else failures.push(NEWS_FEEDS[i].name);
  });
  try {
    items.push(...(await fetchOfficialEvidence(fpl, now, fetcher)));
    sources.push('Premier League / official club headlines');
  } catch {
    failures.push('Premier League');
  }
  // Supplement the most relevant reports with selected factual paragraphs. No paywall
  // bypass, arbitrary hosts, AI summaries, or full-article copies enter the request.
  const allowed = [
    'bbc.com',
    'bbc.co.uk',
    'theguardian.com',
    'skysports.com',
    'espn.com',
    'independent.co.uk',
    'standard.co.uk',
  ];
  const selected = items
    .filter(
      (item) =>
        item.url &&
        item.relevance === 3 &&
        allowed.some((host) => {
          const h = new URL(item.url!).hostname;
          return h === host || h.endsWith('.' + host);
        }),
    )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 18);
  for (let i = 0; i < selected.length; i += 3)
    await Promise.all(
      selected.slice(i, i + 3).map(async (item) => {
        try {
          const html = await boundedText(item.url!, fetcher);
          const body = html.replace(
            /<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi,
            '',
          );
          const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
            .map((m) => decode(m[1]))
            .filter(
              (p) =>
                p.length > 40 &&
                p.length < 900 &&
                newsRelevance(p) === 3 &&
                linkNews(p, fpl).teams.some((t) => item.teams.includes(t)),
            );
          if (paragraphs.length) {
            item.text = (
              item.text +
              ' ' +
              paragraphs.slice(0, 2).join(' ')
            ).slice(0, 1500);
            item.contentType = 'article-excerpt';
            const linked = linkNews(item.text, fpl);
            item.playerIds = linked.playerIds;
            item.teams = linked.teams;
          }
        } catch {
          /* The attributed feed excerpt remains usable. */
        }
      }),
    );
  // Each feed is isolated: one outage never removes usable evidence from other sources.
  return { items, coverage: { sources, failures } };
}
