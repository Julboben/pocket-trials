export const levels = [
  {
    name: 'The orchard', label: 'THE ORCHARD / 01', goal: 1280,
    points: [[0,320],[175,320],[300,288],[430,320],[590,267],[720,319],[850,296],[985,250],[1130,318],[1420,318]],
    apples: [245,535,790,970,1170],
    props: [{x:195,type:'fence',layer:'back'},{x:390,type:'tree',layer:'back'},{x:680,type:'flowers',layer:'front'},{x:895,type:'stump',layer:'front'},{x:1090,type:'fence',layer:'back'}],
    sky: '#eae9d9', sun: '#f2c082', mountain: '#b7c8b1', spray: ['#6f8b59','#9c8b68','#c5b496']
  },
  {
    name: 'Rolling country', label: 'ROLLING COUNTRY / 02', goal: 1610,
    points: [[0,320],[160,320],[290,266],[415,334],[565,244],[710,323],[855,270],[995,334],[1150,229],[1300,322],[1450,270],[1600,320],[1770,320]],
    apples: [265,555,850,1140,1470],
    props: [{x:210,type:'rock',layer:'front'},{x:465,type:'fence',layer:'back'},{x:760,type:'tree',layer:'back'},{x:1055,type:'flowers',layer:'front'},{x:1370,type:'stump',layer:'front'}],
    sky: '#eae9d9', sun: '#efd69b', mountain: '#b7c8b1', spray: ['#9a805c','#b99d72','#d0b78d']
  },
  {
    name: 'High hopes', label: 'HIGH HOPES / 03', goal: 1950,
    points: [[0,320],[155,320],[310,251],[440,337],[610,216],[765,330],[915,256],[1040,325],[1220,195],[1400,326],[1540,247],[1695,320],[1810,276],[1920,319],[2130,319]],
    apples: [300,595,910,1210,1785],
    props: [{x:235,type:'fence',layer:'back'},{x:510,type:'rock',layer:'front'},{x:810,type:'tree',layer:'back'},{x:1325,type:'flowers',layer:'front'},{x:1660,type:'stump',layer:'front'}],
    sky: '#eae9d9', sun: '#f1bb92', mountain: '#b7c8b1', spray: ['#6f7773','#929994','#b8b9aa']
  },
  {
    name: 'Skybound', label: 'SKYBOUND / 04', goal: 1260,
    points: [[0,320],[170,320],[330,292],[440,320],[520,320],[820,245],[945,315],[1080,255],[1210,280],[1340,280],[1450,330]],
    gaps: [[820,945],[1340,2400]], island: [945,1340], fallY: 560,
    apples: [280,520,735,1035,1190],
    props: [{x:205,type:'fence',layer:'back'},{x:580,type:'flowers',layer:'front'},{x:770,type:'rock',layer:'front'},{x:1010,type:'crystal',layer:'back'},{x:1240,type:'tree',layer:'back'}],
    sky: '#eae9d9', sun: '#f6d48d', mountain: '#b7c8b1', spray: ['#8d806b','#b4a58a','#d2c3a2']
  }
];
