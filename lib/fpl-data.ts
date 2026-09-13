export type Fixture = {
  id: number;
  event: number | null;
  kickoff: string | null;
  homeTeam: string;
  awayTeam: string;
  homeCode: string;
  awayCode: string;
  homeDifficulty: number;
  awayDifficulty: number;
};

export type Player = {
  id: number;
  name: string;
  fullName: string;
  team: string;
  teamName: string;
  position: 'GKP' | 'DEF' | 'MID' | 'FWD';
  price: number;
  points: number;
  form: number;
  selected: number;
  minutes: number;
  starts: number;
  pointsPerGame: number;
  value: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  bonus: number;
  bps: number;
  ict: number;
  influence: number;
  creativity: number;
  threat: number;
  xG: number;
  xA: number;
  xGI: number;
  xGC: number;
  transfersIn: number;
  transfersOut: number;
  status: string;
  chance: number | null;
  news: string;
  nextFixture: string;
  nextDifficulty: number;
};

export type Team = { id: number; code?: number; name: string; shortName: string; strength: number };

export const teamBadgeCodes: Record<string, number> = {
  ARS: 3, AVL: 7, BOU: 91, BRE: 94, BHA: 36,
  CHE: 8, COV: 9, CRY: 31, EVE: 11, FUL: 54,
  HUL: 88, IPS: 40, LEE: 2, LIV: 14, MCI: 43,
  MUN: 1, NEW: 4, NFO: 17, TOT: 6, SUN: 56,
};

export type DashboardData = {
  players: Player[];
  teams: Team[];
  fixtures: Fixture[];
  gameweek: number | null;
  fetchedAt: string;
  source: 'live' | 'sample';
  message?: string;
};

const samplePlayers: Player[] = [
  ['Mohamed Salah','LIV','Liverpool','MID',14.5,211,8.2,64.1,2419,28,7.5,14,10,12,28,690,248,785,912,15.8,10.4,26.2,21.9,182140,82540,'a',100,'','WHU (H)',2],
  ['Erling Haaland','MCI','Man City','FWD',14.1,178,7.4,52.7,2260,26,6.8,22,3,8,23,610,221,316,1090,21.2,4.8,26.0,12.2,116220,61240,'a',100,'','EVE (A)',2],
  ['Cole Palmer','CHE','Chelsea','MID',10.9,174,6.8,41.2,2387,27,6.4,14,9,8,25,644,235,910,721,13.7,10.1,23.8,20.4,139120,90710,'a',100,'','BRE (H)',2],
  ['Bukayo Saka','ARS','Arsenal','MID',10.2,159,6.1,31.8,2181,25,6.3,11,10,11,23,602,218,834,760,11.9,9.7,21.6,17.0,98120,45210,'a',100,'','NEW (A)',4],
  ['Alexander Isak','NEW','Newcastle','FWD',9.6,153,7.0,28.4,2057,24,6.4,18,4,7,21,548,201,334,903,17.8,3.3,21.1,14.8,148220,36900,'a',100,'','ARS (H)',4],
  ['Bryan Mbeumo','BRE','Brentford','MID',8.1,149,5.9,23.6,2460,28,5.3,13,7,6,20,526,192,701,691,12.2,7.3,19.5,22.8,71120,62310,'a',100,'','CHE (A)',4],
  ['Gabriel','ARS','Arsenal','DEF',6.3,132,5.2,27.1,2520,28,4.7,4,1,13,18,534,202,260,371,4.1,1.8,5.9,15.2,45220,19810,'a',100,'','NEW (A)',4],
  ['Jordan Pickford','EVE','Everton','GKP',5.1,119,4.7,14.9,2700,30,4.0,0,0,10,15,510,198,40,31,0,0,0,31.8,18200,15780,'a',100,'','MCI (H)',5],
  ['Ollie Watkins','AVL','Aston Villa','FWD',8.8,145,5.5,22.0,2310,27,5.4,14,7,7,19,520,189,452,798,14.0,5.9,19.9,23.0,42110,50660,'a',100,'','FUL (H)',2],
  ['Bruno Fernandes','MUN','Man Utd','MID',8.4,137,6.0,16.4,2498,29,4.7,9,9,6,22,559,205,1010,650,10.5,10.8,21.3,31.2,90320,38670,'a',100,'','BOU (A)',3],
  ['Antoine Semenyo','BOU','Bournemouth','MID',7.2,128,5.1,13.2,2380,28,4.6,10,5,7,17,478,176,521,733,10.8,4.6,15.4,28.4,62220,40190,'a',100,'','MUN (H)',3],
  ['Matz Sels','NFO','Nottm Forest','GKP',5.0,124,4.9,11.7,2700,30,4.1,0,0,12,16,525,201,36,28,0,0,0,27.9,30110,20100,'a',100,'','TOT (A)',4],
].map((row, index) => {
  const [name,team,teamName,position,price,points,form,selected,minutes,starts,ppg,goals,assists,cleanSheets,bonus,bps,influence,creativity,threat,xG,xA,xGI,xGC,transfersIn,transfersOut,status,chance,news,nextFixture,nextDifficulty] = row as [string,string,string,Player['position'],number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,string,number,string,string,number];
  return { id:index+1,name,fullName:name,team,teamName,position,price,points,form,selected,minutes,starts,pointsPerGame:ppg,value:Number((points/price).toFixed(1)),goals,assists,cleanSheets,bonus,bps,ict:Number(((influence+creativity+threat)/10).toFixed(1)),influence,creativity,threat,xG,xA,xGI,xGC,transfersIn,transfersOut,status,chance,news,nextFixture,nextDifficulty };
});

export const sampleData: DashboardData = {
  players: samplePlayers,
  teams: [
    {id:1,code:3,name:'Arsenal',shortName:'ARS',strength:5},{id:2,code:7,name:'Aston Villa',shortName:'AVL',strength:4},{id:3,code:91,name:'Bournemouth',shortName:'BOU',strength:3},{id:4,code:94,name:'Brentford',shortName:'BRE',strength:3},{id:5,code:8,name:'Chelsea',shortName:'CHE',strength:4},{id:6,code:11,name:'Everton',shortName:'EVE',strength:3},{id:7,code:14,name:'Liverpool',shortName:'LIV',strength:5},{id:8,code:43,name:'Man City',shortName:'MCI',strength:5},{id:9,code:1,name:'Man Utd',shortName:'MUN',strength:4},{id:10,code:4,name:'Newcastle',shortName:'NEW',strength:4},{id:11,code:17,name:'Nottm Forest',shortName:'NFO',strength:3},
  ],
  fixtures: [
    {id:1,event:31,kickoff:'2026-04-11T11:30:00Z',homeTeam:'Liverpool',awayTeam:'West Ham',homeCode:'LIV',awayCode:'WHU',homeDifficulty:2,awayDifficulty:5},
    {id:2,event:31,kickoff:'2026-04-11T14:00:00Z',homeTeam:'Chelsea',awayTeam:'Brentford',homeCode:'CHE',awayCode:'BRE',homeDifficulty:2,awayDifficulty:4},
    {id:3,event:31,kickoff:'2026-04-11T16:30:00Z',homeTeam:'Everton',awayTeam:'Man City',homeCode:'EVE',awayCode:'MCI',homeDifficulty:5,awayDifficulty:2},
    {id:4,event:31,kickoff:'2026-04-12T13:00:00Z',homeTeam:'Newcastle',awayTeam:'Arsenal',homeCode:'NEW',awayCode:'ARS',homeDifficulty:4,awayDifficulty:4},
  ],
  gameweek: 31,
  fetchedAt: '2026-09-08T00:00:00.000Z',
  source: 'sample',
  message: 'Live FPL data was unavailable, so the dashboard is using its bundled demonstration dataset.',
};
