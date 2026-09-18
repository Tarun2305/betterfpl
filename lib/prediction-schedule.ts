export type ScheduleFixture = { id: number; event: number | null; kickoff: string | null; finished: boolean; started: boolean };
export type ScheduleEvent = { id: number; finished: boolean; dataChecked: boolean };
export type PredictionSchedule = { season: string; fetchedAt: string; events: ScheduleEvent[]; fixtures: ScheduleFixture[] };
export type PredictionRelease = { id: string; season: string; gameweek: number; stage: 'early' | 'pre-kickoff'; fixtureIds: number[]; firstKickoff: string; dueAt: string; merged: boolean };

export function planReleases(schedule: PredictionSchedule, now = Date.now()): PredictionRelease[] {
  const future = schedule.fixtures.filter(f => f.event !== null && !f.finished && !f.started && f.kickoff && Date.parse(f.kickoff)>now)
    .sort((a,b)=>String(a.kickoff).localeCompare(String(b.kickoff)));
  const gameweek = future[0]?.event;
  if (!gameweek) return [];
  const fixtures = future.filter(f=>f.event===gameweek);
  // Preserve the original first kickoff even after some fixtures start.
  const first = schedule.fixtures.filter(f=>f.event===gameweek && f.kickoff).sort((a,b)=>String(a.kickoff).localeCompare(String(b.kickoff)))[0]?.kickoff;
  if (!first || Date.parse(first)<=now) return [];
  const previous = schedule.events.find(e=>e.id===gameweek-1);
  const previousFixtures = schedule.fixtures.filter(f=>f.event===gameweek-1);
  // Null-kickoff postponed matches must not hold a release indefinitely.
  const scheduledPrevious = previousFixtures.filter(f=>f.kickoff);
  const previousClosed = gameweek===1 || Boolean(previous?.finished && previous.dataChecked)
    || (scheduledPrevious.length>0 && scheduledPrevious.every(f=>f.finished));
  const preDue = Date.parse(first)-12*60*60*1000;
  const base = { season:schedule.season, gameweek, fixtureIds:fixtures.map(f=>f.id), firstKickoff:first };
  const id = (stage: string) => `${schedule.season}:gw${gameweek}:${stage}`;
  if (now>=preDue) return [{ ...base,id:id('pre-kickoff'),stage:'pre-kickoff',dueAt:new Date(preDue).toISOString(),merged:previousClosed }];
  return previousClosed ? [{ ...base,id:id('early'),stage:'early',dueAt:new Date(now).toISOString(),merged:false }] : [];
}
