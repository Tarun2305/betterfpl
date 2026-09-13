# BetterFPL

A lightweight Fantasy Premier League research dashboard. It uses only public FPL data and does not connect to an FPL account.

## Start it

Double-click `start-dashboard.cmd`, then open <http://localhost:3000> if the browser does not open automatically. Keep the small command window open while using the dashboard.

## Features

- Public FPL player and fixture data with a bundled offline fallback
- Player search, position/team/price filters and sortable metrics
- FPL totals alongside expected goals, assists and involvement metrics
- Persistent on-device shortlist, status, tags and notes
- Three-player comparison tray
- Upcoming fixtures grouped by gameweek with FPL difficulty ratings
- Team dashboards with squad totals, leading assets and six-fixture runs
- Transparent one- and three-gameweek player projections
- Minutes reliability, expected involvement per 90 and transfer momentum
- A persistent 15-player squad planner with budget, club and position checks
- Captain selection and projected next-gameweek total
- Completed-match centre with selectable Premier League matches
- Understat shot maps and cumulative expected-goals timelines
- Match-level xG, non-penalty xG, expected points, PPDA and deep completions
- Player match contributions including shots, xG, xA, key passes and xG chain
- Tactical team profiles and a match-by-match performance log
- Unified player drawer with FPL overview, Understat per-90 metrics and recent-match logs
- Upcoming attacking matchup rankings inside Projections, blending team xG, opponent xGA, territory and press indicators

## Data behaviour

In production the dashboard reads its FPL, Understat, WhoScored and Elo snapshots from the private `betterfpl-cache` Supabase bucket through a server-only route. Browser responses explicitly disable dataset caching. A scheduled GitHub Action refreshes and validates the snapshots daily, then switches the dashboard to the completed snapshot. Bundled JSON files remain only as a deployment-safe fallback when Supabase has not been configured or is temporarily unavailable.

Understat provides shot events and useful match-level analytical measures, but not the complete pass-event or tracking feeds required for honest pass networks and off-ball maps. Those views are deliberately omitted instead of being approximated from unrelated data.

The projection is deliberately transparent: 60% recent FPL form, 40% season points per match, then adjustments for fixture difficulty, minutes reliability and current availability. It is a planning estimate, not an official FPL or betting prediction.

Shortlists and notes use browser storage. They remain private to this browser profile and can be lost if the site data for `localhost` is cleared.

## Refresh the data snapshot

The GitHub workflow in `.github/workflows/refresh-data.yml` runs every day at 03:17 UTC and can also be started manually from the repository's Actions page. It refreshes all three datasets and uploads an immutable snapshot to Supabase. WhoScored runs headlessly and keeps the previous snapshot if scraping is blocked. ClubElo's public endpoint is currently unreliable, so BetterFPL automatically uses a locally calculated, results-based Elo rating until the official feed responds again.

For local-only refreshing, `refresh-data.cmd` is still available.

## Deployment settings

GitHub Actions requires two repository secrets named `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Vercel requires environment variables with the same names; `SUPABASE_STORAGE_BUCKET=betterfpl-cache` is optional because that is the built-in default. Never prefix the secret with `NEXT_PUBLIC_`.

Code pushes to `main` deploy through Vercel. Daily dataset refreshes update Supabase directly and therefore do not create unnecessary website deployments.

Shortlists, notes, theme and planner choices remain tiny browser preferences so that the public, account-free site can distinguish one visitor's choices from another's. The large sports datasets are never persisted in browser storage. Removing those preferences entirely would make them reset on every reload; cloud-synchronised personal preferences can be added later only if user accounts are introduced.
