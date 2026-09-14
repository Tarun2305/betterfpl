type PremierLeagueTag = { label?: unknown };

type PremierLeagueStory = {
  id?: unknown;
  title?: unknown;
  date?: unknown;
  publishFrom?: unknown;
  titleUrlSegment?: unknown;
  tags?: PremierLeagueTag[];
};

type PremierLeagueResponse = { content?: PremierLeagueStory[] };

const contentPages = [0, 1, 2, 3, 4, 5, 6];
const apiBase = 'https://api.premierleague.com/content/premierleague/text/EN/';

function isFantasyStory(story: PremierLeagueStory) {
  const labels = story.tags?.map((tag) => tag.label).filter((label): label is string => typeof label === 'string') ?? [];
  const title = typeof story.title === 'string' ? story.title : '';
  return (labels.includes('label:Fantasy Premier League') || labels.includes('series:fantasy')) && !/FPL Challenge/i.test(title);
}

function storyTimestamp(story: PremierLeagueStory) {
  const parsed = typeof story.date === 'string' ? Date.parse(story.date) : Number.NaN;
  return Number.isNaN(parsed) ? Number(story.publishFrom ?? 0) : parsed;
}

export async function GET() {
  try {
    const responses = await Promise.all(contentPages.map(async (page) => {
      const params = new URLSearchParams({ page: String(page), pageSize: '30', detail: 'DETAILED' });
      const response = await fetch(`${apiBase}?${params}`, {
        headers: { Accept: 'application/json', Origin: 'https://www.premierleague.com' },
        next: { revalidate: 1800 },
      });
      if (!response.ok) throw new Error(`Premier League content request failed with ${response.status}`);
      return response.json() as Promise<PremierLeagueResponse>;
    }));

    const stories = responses
      .flatMap((response) => response.content ?? [])
      .filter(isFantasyStory)
      .filter((story) => typeof story.id === 'number' && typeof story.title === 'string' && typeof story.titleUrlSegment === 'string')
      .sort((a, b) => storyTimestamp(b) - storyTimestamp(a))
      .slice(0, 3)
      .map((story) => ({
        id: story.id as number,
        title: story.title as string,
        date: typeof story.date === 'string' ? story.date : '',
        url: `https://www.premierleague.com/en/news/${story.id}/${story.titleUrlSegment}`,
        source: 'Premier League · The Scout',
      }));

    if (!stories.length) throw new Error('The Premier League feed returned no FPL stories');

    return Response.json({ stories }, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400' },
    });
  } catch (error) {
    console.error('Unable to refresh official FPL headlines', error);
    return Response.json({ stories: [] }, {
      status: 502,
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  }
}
