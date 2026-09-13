export const dynamic = 'force-dynamic';

const badgeCache = new Map<number, Promise<{ bytes: ArrayBuffer; contentType: string }>>();

async function loadBadge(code: number) {
  const existing = badgeCache.get(code);
  if (existing) return existing;

  const pending = (async () => {
    const upstream = await fetch(`https://resources.premierleague.com/premierleague/badges/70/t${code}.png`, {
      headers: {
        Accept: 'image/png,image/*;q=0.8',
        'User-Agent': 'BetterFPL/1.0',
      },
    });

    if (!upstream.ok) throw new Error('Badge unavailable');
    return {
      bytes: await upstream.arrayBuffer(),
      contentType: upstream.headers.get('content-type') ?? 'image/png',
    };
  })();

  badgeCache.set(code, pending);
  pending.catch(() => badgeCache.delete(code));
  return pending;
}

export async function GET(request: Request) {
  const code = Number(new URL(request.url).searchParams.get('code'));

  if (!Number.isInteger(code) || code < 1 || code > 9999) {
    return new Response('Invalid club code', { status: 400 });
  }

  try {
    const badge = await loadBadge(code);
    return new Response(badge.bytes.slice(0), {
      headers: {
        'Content-Type': badge.contentType,
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000',
      },
    });
  } catch {
    return new Response('Badge unavailable', { status: 502 });
  }
}
