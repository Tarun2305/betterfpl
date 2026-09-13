export const dynamic = 'force-dynamic';

function integer(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const entryId = integer(url.searchParams.get('id'));
  const requestedEvent = integer(url.searchParams.get('event'));

  if (!entryId) return Response.json({ error: 'Enter a valid numeric FPL team ID.' }, { status: 400 });

  try {
    const entryResponse = await fetch(`https://fantasy.premierleague.com/api/entry/${entryId}/`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (entryResponse.status === 404) return Response.json({ error: 'No public FPL team was found for that ID.' }, { status: 404 });
    if (!entryResponse.ok) throw new Error('Entry request failed');

    const entry = await entryResponse.json() as any;
    const event = requestedEvent ?? Number(entry.current_event);
    if (!Number.isInteger(event) || event < 1) return Response.json({ error: 'This team does not have a gameweek squad yet.' }, { status: 404 });

    const picksResponse = await fetch(`https://fantasy.premierleague.com/api/entry/${entryId}/event/${event}/picks/`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!picksResponse.ok) return Response.json({ error: `No squad is available for gameweek ${event}.` }, { status: 404 });
    const picks = await picksResponse.json() as any;

    return Response.json({
      id: entryId,
      teamName: String(entry.name ?? `FPL team ${entryId}`),
      managerName: `${entry.player_first_name ?? ''} ${entry.player_last_name ?? ''}`.trim(),
      overallPoints: Number(entry.summary_overall_points ?? 0),
      overallRank: Number(entry.summary_overall_rank ?? 0),
      event,
      eventPoints: Number(picks.entry_history?.points ?? 0),
      bank: Number(picks.entry_history?.bank ?? 0) / 10,
      value: Number(picks.entry_history?.value ?? 0) / 10,
      picks: (Array.isArray(picks.picks) ? picks.picks : []).map((pick: any) => ({
        playerId: Number(pick.element),
        position: Number(pick.position),
        multiplier: Number(pick.multiplier),
        captain: Boolean(pick.is_captain),
        viceCaptain: Boolean(pick.is_vice_captain),
        purchasePrice: Number(pick.purchase_price ?? 0) / 10,
        sellingPrice: Number(pick.selling_price ?? 0) / 10,
      })),
    }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch {
    return Response.json({ error: 'The public FPL service is unavailable right now. Try again shortly.' }, { status: 502 });
  }
}
