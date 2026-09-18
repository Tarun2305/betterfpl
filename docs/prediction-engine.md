# Local automatic Prediction Engine

## Production setup

The `Publish gameweek predictions` GitHub workflow checks fixture timing hourly at minute 37. Most checks use only Node's built-in APIs, skipping npm/Python installation; no Jev requests occur unless one of the two gameweek releases is due and unclaimed. GitHub scheduling can be delayed, so publication is approximately 12 hours before kickoff, not an exact-time guarantee. Manual workflow reruns cannot force another paid release. Schedule-only GitHub workflows may be disabled after 60 days of repository inactivity on public repositories; check GitHub's workflow notifications. This is not a promise of zero maintenance forever.

In **GitHub → repository Settings → Secrets and variables → Actions → Repository secrets**, add `TYPESAFE_API_KEY`. The existing `SUPABASE_URL` and `BETTERFPL_SUPABASE_KEY` are also required; the latter must be a server secret/service-role key, never an anonymous key. No TypeSafe key is needed in Vercel or the browser. Vercel needs the existing server-only `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and optionally `SUPABASE_STORAGE_BUCKET` settings. The default bucket is `betterfpl-cache` and must exist and be **private**. No new SQL schema or migrations are needed: this uses the existing Supabase Storage bucket.

Private `predictions/private/state.sqlite` holds checkpoints and request history. Immutable `predictions/private/claims/<release>.json` objects atomically reserve each release before any model call, with overwrite disabled. Each checkpoint is persisted to Supabase before proceeding. GitHub workflow concurrency serializes publishers. Production storage is deliberately separate from local SQLite. Each release has at most one attempted publishing session: cancelled/failed/partial releases stay held instead of automatically spending again. Review failed workflow notifications; never delete claims or checkpoints casually. Last-good fixture results remain available when newer results fail. Published `predictions/latest.json` and archived `predictions/releases/*.json` contain only display results and evidence, not raw requests.

The website's GET endpoint downloads saved results through its server-only Supabase credentials and never imports/calls the model. There is no POST handler or evaluation button. Adding the key enables future due releases automatically; if the upcoming gameweek has already started, the worker waits for the next eligible one. Headlines are fetched fresh for each release. Production does not ingest the ignored local observations file.

Verification includes mocked durability tests and type checks. Actual Supabase permissions and live API accuracy must be verified after secrets are configured; they cannot be proven without production credentials.

The website is read-only. It retrieves the latest saved predictions every minute while the Prediction Engine tab is open. It has no evaluate buttons, no prediction POST endpoint, and no browser storage. Site visits, reloads and tab switching cannot call Jev.

## Start locally

Put your TypeSafe key in the ignored root `.env` as `TYPESAFE_API_KEY`. Run `npm run dev` or `start-dashboard.cmd`: both start the dashboard and a local prediction scheduler. The scheduler checks every 15 minutes while your computer/process is running. Restart after changing the key. The standalone `npm run predictions:watch` runs the worker without the website. The original JEV project's key is neither read nor copied.

- `npm run predictions:dry-run`: refresh only FPL/schedule data, show due releases; **never calls Jev**. Works without a key.
- `npm run predictions:plan`: inspect the saved schedule; no network or model calls. Run a dry run first to create schedule metadata.
- `npm run predictions:once`: refresh schedule, execute a due release if configured; uses API credits only for new fixture evidence.
- `npm run test:predictions`: mocked local tests, no network or credits.

Missing keys leave the worker waiting. Full runs refresh existing Python analytics/enrichment scripts; the default interpreter is `.venv/Scripts/python.exe`. Override with `PREDICTION_PYTHON` on other machines. The worker refuses stale FPL/analytics and mismatched analytics seasons. No cloud deployment, Supabase changes or OS task installation is included.

## Reusable schedule

The FPL refresh saves completed-fixture/event metadata to `work/prediction-engine/schedule.json`, independently of the dashboard's upcoming-only fixtures. There are two releases per season/gameweek:

1. **Early outlook:** previous event is finished/data checked, or all its scheduled matches are finished; fresh match evidence must be available.
2. **Pre-gameweek update:** first kickoff minus 12 hours, caught on the first successful scheduler check after that point and before kickoff.

If first startup or previous closure falls inside the 12-hour window, publish only the pre-gameweek update (merged window). Null-kickoff postponed games do not hold closure forever. An unfinished match retaining its old kickoff remains a conservative closure blocker unless FPL closes the event; the pre-kickoff release still runs independently. Blanks and doubles are handled from fixture IDs/event metadata; started gameweeks are not reforecast. Fixture moves are reflected before a release; already completed releases are not automatically reopened for later rescheduling. This is a deliberate two-release spending policy.

## Durable storage and spending safeguards

`work/prediction-engine/predictions.sqlite` stores releases, each fixture checkpoint, exact sent request, results, evidence and estimated token reservations. Portable SQLite uses sql.js. A filesystem PID lock permits only one writer; dead-worker locks are recovered. The writer saves atomically after each fixture. Browser routes open read-only snapshots and never persist anything.

Content hashes include numerical/qualitative evidence, model and question version, but exclude fetch timestamps. Identical fixture evidence reuses results across releases and restarts. Reused results preserve original prediction time and show the newer check time. Only successful new results supersede earlier results, so failures keep last-good predictions visible.

Before every paid request the worker stores a `sending` checkpoint. A crash, timeout, malformed model response or uncertain provider failure holds the release for operator review; **it is never automatically retried**, because it may have been charged. Definite rejections (HTTP 400/401/403/404/422/429) can be retried explicitly with `npm run predictions:once -- --retry-failed`. This does not retry uncertain requests. The SQLite checkpoint must be reviewed by an operator before any uncertain request is deliberately reset. No automatic provider retries are enabled.

The default conservative estimated release budget is 500,000 tokens, configurable with `PREDICTION_MAX_TOKENS`. Estimation is a byte-based guard, not provider tokenization or a guaranteed bill cap. Reservations persist after failures. A release can stay partial if the budget is insufficient. There is also a 20-new-fixture limit per worker invocation. The pinned model is jev-1.13.0, with 60-second requests and SDK retries disabled.

## Numerical and qualitative evidence

The server loads the same local FPL, analytics and enrichment snapshots used by the site. It compacts each fixture to two squads, labelled Elo, six prior team matches and six safely name/team-linked player appearances. Understat club-code aliases are normalized. No fantasy form, price, ownership or xPts is sent.

The first automatic qualitative source is a bounded official Premier League feed, fetched once for a due release, not per player/fixture. It supplies **headlines only**, explicitly labelled as such, not full-article summaries or invented manager quotes. Relevant team/player mentions are linked conservatively; short player names can still be ambiguous and should be reviewed. Headlines expire after seven days. Feed failure falls back to unexpired saved reporting; it does not stop numerical predictions.

Use the ignored `prediction-evidence.json` to add real article excerpts, manager comments or your observations. The worker reads its `observations` array. `prediction-evidence.example.json` documents the shape but is never loaded. Each item needs id, source, publishedAt, expiresAt, teams, kind (`reported`, `confirmed`, `opinion`) and text (maximum 1,500 characters); HTTPS source URL and player IDs are optional. Only relevant, pre-prediction, unexpired items are included, deduplicated by text, up to 12 per fixture. Keep contradictory reports separately. News is evidence, not instructions; opinions are not confirmed facts. The website lists evidence **supplied**, not purported causal explanations from Jev.

No AI article summarizer is used. Automatic full-article/club press-conference ingestion and a curated wider source list remain future extensions after evaluating this baseline. Treat news additions as experimental: compare numbers-only versus numbers-plus-news on held-out outcomes before claiming improvement.

## Model judgments

Two Score questions describe each team's goal count from no goals through nine or more. Display each team's maximum-probability level, weighted mean, complete distribution and concentration. The mean caps the tail at nine. Separate modes do not establish the most-likely joint scoreline. Two Noul questions per eligible outfield player estimate unconditional probabilities of at least one goal / conventional football assist. Injured, suspended and unavailable candidates are excluded; doubtful candidates retain availability evidence. Rank each dimension separately and display four players across the fixture. These are unvalidated model estimates, not bookmaker odds; concentration is not accuracy.

Preserve pre-kickoff predictions for evaluation against observed goals/assists. Future cloud storage can implement the same release/checkpoint/cache interface in Supabase; the current SQLite workflow is local only.
