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

## Two forecast methods

The website defaults to **Statistical model** and offers **Jev forecast** beside it. Both are saved by the same release, from the same evidence snapshot. Switching views never calls a model. Legacy releases retain their Jev result; their statistical view waits for the next eligible publisher run.

The `dual-v1` release namespace permits an existing legacy release to receive both methods once during rollout, only while the gameweek remains eligible. Subsequent reruns are held by the same atomic claims. The hourly check and two release windows are unchanged. Refreshing historical data can take several minutes on the first run; if kickoff passes during refresh, the publisher stops before calling Jev. Started gameweeks are never reopened.

## Historical model and inputs

`scripts/refresh-prediction-history.py` collects the current and two prior Premier League seasons from Understat through soccerdata. The combined private file is `work/prediction-engine/history.json`; season and provider caches live in `data/soccerdata`. The workflow caches that directory between runs. The archive is not committed or shipped to the browser. Production requires at least 200 completed matches and a successful current-season refresh. Missing seasons are disclosed. An offline run on 18 September 2026 contained 800 matches and 32,789 player-match rows, including inferred non-appearances within observed club spells.

The fitted model uses time-decayed, regularized team attack/defence, home advantage and a Dixon�Coles low-score correction. A chronological 65/17/18 split selects decay, xG blending and the correction on the middle segment, then evaluates on the final segment; matches sharing a timestamp remain together. The production fit then uses all completed matches. The independent league baseline uses only pre-test home/away goal means. The 144-match holdout produced joint log loss 2.894 versus 2.942 for the baseline: promising, but a single holdout is not proof of a sustained accuracy gain.

Player minutes use fitted start/appearance models, recent starts and non-appearances, shrunk starter minutes, and current FPL availability. Goal/assist rates shrink toward historical positional priors. Team goal expectations are allocated through those rates, minutes and penalty shares; probabilities mix starter/substitute scenarios. Conventional assists are distinguished from fantasy assists. News interpreted by Jev adjusts availability, bench, minutes restrictions and penalty-taker scenarios. **News currently changes player forecasts, not historical team attack/defence rates.** Player and news effects remain experimental until prospective results support calibration.

Identity joins use explicit aliases, transliteration, team matches and retained provider IDs across transfers. Ambiguous joins fall back to labelled priors rather than guessing. Missing measurements remain null, overlapping season/recent statistics are labelled, and synthetic Local Elo is excluded. Full player names, estimated minutes, recent history, team xG and evidence coverage are supplied to Jev; fantasy price, ownership and xPts are omitted. Newly promoted teams and players without history have weaker estimates.

## Qualitative evidence

Each due release independently checks BBC Sport, The Guardian, Sky Sports, ESPN, The Independent, Evening Standard and the existing Premier League official-headline feed. Feed excerpts and a bounded set of relevant article paragraphs supplement headlines, with source URLs and publication dates. No paywall bypass or generated article summaries are used. Fetch sizes, timeouts and concurrency are bounded. Failed sources are disclosed; unexpired saved reporting remains usable.

Commercial, historical, youth and women's-football stories are filtered. Speaker names are not automatically linked as players. Evidence is deduplicated and limited to 16 items per fixture and five per source, prioritizing relevant reporting. External-feed items expire after three days; official headlines after seven. Absence of a report, speculation and opinions do not establish facts. Headlines and excerpts remain explicitly labelled, and the website exposes evidence supplied rather than claiming it caused a particular prediction.

The ignored local `prediction-evidence.json` can add attributed observations (see `prediction-evidence.example.json`). Production does not ingest that file. No paid news/odds subscription or new secret is required. Betting-market and confirmed-lineup feeds are not included; obtaining confirmed lineups would also require a later release than the retained 12-hour schedule.

## Jev request and outputs

One pinned `jev-1.13.0` request per fixture produces direct forecasts plus semantic news judgments for the statistical path. Two Score questions model team goals from zero through nine or more. Eligible outfield players receive goal and conventional-assist Noul questions. Common definitions avoid repeated instructions. The measured ten-fixture release fits the existing 500,000-token conservative estimate; actual provider usage is stored separately.

Response validation checks distributions and probabilities, recomputes means/concentration, and rejects malformed semantic answers. Direct Jev player probabilities are explicitly projected down to appearance and team-goal bounds. Raw answers remain private for audit. This is consistency enforcement, not calibration. The statistical view displays a joint scoreline and home/draw/away probabilities; Jev displays separate team modes without pretending they form a joint forecast. A nine-plus tail means the displayed mean is capped.

## Evaluation and validation

`npm run test:predictions` runs offline pipeline/model tests. `npm run predictions:evaluate` scores archived pre-kickoff forecasts against the local historical archive without buying retrospective predictions. Cloud releases upload the available evaluation to `predictions/evaluation.json` and the fitted artifact to `predictions/private/models/<release>.json`.

Evaluation separates release stages and engine versions, reports team log loss/ranked probability score and player Brier/log loss with reliability bins, and excludes unlinked player outcomes. It must accumulate real future predictions before calibrating player/news probabilities or claiming improvement over direct Jev. The full production publishing action is operator-run; offline tests and a successful build cannot verify live provider or Supabase permissions.
