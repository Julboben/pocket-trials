export const terrainMaterials = {
  grass: {
    fill: '#c5b496', layers: ['#d3c2a2', '#b7a687'], detail: '#ac9c806e',
    edge: '#375d4d', surface: '#6f8b59', vegetation: '#628455',
    spray: ['#6f8b59','#9c8b68','#c5b496']
  },
  dirt: {
    fill: '#ad825e', layers: ['#c69a70', '#906b50'], detail: '#76543f66',
    edge: '#654735', surface: '#9c714f', vegetation: null,
    spray: ['#886044','#ad825e','#d0a47b']
  },
  rock: {
    fill: '#727a78', layers: ['#89918d', '#606866'], detail: '#4d565466',
    edge: '#3f4d4b', surface: '#9aa49e', vegetation: null,
    spray: ['#626b69','#858e8a','#aeb5ad']
  },
  snow: {
    fill: '#aebbc0', layers: ['#cbd5d6', '#929fa5'], detail: '#74838a55',
    edge: '#687a7e', surface: '#eef3ed', vegetation: null,
    spray: ['#d8e2df','#edf2eb','#aebcc0']
  },
  brick: {
    fill: '#8d493d', layers: ['#a65a49', '#71392f'], detail: '#492b29aa',
    edge: '#433534', surface: '#74a35a', vegetation: null,
    spray: ['#754239','#9a5748','#bd7961']
  }
};

export const levels = [
  {
    name: 'The Orchard', label: 'THE ORCHARD / 01', goal: 2380, terrain: 'grass',
    description: 'Learn the rhythm: build speed on gentle rollers, lean forward on climbs, and settle the bike before each landing.',
    points: [[0,320],[180,320],[320,292],[455,322],[610,276],[760,320],[920,300],[1060,257],[1215,323],[1375,286],[1515,321],[1665,267],[1815,318],[1960,294],[2110,326],[2245,304],[2490,304]],
    apples: [300,760,1050,1645,2190],
    props: [{x:215,type:'fence',layer:'back'},{x:520,type:'tree',layer:'back'},{x:825,type:'flowers',layer:'front'},{x:1180,type:'stump',layer:'front'},{x:1450,type:'fence',layer:'back'},{x:1900,type:'tree',layer:'back'},{x:2250,type:'flowers',layer:'front'}],
    weather: { sun: 1, clouds: .15 },
    sky: '#eae9d9', sun: '#f2c082', mountain: '#b7c8b1', spray: ['#6f8b59','#9c8b68','#c5b496']
  },
  {
    name: 'Rolling Country', label: 'ROLLING COUNTRY / 02', goal: 2820, terrain: 'dirt',
    description: 'Momentum is your friend. Carry speed through valleys, ease over crests, and lean forward when the front wheel gets light.',
    points: [[0,320],[170,320],[320,272],[455,336],[610,244],[765,326],[920,278],[1060,337],[1225,235],[1390,324],[1545,267],[1690,330],[1845,249],[2005,337],[2160,286],[2300,235],[2460,326],[2620,273],[2760,318],[2960,318]],
    apples: [315,910,1390,2050,2610],
    props: [{x:230,type:'rock',layer:'front'},{x:505,type:'fence',layer:'back'},{x:825,type:'tree',layer:'back'},{x:1115,type:'flowers',layer:'front'},{x:1480,type:'stump',layer:'front'},{x:1940,type:'fence',layer:'back'},{x:2370,type:'tree',layer:'back'},{x:2690,type:'rock',layer:'front'}],
    weather: { sun: .75, clouds: .65 },
    sky: '#eae9d9', sun: '#efd69b', mountain: '#b7c8b1', spray: ['#9a805c','#b99d72','#d0b78d']
  },
  {
    name: 'High Hopes', label: 'HIGH HOPES / 03', goal: 3260, terrain: 'rock',
    description: 'Steeper faces create wheelies and bigger airtime. Shift your weight early, then use small lean inputs to match the landing slope.',
    points: [[0,320],[170,320],[325,255],[465,340],[635,210],[795,332],[950,258],[1090,328],[1270,190],[1450,329],[1600,242],[1760,324],[1905,278],[2045,334],[2220,205],[2390,329],[2545,250],[2690,342],[2860,218],[3020,324],[3170,275],[3370,310]],
    apples: [315,790,1260,2210,3000],
    props: [{x:245,type:'fence',layer:'back'},{x:535,type:'rock',layer:'front'},{x:875,type:'tree',layer:'back'},{x:1360,type:'flowers',layer:'front'},{x:1700,type:'stump',layer:'front'},{x:2110,type:'rock',layer:'front'},{x:2475,type:'fence',layer:'back'},{x:2930,type:'tree',layer:'back'}],
    weather: { sun: .35, clouds: .78, rain: .28 },
    sky: '#eae9d9', sun: '#f1bb92', mountain: '#b7c8b1', spray: ['#6f7773','#929994','#b8b9aa']
  },
  {
    name: 'Skybound', label: 'SKYBOUND / 04', goal: 3020, terrain: 'grass',
    description: 'Commit to the jumps. Build speed before each lip, stay calm in the air, and line both wheels up with the far-side slope.',
    points: [[0,320],[180,320],[350,286],[500,322],[660,270],[800,315],[950,245],[1045,292],[1210,258],[1370,292],[1510,292],[1650,332],[1810,264],[1950,318],[2090,230],[2225,301],[2380,267],[2520,324],[2680,242],[2825,307],[2960,280],[3150,280]],
    gaps: [[950,1045],[1510,1650]], island: [1045,1510], fallY: 560,
    apples: [345,790,1210,2080,2670],
    weather: { sun: .82, clouds: .24 },
    props: [{x:230,type:'fence',layer:'back'},{x:590,type:'flowers',layer:'front'},{x:860,type:'rock',layer:'front'},{x:1140,type:'crystal',layer:'back'},{x:1415,type:'tree',layer:'back'},{x:1880,type:'fence',layer:'back'},{x:2290,type:'crystal',layer:'back'},{x:2760,type:'rock',layer:'front'}],
    sky: '#eae9d9', sun: '#f6d48d', mountain: '#b7c8b1', spray: ['#8d806b','#b4a58a','#d2c3a2']
  },
  {
    name: 'Brake Point', label: 'BRAKE POINT / 05', goal: 3220, terrain: 'brick',
    description: 'Speed alone will not solve this trail. Brake before steep drops, lean back to resist stoppies, and accelerate cleanly out of bowls.',
    points: [[0,320],[180,320],[340,276],[500,318],[640,220],[770,350],[930,350],[1080,254],[1210,345],[1370,300],[1510,188],[1640,352],[1810,325],[1960,246],[2100,342],[2260,285],[2390,202],[2530,350],[2690,314],[2830,238],[2970,335],[3110,292],[3340,292]],
    apples: [330,910,1500,2245,2960],
    props: [{x:250,type:'rock',layer:'front'},{x:555,type:'fence',layer:'back'},{x:1010,type:'tree',layer:'back'},{x:1310,type:'stump',layer:'front'},{x:1740,type:'flowers',layer:'front'},{x:2180,type:'rock',layer:'front'},{x:2600,type:'fence',layer:'back'},{x:3040,type:'tree',layer:'back'}],
    weather: { sun: .82, clouds: .24 },
    sky: '#e6e5d7', sun: '#e9aa78', mountain: '#aebdb0', spray: ['#846d55','#aa8b68','#c8aa82']
  },
  {
    name: 'Long Way Up', label: 'LONG WAY UP / 06', goal: 3650, terrain: 'snow',
    description: 'Link everything together across a long climb: preserve momentum, control wheelies, and recover your balance without losing speed.',
    points: [[0,320],[175,320],[330,284],[470,332],[630,238],[790,330],[940,270],[1080,215],[1220,334],[1380,290],[1525,200],[1670,326],[1810,256],[1960,178],[2110,335],[2260,278],[2400,224],[2540,340],[2700,294],[2840,190],[2990,326],[3140,247],[3280,205],[3420,320],[3570,272],[3770,272]],
    apples: [325,1070,1950,2830,3410],
    props: [{x:240,type:'fence',layer:'back'},{x:560,type:'tree',layer:'back'},{x:875,type:'rock',layer:'front'},{x:1290,type:'flowers',layer:'front'},{x:1730,type:'stump',layer:'front'},{x:2180,type:'fence',layer:'back'},{x:2615,type:'tree',layer:'back'},{x:3060,type:'rock',layer:'front'},{x:3480,type:'flowers',layer:'front'}],
    weather: { sun: .7, clouds: .35 },
    sky: '#e4e7dc', sun: '#edc486', mountain: '#a9b9ad', spray: ['#717b65','#929477','#b7ae8c']
  },
  {
    name: 'Elastic Summit', label: 'ELASTIC SUMMIT / 07', goal: 4080, terrain: 'rock',
    description: 'The final exam: rolling speed, precise braking, steep climbs, controlled airtime, and enough patience to finish in one piece.',
    points: [[0,320],[180,320],[335,268],[475,338],[645,228],[795,326],[950,282],[1090,195],[1235,342],[1390,260],[1530,314],[1690,184],[1840,335],[1990,246],[2130,325],[2290,205],[2440,346],[2590,275],[2740,218],[2890,330],[3040,252],[3180,176],[3330,340],[3480,286],[3620,212],[3760,326],[3910,262],[4200,262]],
    gaps: [[1530,1690],[2740,2890]], fallY: 570,
    platforms: [
      { points: [[1120,90],[1260,58],[1430,84]], thickness: 52, material: 'brick' },
      { points: [[2050,190],[2200,158],[2370,190]], thickness: 58, material: 'grass' },
      { points: [[3070,160],[3220,130],[3390,174]], thickness: 54, material: 'snow' }
    ],
    apples: [330,1080,2280,3170,3750],
    props: [{x:235,type:'fence',layer:'back'},{x:565,type:'rock',layer:'front'},{x:885,type:'tree',layer:'back'},{x:1290,type:'flowers',layer:'front'},{x:1770,type:'crystal',layer:'back'},{x:2200,type:'stump',layer:'front'},{x:2505,type:'fence',layer:'back'},{x:2960,type:'crystal',layer:'back'},{x:3400,type:'tree',layer:'back'},{x:3830,type:'rock',layer:'front'}],
    weather: { sun: .06, clouds: 1, rain: .72, lightning: .65 },
    sky: '#e5e2d6', sun: '#efa56f', mountain: '#a9b5aa', spray: ['#6d6c62','#928675','#b9a68c']
  }
];
