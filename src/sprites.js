// Tiny pixel-art sprite library.
// Sprites are 16x16, encoded as strings of digits 0-9 mapped through a palette.
// '.' = transparent. Drawing is done into offscreen canvases, then cached.

const SPR = 16;

// Generic palette indices used across sprites.
// Each sprite passes its own palette mapping digits -> hex colors.
function makeSprite(rows, palette) {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  for (let y = 0; y < SPR; y++) {
    const row = rows[y];
    for (let x = 0; x < SPR; x++) {
      const ch = row[x];
      if (ch === "." || ch === " ") continue;
      const col = palette[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// ---------- Heroes (16x16, facing south) ----------
// 0 outline, 1 skin, 2 hair/cloak, 3 garment, 4 accent, 5 boots/leather

const heroBase = [
  "................",
  ".....02220......",
  "....0222220.....",
  "....0211120.....",
  "....0211120.....",
  "....0212120.....",
  "....02222220....",
  "...033333330....",
  "...034444330....",
  "...034444330....",
  "...033333330....",
  "....033 330.....",
  "....055 550.....",
  "....055 550.....",
  "....050 050.....",
  "................",
];

function heroSprite(p) {
  return makeSprite(heroBase.map(r => r.replace(/ /g, ".")), {
    "0": "#0a0a10",
    "1": p.skin,
    "2": p.hair,
    "3": p.garment,
    "4": p.accent,
    "5": p.boots,
  });
}

export const HEROES = {
  ranger: {
    name: "Aranor",
    title: "the Ranger",
    sprite: heroSprite({ skin: "#d8b48a", hair: "#3a2418", garment: "#3a4a30", accent: "#7a6440", boots: "#2a1c12" }),
    base: { hp: 36, mp: 6, atk: 9, def: 5, spd: 7, lvl: 1, xp: 0 },
    spells: [],
    classKind: "warrior",
  },
  archer: {
    name: "Lendir",
    title: "the Sindar Archer",
    sprite: heroSprite({ skin: "#e2c79a", hair: "#d8c060", garment: "#5a6a78", accent: "#a8b8c8", boots: "#3a2a18" }),
    base: { hp: 28, mp: 10, atk: 8, def: 4, spd: 9, lvl: 1, xp: 0 },
    spells: ["star_arrow"],
    classKind: "archer",
  },
  mage: {
    name: "Mithrael",
    title: "the Grey Wanderer",
    sprite: heroSprite({ skin: "#dcc8aa", hair: "#cfcfd6", garment: "#3a3a52", accent: "#9aa0d6", boots: "#1a1a26" }),
    base: { hp: 22, mp: 24, atk: 5, def: 3, spd: 6, lvl: 1, xp: 0 },
    spells: ["heal", "holy_light", "lightning"],
    classKind: "mage",
  },
  dwarf: {
    name: "Gimrek",
    title: "of Erebor",
    sprite: heroSprite({ skin: "#d6a878", hair: "#9a3a18", garment: "#4a3a2a", accent: "#a08050", boots: "#2a1810" }),
    base: { hp: 44, mp: 4, atk: 10, def: 8, spd: 4, lvl: 1, xp: 0 },
    spells: [],
    classKind: "warrior",
  },
};

// ---------- Enemies ----------

function ghostBody(palette) {
  return [
    "................",
    "................",
    "....00000000....",
    "...0111111110...",
    "..011112211110..",
    "..011112211110..",
    "..011111111110..",
    "..011111111110..",
    "..011111111110..",
    "..011111111110..",
    "..011111111110..",
    "..011111111110..",
    "..010101010100..",
    "..010001010100..",
    "..010000010000..",
    "................",
  ];
}

function shadeBody() {
  return [
    "................",
    ".....00000......",
    "....0333330.....",
    "...033333330....",
    "..03311113310...",
    "..03311113310...",
    "..03333333310...",
    "..03333333310...",
    "..03333333330...",
    "..03333333330...",
    "..03333333330...",
    "...033333330....",
    "....03333310....",
    ".....033310.....",
    "......0010......",
    "................",
  ];
}

function wolfBody() {
  return [
    "................",
    "................",
    "..00.......00...",
    ".0220......022..",
    ".02220....02220.",
    "..02222222220...",
    "..02211112220...",
    ".02224114122220.",
    ".02222222222220.",
    "..022222222220..",
    "..02220.022220..",
    "..0220...02220..",
    "..0020...0020...",
    "................",
    "................",
    "................",
  ];
}

function wightBody() {
  return [
    "................",
    "....000000......",
    "...033333300....",
    "..0333333330....",
    "..033111330.....",
    "..033111330.....",
    "..0331333330....",
    "..0333333330....",
    "..0322222230....",
    "..0322222230....",
    "..0322222230....",
    "..0332332330....",
    "..0330030330....",
    "..0440040440....",
    "...000.0000.....",
    "................",
  ];
}

function nazgulBody() {
  return [
    "................",
    ".....000000.....",
    "....0222222.0...",
    "...022222222.0..",
    "..02211221220...",
    "..02211221220...",
    "..02222222220...",
    "..02222222220...",
    "..02224422220...",
    "..02222222220...",
    "..02222222220...",
    "..02222222220...",
    "..02222222220...",
    "..02220002220...",
    "..0220...0220...",
    "..00.......00...",
  ];
}

export const ENEMIES = {
  spectre: {
    id: "spectre", name: "Pale Spectre",
    sprite: makeSprite(ghostBody().map(r => r.replace(/ /g, ".")),
      { "0": "#0a0a14", "1": "#cfd8e4", "2": "#7088aa" }),
    hp: 14, atk: 5, def: 2, spd: 6, xp: 12, gold: 4,
    weak: "holy",
  },
  shade: {
    id: "shade", name: "Hungering Shade",
    sprite: makeSprite(shadeBody().map(r => r.replace(/ /g, ".")),
      { "0": "#000", "1": "#3a1a3a", "3": "#1a1024" }),
    hp: 22, atk: 7, def: 3, spd: 4, xp: 18, gold: 6,
    weak: "holy",
  },
  warg: {
    id: "warg", name: "Phantom Warg",
    sprite: makeSprite(wolfBody().map(r => r.replace(/ /g, ".")),
      { "0": "#080808", "1": "#a83030", "2": "#503040", "4": "#e0d040" }),
    hp: 18, atk: 8, def: 2, spd: 8, xp: 16, gold: 5,
    weak: "lightning",
  },
  wight: {
    id: "wight", name: "Barrow-wight of the Vale",
    sprite: makeSprite(wightBody().map(r => r.replace(/ /g, ".")),
      { "0": "#000", "1": "#2a223a", "3": "#7a6a8a", "4": "#a09060" }),
    hp: 30, atk: 9, def: 4, spd: 5, xp: 26, gold: 10,
    weak: "holy",
  },
  nazgul: {
    id: "nazgul", name: "Wraith-Lord of the Bruinen",
    sprite: makeSprite(nazgulBody().map(r => r.replace(/ /g, ".")),
      { "0": "#000", "1": "#7a0010", "2": "#181020", "4": "#c83030" }),
    hp: 120, atk: 14, def: 6, spd: 7, xp: 200, gold: 100,
    weak: "holy", boss: true,
  },
};

// ---------- Tiles (16x16 procedural) ----------

const tileCache = {};

function tileGrass() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1a2a1c"; ctx.fillRect(0,0,SPR,SPR);
  // dotted dead grass tufts (haunted Rivendell pall)
  const speckles = [
    [2,3,"#243a26"],[5,1,"#243a26"],[9,4,"#2a3c2a"],[12,2,"#2a3c2a"],
    [14,7,"#1f2e22"],[3,9,"#243a26"],[7,11,"#2a3c2a"],[10,13,"#1f2e22"],
    [2,14,"#243a26"],[13,12,"#2a3c2a"],[6,7,"#2a3c2a"],[5,14,"#1f2e22"],
  ];
  for (const [x,y,col] of speckles) { ctx.fillStyle = col; ctx.fillRect(x,y,1,1); }
  return c;
}

function tilePath() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3a3530"; ctx.fillRect(0,0,SPR,SPR);
  // cobble pattern
  ctx.fillStyle = "#4a443c";
  for (let y=0;y<SPR;y+=4){
    for (let x=0;x<SPR;x+=4){
      const off = (y/4)%2===0 ? 0 : 2;
      ctx.fillRect(x+off,y,3,3);
    }
  }
  ctx.fillStyle = "#2a241e";
  for (let i=0;i<10;i++){
    ctx.fillRect((i*7)%SPR, (i*5)%SPR, 1,1);
  }
  return c;
}

function tileWall() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2a2a36"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#3a3a4a";
  for (let y=0;y<SPR;y+=4){
    const off = (y/4)%2===0?0:4;
    for (let x=0;x<SPR;x+=8){
      ctx.fillRect(x+off,y,7,3);
    }
  }
  ctx.fillStyle = "#161620";
  for (let y=3;y<SPR;y+=4) ctx.fillRect(0,y,SPR,1);
  return c;
}

function tileWater() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1a2050"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#2a3a78";
  for (let y=2;y<SPR;y+=4){
    for (let x=0;x<SPR;x+=2){
      ctx.fillRect((x+y)%SPR, y, 1, 1);
    }
  }
  ctx.fillStyle = "#5a6abc";
  ctx.fillRect(2,1,2,1); ctx.fillRect(8,5,3,1);
  ctx.fillRect(11,10,2,1); ctx.fillRect(4,13,3,1);
  return c;
}

function tileTree() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  // ground
  ctx.fillStyle = "#1a2a1c"; ctx.fillRect(0,0,SPR,SPR);
  // trunk
  ctx.fillStyle = "#2a1c10"; ctx.fillRect(7,9,2,6);
  ctx.fillStyle = "#1a100a"; ctx.fillRect(7,9,1,6);
  // gnarled crown
  ctx.fillStyle = "#1a2418";
  for (const [x,y,w,h] of [[4,2,8,5],[3,4,2,3],[11,4,2,3],[5,7,6,2]]) ctx.fillRect(x,y,w,h);
  ctx.fillStyle = "#243024";
  ctx.fillRect(5,3,2,1); ctx.fillRect(9,3,2,1); ctx.fillRect(7,5,2,1);
  ctx.fillStyle = "#0a0a0a"; ctx.fillRect(6,4,1,1); ctx.fillRect(10,5,1,1);
  return c;
}

function tileFloor() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3a342a"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#4a4234";
  for (let y=0;y<SPR;y+=8){
    for (let x=0;x<SPR;x+=8){
      ctx.fillRect(x+1,y+1,6,6);
    }
  }
  ctx.fillStyle = "#2a241a";
  for (let y=0;y<SPR;y+=8) ctx.fillRect(0,y,SPR,1);
  for (let x=0;x<SPR;x+=8) ctx.fillRect(x,0,1,SPR);
  return c;
}

function tileDoor() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2a2a36"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#5a3a20"; ctx.fillRect(3,2,10,13);
  ctx.fillStyle = "#3a2410"; ctx.fillRect(3,2,1,13); ctx.fillRect(12,2,1,13);
  ctx.fillStyle = "#a08040"; ctx.fillRect(11,8,1,2);
  ctx.fillStyle = "#1a1208";
  for (let y=4;y<14;y+=3) ctx.fillRect(4,y,8,1);
  return c;
}

function tileShrine() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1a2a1c"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#7a8898"; ctx.fillRect(4,4,8,10);
  ctx.fillStyle = "#5a6878"; ctx.fillRect(4,4,8,2);
  ctx.fillStyle = "#3a4858"; ctx.fillRect(4,12,8,2);
  ctx.fillStyle = "#c2a76a"; ctx.fillRect(7,7,2,3);
  ctx.fillStyle = "#000"; ctx.fillRect(7,10,2,1);
  ctx.fillStyle = "#5a3a3a"; ctx.fillRect(2,14,12,1);
  return c;
}
function tileShrineLit() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1a2a1c"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#cfd8e4"; ctx.fillRect(4,4,8,10);
  ctx.fillStyle = "#9aa8b8"; ctx.fillRect(4,4,8,2);
  ctx.fillStyle = "#6a7888"; ctx.fillRect(4,12,8,2);
  ctx.fillStyle = "#fff2a8"; ctx.fillRect(6,6,4,5);
  ctx.fillStyle = "#fff"; ctx.fillRect(7,7,2,3);
  return c;
}

function tileChest() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3a342a"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#5a3a20"; ctx.fillRect(3,6,10,8);
  ctx.fillStyle = "#3a2410"; ctx.fillRect(3,6,10,1); ctx.fillRect(3,13,10,1);
  ctx.fillStyle = "#c2a76a"; ctx.fillRect(7,9,2,2);
  ctx.fillStyle = "#1a1208"; ctx.fillRect(3,6,1,8); ctx.fillRect(12,6,1,8);
  return c;
}
function tileChestOpen() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3a342a"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#3a2410"; ctx.fillRect(3,9,10,5);
  ctx.fillStyle = "#1a1208"; ctx.fillRect(3,4,10,2);
  ctx.fillStyle = "#5a3a20"; ctx.fillRect(3,9,10,1);
  return c;
}

function tileFountain() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3a342a"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#7a8898"; ctx.fillRect(2,4,12,10);
  ctx.fillStyle = "#1a2050"; ctx.fillRect(3,5,10,8);
  ctx.fillStyle = "#3a4a78"; ctx.fillRect(4,6,8,1);
  ctx.fillStyle = "#5a6abc"; ctx.fillRect(7,8,2,3);
  return c;
}

function tileGrave() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1a2a1c"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#5a5868"; ctx.fillRect(4,3,8,10);
  ctx.fillStyle = "#3a3848"; ctx.fillRect(4,3,8,2);
  ctx.fillStyle = "#1a1828"; ctx.fillRect(6,7,1,1); ctx.fillRect(9,7,1,1);
  ctx.fillStyle = "#1a1828"; ctx.fillRect(7,9,2,1);
  ctx.fillStyle = "#5a5040"; ctx.fillRect(2,13,12,1);
  return c;
}

function tileBridge() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1a2050"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#5a3a20"; ctx.fillRect(0,5,SPR,6);
  ctx.fillStyle = "#3a2410";
  for (let x=0;x<SPR;x+=3) ctx.fillRect(x,5,1,6);
  ctx.fillStyle = "#3a2410"; ctx.fillRect(0,5,SPR,1); ctx.fillRect(0,10,SPR,1);
  return c;
}

function tileStatue() {
  const c = document.createElement("canvas");
  c.width = SPR; c.height = SPR;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1a2a1c"; ctx.fillRect(0,0,SPR,SPR);
  ctx.fillStyle = "#7a8898"; ctx.fillRect(6,1,4,3);
  ctx.fillStyle = "#5a6878"; ctx.fillRect(5,4,6,8);
  ctx.fillStyle = "#9aa8b8"; ctx.fillRect(6,5,4,4);
  ctx.fillStyle = "#3a4858"; ctx.fillRect(4,12,8,2);
  ctx.fillStyle = "#1a2028"; ctx.fillRect(7,6,1,1); ctx.fillRect(9,6,1,1);
  return c;
}

export const TILES = {
  GRASS: 0, PATH: 1, WALL: 2, WATER: 3, TREE: 4, FLOOR: 5,
  DOOR: 6, SHRINE: 7, CHEST: 8, FOUNTAIN: 9, GRAVE: 10, BRIDGE: 11,
  STATUE: 12, SHRINE_LIT: 13, CHEST_OPEN: 14,
};

export function buildTileCache() {
  tileCache[TILES.GRASS] = tileGrass();
  tileCache[TILES.PATH] = tilePath();
  tileCache[TILES.WALL] = tileWall();
  tileCache[TILES.WATER] = tileWater();
  tileCache[TILES.TREE] = tileTree();
  tileCache[TILES.FLOOR] = tileFloor();
  tileCache[TILES.DOOR] = tileDoor();
  tileCache[TILES.SHRINE] = tileShrine();
  tileCache[TILES.SHRINE_LIT] = tileShrineLit();
  tileCache[TILES.CHEST] = tileChest();
  tileCache[TILES.CHEST_OPEN] = tileChestOpen();
  tileCache[TILES.FOUNTAIN] = tileFountain();
  tileCache[TILES.GRAVE] = tileGrave();
  tileCache[TILES.BRIDGE] = tileBridge();
  tileCache[TILES.STATUE] = tileStatue();
  return tileCache;
}

export function getTileCanvas(id) { return tileCache[id]; }

// Walkability per tile id.
export function isWalkable(id) {
  switch (id) {
    case TILES.WALL:
    case TILES.WATER:
    case TILES.TREE:
    case TILES.FOUNTAIN:
    case TILES.STATUE:
    case TILES.GRAVE:
      return false;
    default: return true;
  }
}
