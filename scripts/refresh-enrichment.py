from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "public" / "enrichment-data.json"
DATA_ROOT = ROOT / "data" / "soccerdata"
WHOSCORED_CACHE = DATA_ROOT / "WhoScored"
CLUBELO_CACHE = DATA_ROOT / "ClubElo"
SEASON = datetime.now().year if datetime.now().month >= 7 else datetime.now().year - 1
os.environ.setdefault("SOCCERDATA_DIR", str(DATA_ROOT))

import pandas as pd
import soccerdata as sd

TEAM_CODES = {
    "Arsenal": "ARS", "Aston Villa": "AVL", "Bournemouth": "BOU",
    "Brentford": "BRE", "Brighton": "BHA", "Brighton & Hove Albion": "BHA",
    "Chelsea": "CHE", "Coventry": "COV", "Coventry City": "COV",
    "Crystal Palace": "CRY", "Everton": "EVE", "Fulham": "FUL",
    "Hull": "HUL", "Hull City": "HUL", "Ipswich": "IPS", "Ipswich Town": "IPS",
    "Leeds": "LEE", "Leeds United": "LEE", "Liverpool": "LIV",
    "Manchester City": "MCI", "Man City": "MCI", "Manchester United": "MUN",
    "Man Utd": "MUN", "Newcastle": "NEW", "Newcastle United": "NEW",
    "Nottingham Forest": "NFO", "Nott'm Forest": "NFO", "Tottenham": "TOT",
    "Tottenham Hotspur": "TOT", "Spurs": "TOT", "Sunderland": "SUN",
}


def read_previous():
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except Exception:
        return {
            "whoScoredPlayers": [], "clubElo": [], "fetchedAt": "",
            "whoScoredFetchedAt": None, "clubEloFetchedAt": None,
        }


def finite_number(value, default=0):
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def successful(series: pd.Series) -> pd.Series:
    return series.fillna("").astype(str).str.lower().eq("successful")


def refresh_whoscored():
    source = sd.WhoScored(
        leagues="ENG-Premier League",
        seasons=SEASON,
        data_dir=WHOSCORED_CACHE,
        headless=True,
    )
    schedule = source.read_schedule(force_cache=True).reset_index()
    now = pd.Timestamp.now(tz="UTC")
    dates = pd.to_datetime(schedule.get("date"), utc=True, errors="coerce")
    completed = schedule[dates.le(now) & schedule.get("home_score").notna()]
    match_ids = [int(value) for value in completed.get("game_id", []).tolist()]
    if not match_ids:
        return []

    season_code = f"{str(SEASON)[-2:]}{str(SEASON + 1)[-2:]}"
    event_dir = WHOSCORED_CACHE / "events" / f"ENG-Premier League_{season_code}"
    cached_ids = {int(path.stem) for path in event_dir.glob("*.json") if path.stem.isdigit()}
    uncached_ids = [match_id for match_id in match_ids if match_id not in cached_ids]
    new_limit = max(1, int(os.environ.get("BETTERFPL_WHOSCORED_NEW_MATCHES", "3")))
    match_ids = [match_id for match_id in match_ids if match_id in cached_ids] + uncached_ids[-new_limit:]

    events = source.read_events(match_id=match_ids, force_cache=True, output_fmt="events", on_error="skip")
    if events is None or events.empty:
        return []
    events = events.reset_index()
    events = events[events.get("player").notna() & events.get("team").notna()].copy()
    events["type_key"] = events.get("type", "").fillna("").astype(str).str.lower()
    events["success"] = successful(events.get("outcome_type", pd.Series(index=events.index, dtype=str)))
    events["touch"] = events.get("is_touch", False).fillna(False).astype(bool)

    output = []
    for (team, player), rows in events.groupby(["team", "player"], sort=True):
        event_type = rows["type_key"]
        is_success = rows["success"]
        passes = event_type.eq("pass")
        output.append({
            "player": str(player),
            "team": str(team),
            "teamCode": TEAM_CODES.get(str(team), ""),
            "matches": int(rows.get("game_id").nunique()),
            "passesAttempted": int(passes.sum()),
            "passesCompleted": int((passes & is_success).sum()),
            "touches": int(rows["touch"].sum()),
            "tacklesWon": int((event_type.eq("tackle") & is_success).sum()),
            "interceptions": int(event_type.eq("interception").sum()),
            "takeOnsWon": int((event_type.isin(["takeon", "take on"]) & is_success).sum()),
            "aerialsWon": int((event_type.eq("aerial") & is_success).sum()),
            "clearances": int(event_type.eq("clearance").sum()),
            "dispossessed": int(event_type.eq("dispossessed").sum()),
        })
    return output


def refresh_clubelo():
    source = sd.ClubElo(data_dir=CLUBELO_CACHE)
    frame = source.read_by_date().reset_index()
    now = datetime.now(timezone.utc).date().isoformat()
    output = []
    for _, row in frame.iterrows():
        team = str(row.get("team", ""))
        code = TEAM_CODES.get(team)
        if not code:
            continue
        rank_value = finite_number(row.get("rank"), math.nan)
        output.append({
            "team": team,
            "teamCode": code,
            "elo": round(finite_number(row.get("elo")), 2),
            "rank": int(rank_value) if math.isfinite(rank_value) else None,
            "date": now,
            "source": "ClubElo",
        })
    return output


def refresh_local_elo():
    """Build a useful rating table when ClubElo's public endpoint is unavailable."""
    analytics_path = ROOT / "public" / "analytics-data.json"
    analytics = json.loads(analytics_path.read_text(encoding="utf-8"))
    matches = sorted(analytics.get("matches", []), key=lambda match: match.get("date", ""))
    ratings: dict[str, float] = {}
    names: dict[str, str] = {}

    for match in matches:
        home_name = str(match.get("homeTeam", ""))
        away_name = str(match.get("awayTeam", ""))
        home_code = TEAM_CODES.get(home_name)
        away_code = TEAM_CODES.get(away_name)
        if not home_code or not away_code:
            continue

        names[home_code] = home_name
        names[away_code] = away_name
        home_rating = ratings.setdefault(home_code, 1500.0)
        away_rating = ratings.setdefault(away_code, 1500.0)
        expected_home = 1 / (1 + 10 ** ((away_rating - (home_rating + 60)) / 400))
        home_goals = finite_number(match.get("homeGoals"))
        away_goals = finite_number(match.get("awayGoals"))
        actual_home = 1.0 if home_goals > away_goals else 0.5 if home_goals == away_goals else 0.0
        change = 30 * (actual_home - expected_home)
        ratings[home_code] = home_rating + change
        ratings[away_code] = away_rating - change

    today = datetime.now(timezone.utc).date().isoformat()
    ranked = sorted(ratings.items(), key=lambda item: item[1], reverse=True)
    return [{
        "team": names[code],
        "teamCode": code,
        "elo": round(elo, 2),
        "rank": rank,
        "date": today,
        "source": "Local Elo",
    } for rank, (code, elo) in enumerate(ranked, start=1)]


payload = read_previous()
now_iso = datetime.now(timezone.utc).isoformat()

if os.environ.get("BETTERFPL_SKIP_WHOSCORED") != "1":
    try:
        who_scored = refresh_whoscored()
        if who_scored:
            payload["whoScoredPlayers"] = who_scored
            payload["whoScoredFetchedAt"] = now_iso
            print(f"WhoScored updated: {len(who_scored)} player summaries.")
    except Exception as error:
        print(f"WhoScored unavailable; keeping the last cache. {error}")

try:
    club_elo = refresh_clubelo()
    if club_elo:
        payload["clubElo"] = club_elo
        payload["clubEloFetchedAt"] = now_iso
        print(f"ClubElo updated: {len(club_elo)} club ratings.")
except Exception as error:
    print(f"ClubElo unavailable; using the local results-based fallback. {error}")
    local_elo = refresh_local_elo()
    if local_elo:
        payload["clubElo"] = local_elo
        payload["clubEloFetchedAt"] = now_iso
        print(f"Local Elo updated: {len(local_elo)} club ratings.")

payload["fetchedAt"] = now_iso
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
temporary = OUTPUT.with_suffix(".json.tmp")
temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
os.replace(temporary, OUTPUT)
