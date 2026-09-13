# BetterFPL

A private, local-first Fantasy Premier League research dashboard. It does not connect to an FPL account and does not upload your shortlist or notes.

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

The start script downloads the public no-login FPL player and fixture feeds into `public/fpl-data.json` before opening the dashboard. It also uses the local Python environment and SoccerData's Understat reader to refresh completed-match analytics in `public/analytics-data.json`. WhoScored event summaries and ClubElo ratings refresh in the background into `public/enrichment-data.json`, so their slower or temporarily unavailable services never delay the dashboard. All caches keep their last successful data when a source is unreachable; if no FPL cache exists, the interface remains usable with demonstration data.

Understat provides shot events and useful match-level analytical measures, but not the complete pass-event or tracking feeds required for honest pass networks and off-ball maps. Those views are deliberately omitted instead of being approximated from unrelated data.

The projection is deliberately transparent: 60% recent FPL form, 40% season points per match, then adjustments for fixture difficulty, minutes reliability and current availability. It is a planning estimate, not an official FPL or betting prediction.

Shortlists and notes use browser storage. They remain private to this browser profile and can be lost if the site data for `localhost` is cleared.

## Refresh the data snapshot

Run `refresh-data.cmd` before a deployment when you want fresh Understat and WhoScored-derived data. The FPL endpoints also refresh on demand when the deployed dashboard is opened. WhoScored runs headlessly and keeps the previous snapshot if scraping is blocked. ClubElo's public endpoint is currently unreliable, so BetterFPL automatically uses a locally calculated, results-based Elo rating until the official feed responds again.

## Deploy with Vercel and GitHub

1. Create an empty GitHub repository named `betterfpl`.
2. In this folder, run `git add .`, `git commit -m "Initial BetterFPL release"`, `git remote add origin YOUR_GITHUB_REPOSITORY_URL`, then `git push -u origin main`.
3. Sign in to Vercel, choose **Add New → Project**, import the GitHub repository, and leave the detected **Next.js** settings unchanged.
4. Deploy. Vercel will give you a production URL and will build a preview for later branches and pull requests.

For future interface changes, commit and push to `main`; Vercel will rebuild the production site automatically. For data-only updates, run `refresh-data.cmd`, commit the changed files in `public`, and push them the same way.

The shortlist, notes, theme, and planner are stored in each browser, so they do not sync between friends or devices. A Vercel Hobby production URL is public unless an application-level login or a paid protection option is added.
