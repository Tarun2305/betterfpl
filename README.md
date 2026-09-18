# BetterFPL

BetterFPL is an independent Fantasy Premier League research dashboard that turns public football data into a clearer gameweek decision-making workspace.

**Live site:** [betterfpl.vercel.app](https://betterfpl.vercel.app)

## What it does

BetterFPL brings player research, fixture analysis and squad planning into one account-free interface. The home dashboard highlights timely players, transfer trends and upcoming fixtures, while the deeper workspaces make it easy to:

- Search and filter the full FPL player pool
- Shortlist players and keep private notes in the browser
- Compare up to three players side by side
- Review upcoming fixtures and difficulty ratings
- Explore completed matches through shot maps and xG timelines
- Inspect team performance, tactical profiles and recent match logs
- Rank players using transparent one- and three-gameweek projections
- Build a 15-player squad and check its budget, structure and captaincy
- Load a public FPL team by its team ID for planning

## How to use it

Open the live site and use the menu in the top-left to move between workspaces. Clicking a player opens a detailed view with official FPL totals, underlying numbers, recent matches, fixtures and personal planning tools.

No FPL login is required. Shortlists, notes, theme and planner choices are stored only in the current browser, so they stay private to that device and browser profile.

## Data and projections

The dashboard combines public FPL data with Understat match and player metrics, selected WhoScored event data and team-strength ratings. Snapshots are refreshed automatically each day and stored in Supabase. The homepage includes saved player data on first load, while detailed analytics load when needed. Shared delivery caches refresh on a five-minute interval; the homepage shows when the underlying FPL data was last updated.

If cloud data is unavailable, the site can display its bundled saved snapshot and identifies this fallback. Data is not real-time, so check official FPL information before a deadline.

Player projections deliberately use a simple, understandable model: recent form and season points-per-match are adjusted for fixture difficulty, expected minutes and availability. They are planning estimates—not official predictions, bookmaker odds or guarantees.

Some analytical views are intentionally omitted when the available public data cannot support them honestly. For example, reliable pass networks and off-ball maps require complete event or tracking feeds.

## Project status

BetterFPL is an actively evolving personal project built to make FPL research quicker, more visual and less fragmented. Feedback and suggestions are welcome.

BetterFPL is not affiliated with or endorsed by the Premier League.
