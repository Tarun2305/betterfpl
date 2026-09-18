import type { DashboardData } from './fpl-data';
import type { HumanEvidence } from './prediction-engine';

const clean = (text: string) => text.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function validateEvidence(items: unknown): HumanEvidence[] {
  if (!Array.isArray(items)) throw new Error('Evidence must be an array');
  return items.map((item: HumanEvidence) => {
    if (!item || typeof item.id!=='string' || typeof item.source!=='string' || typeof item.text!=='string' || item.text.length>1500 || !item.text.trim() || !Array.isArray(item.teams) || item.teams.some(t=>typeof t!=='string') || !['reported','confirmed','opinion'].includes(item.kind) || !Number.isFinite(Date.parse(item.publishedAt)) || !Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt)<=Date.parse(item.publishedAt) || (item.url && !/^https:\/\//.test(item.url))) throw new Error('Invalid qualitative evidence item');
    return { ...item,text:clean(item.text) };
  });
}

// Fetch a bounded official-league feed. No browser visits and no AI summarization.
// Headlines are identified as headlines, not purported full-article observations.
export async function fetchOfficialEvidence(fpl: DashboardData, now = Date.now(), fetcher = fetch): Promise<HumanEvidence[]> {
  const evidence: HumanEvidence[] = [];
  for (let page=0;page<2;page++) {
    const response = await fetcher(`https://api.premierleague.com/content/premierleague/text/EN/?page=${page}&pageSize=30&detail=DETAILED`, { headers:{Accept:'application/json',Origin:'https://www.premierleague.com'},signal:AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Official news feed unavailable');
    const body = await response.json() as { content?: { id?: number; title?: string; date?: string; publishFrom?: number; titleUrlSegment?: string }[] };
    for (const story of body.content ?? []) {
      if (!story.id || typeof story.title!=='string' || !story.titleUrlSegment) continue;
      const date = typeof story.date==='string' ? Date.parse(story.date) : Number(story.publishFrom);
      if (!Number.isFinite(date) || date>now || now-date>7*24*60*60*1000) continue;
      const text = normalized(story.title);
      const mentioned = fpl.players.filter(p => text.includes(normalized(p.fullName)) || (p.name.length>=5 && new RegExp(`\\b${normalized(p.name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`).test(text)));
      const teamCodes = new Set(fpl.teams.filter(t=>text.includes(normalized(t.name))).map(t=>t.shortName));
      mentioned.forEach(p=>teamCodes.add(p.team));
      if (!teamCodes.size) continue;
      evidence.push({id:`pl-${story.id}`,source:'Premier League — headline only',url:`https://www.premierleague.com/en/news/${story.id}/${story.titleUrlSegment}`,publishedAt:new Date(date).toISOString(),expiresAt:new Date(date+7*24*60*60*1000).toISOString(),teams:[...teamCodes],playerIds:mentioned.map(p=>p.id),kind:'reported',text:clean(story.title).slice(0,600)});
    }
  }
  return evidence;
}
