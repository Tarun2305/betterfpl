from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import soccerdata as sd


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "public" / "analytics-data.json"
CACHE = ROOT / "data" / "soccerdata" / "Understat"
SEASON = datetime.now().year if datetime.now().month >= 7 else datetime.now().year - 1


def clean(value, default=0):
    if value is None or pd.isna(value):
        return default
    if hasattr(value, "item"):
        value = value.item()
    return value


def number(value) -> float:
    value = clean(value, 0)
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else 0
    except (TypeError, ValueError):
        return 0


def text(value, default="") -> str:
    return str(clean(value, default))


try:
    source = sd.Understat(
        leagues="ENG-Premier League",
        seasons=SEASON,
        data_dir=CACHE,
    )
    team_frame = source.read_team_match_stats(force_cache=False).reset_index()
    player_frame = source.read_player_match_stats().reset_index()
    shot_frame = source.read_shot_events().reset_index()

    matches = []
    for _, row in team_frame.iterrows():
        matches.append(
            {
                "id": int(clean(row.get("game_id"), 0)),
                "date": pd.Timestamp(row.get("date")).isoformat(),
                "homeTeam": text(row.get("home_team")),
                "awayTeam": text(row.get("away_team")),
                "homeCode": text(row.get("home_team_code")),
                "awayCode": text(row.get("away_team_code")),
                "homeGoals": int(number(row.get("home_goals"))),
                "awayGoals": int(number(row.get("away_goals"))),
                "homeXg": number(row.get("home_xg")),
                "awayXg": number(row.get("away_xg")),
                "homeNpxg": number(row.get("home_np_xg")),
                "awayNpxg": number(row.get("away_np_xg")),
                "homePpda": number(row.get("home_ppda")),
                "awayPpda": number(row.get("away_ppda")),
                "homeDeep": int(number(row.get("home_deep_completions"))),
                "awayDeep": int(number(row.get("away_deep_completions"))),
                "homeXpts": number(row.get("home_expected_points")),
                "awayXpts": number(row.get("away_expected_points")),
            }
        )

    player_matches = []
    for _, row in player_frame.iterrows():
        player_matches.append(
            {
                "matchId": int(clean(row.get("game_id"), 0)),
                "team": text(row.get("team")),
                "player": text(row.get("player")),
                "position": text(row.get("position"), "Sub"),
                "minutes": int(number(row.get("minutes"))),
                "goals": int(number(row.get("goals"))),
                "assists": int(number(row.get("assists"))),
                "shots": int(number(row.get("shots"))),
                "xg": number(row.get("xg")),
                "xa": number(row.get("xa")),
                "keyPasses": int(number(row.get("key_passes"))),
                "xgChain": number(row.get("xg_chain")),
                "xgBuildup": number(row.get("xg_buildup")),
            }
        )

    shots = []
    for _, row in shot_frame.iterrows():
        shots.append(
            {
                "id": int(clean(row.get("shot_id"), 0)),
                "matchId": int(clean(row.get("game_id"), 0)),
                "team": text(row.get("team")),
                "player": text(row.get("player")),
                "assist": text(row.get("assist_player")),
                "minute": int(number(row.get("minute"))),
                "xg": number(row.get("xg")),
                "x": number(row.get("location_x")),
                "y": number(row.get("location_y")),
                "bodyPart": text(row.get("body_part")),
                "situation": text(row.get("situation")),
                "result": text(row.get("result")),
            }
        )

    payload = {
        "matches": matches,
        "playerMatches": player_matches,
        "shots": shots,
        "season": f"{SEASON}/{str(SEASON + 1)[-2:]}",
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Understat via soccerdata 1.9.1",
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, OUTPUT)
    print(
        f"Analytics updated: {len(matches)} matches, "
        f"{len(shots)} shots, {len(player_matches)} player-match rows."
    )
except Exception as error:
    print(f"Could not refresh analytics. The last cache will be kept. {error}")
