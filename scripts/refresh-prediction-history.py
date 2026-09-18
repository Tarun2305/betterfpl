"""Private multi-season modelling dataset. IDs retained; missing measurements null."""
from __future__ import annotations
import json, math, os
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
import soccerdata as sd
from soccerdata.understat import SHOT_SITUATIONS
# soccerdata 1.9.1 omits this provider enum; otherwise penalties become null.
SHOT_SITUATIONS.setdefault('Penalty','Penalty')

ROOT=Path(__file__).resolve().parent.parent
OUTPUT=ROOT/'work'/'prediction-engine'/'history.json'
CACHE=ROOT/'data'/'soccerdata'/'prediction-history'
YEAR=datetime.now(timezone.utc).year-(datetime.now(timezone.utc).month<7)

def num(v):
    try:
        x=float(v)
        return x if math.isfinite(x) else None
    except (TypeError,ValueError): return None

def identity(v):
    x=num(v)
    return int(x) if x is not None else None

def load_season(year):
    cache=CACHE/f'{year}.json'
    if year<YEAR and cache.exists():
        saved=json.loads(cache.read_text(encoding='utf8'))
        if saved.get('schemaVersion')==2 and len(saved.get('matches',[]))>=300 and saved.get('playerMatches'): return saved
    source=sd.Understat(leagues='ENG-Premier League',seasons=year,data_dir=ROOT/'data'/'soccerdata'/'Understat')
    matches=[]
    for _,r in source.read_team_match_stats(force_cache=year<YEAR).reset_index().iterrows():
        if num(r.get('home_goals')) is None or num(r.get('away_goals')) is None: continue
        date=pd.Timestamp(r['date'])
        date=date.tz_localize('UTC') if date.tzinfo is None else date.tz_convert('UTC')
        if date>=pd.Timestamp.now(tz='UTC'): continue
        matches.append(dict(id=identity(r['game_id']),date=date.isoformat(),homeTeam=str(r['home_team']),awayTeam=str(r['away_team']),homeCode=str(r['home_team_code']),awayCode=str(r['away_team_code']),homeGoals=int(r['home_goals']),awayGoals=int(r['away_goals']),homeXg=num(r.get('home_xg')),awayXg=num(r.get('away_xg')),homeNpxg=num(r.get('home_np_xg')),awayNpxg=num(r.get('away_np_xg')),season=f'{year}/{str(year+1)[-2:]}'))
    players=[];ids={m['id'] for m in matches}
    for _,r in source.read_player_match_stats().reset_index().iterrows():
        if identity(r.get('game_id')) not in ids or num(r.get('minutes')) is None: continue
        players.append(dict(matchId=identity(r['game_id']),playerId=identity(r.get('player_id')),teamId=identity(r.get('team_id')),player=str(r['player']),team=str(r['team']),position=str(r.get('position','Sub')),minutes=int(r['minutes']),goals=int(num(r.get('goals')) or 0),assists=int(num(r.get('assists')) or 0),xg=num(r.get('xg')),xa=num(r.get('xa')),shots=num(r.get('shots')),keyPasses=num(r.get('key_passes')),redCards=identity(r.get('red_cards')) or 0))
    penalties={}
    for _,r in source.read_shot_events().reset_index().iterrows():
        if str(r.get('situation','')).lower()=='penalty':
            key=(identity(r.get('game_id')),identity(r.get('player_id')))
            total,count=penalties.get(key,(0,0));penalties[key]=(total+(num(r.get('xg')) or 0),count+1)
    for p in players:
        pxg,count=penalties.get((p['matchId'],p['playerId']),(0,0))
        p['npxg']=max(0,p['xg']-pxg) if p['xg'] is not None else None;p['penalties']=count
    # DNP only within an observed club spell, not before joining or after leaving.
    by_match={m['id']:m for m in matches};spells={}
    for p in players: spells.setdefault((p['playerId'],p['team']),[]).append(p)
    for (pid,team),rows in spells.items():
        if pid is None: continue
        observed={r['matchId'] for r in rows};dates=sorted(by_match[r['matchId']]['date'] for r in rows)
        for m in matches:
            if m['id'] not in observed and team in [m['homeTeam'],m['awayTeam']] and dates[0]<m['date']<dates[-1]:
                players.append(dict(rows[0],matchId=m['id'],position='DNP',minutes=0,goals=0,assists=0,xg=0,xa=0,npxg=0,shots=0,keyPasses=0,penalties=0,redCards=0))
    result={'schemaVersion':2,'matches':matches,'playerMatches':players}
    CACHE.mkdir(parents=True,exist_ok=True)
    temporary=cache.with_suffix('.tmp');temporary.write_text(json.dumps(result,separators=(',',':')),encoding='utf8');os.replace(temporary,cache)
    return result

def main():
    matches=[];players=[];warnings=[];seasons=[]
    for year in range(YEAR-2,YEAR+1):
        try:
            rows=load_season(year);matches.extend(rows['matches']);players.extend(rows['playerMatches']);seasons.append(f'{year}/{str(year+1)[-2:]}')
            print(f'History {year}: {len(rows["matches"])} matches, {len(rows["playerMatches"])} player rows.',flush=True)
        except Exception as error:
            warnings.append(f'Season {year} unavailable: {type(error).__name__}');print(warnings[-1],flush=True)
    if f'{YEAR}/{str(YEAR+1)[-2:]}' not in seasons: raise RuntimeError('Current-season history refresh failed; refusing stale forecasts.')
    if len(matches)<200: raise RuntimeError('At least 200 historical matches required; refusing an untrained production forecast.')
    payload=dict(matches=matches,playerMatches=players,seasons=seasons,warnings=warnings,fetchedAt=datetime.now(timezone.utc).isoformat())
    OUTPUT.parent.mkdir(parents=True,exist_ok=True);temporary=OUTPUT.with_suffix('.tmp');temporary.write_text(json.dumps(payload,separators=(',',':')),encoding='utf8');os.replace(temporary,OUTPUT)

if __name__=='__main__': main()
