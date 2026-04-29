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

// Back-facing variant: no facial details; hair fills the head; garment
// continues across the back without belt accents.
const heroBackBase = [
  "................",
  ".....02220......",
  "....0222220.....",
  "....0222220.....",
  "....0222220.....",
  "....0222220.....",
  "....02222220....",
  "...033333330....",
  "...033333330....",
  "...033333330....",
  "...033333330....",
  "....033 330.....",
  "....055 550.....",
  "....055 550.....",
  "....050 050.....",
  "................",
];

function heroBackSprite(p) {
  return makeSprite(heroBackBase.map(r => r.replace(/ /g, ".")), {
    "0": "#0a0a10",
    "1": p.skin,
    "2": p.hair,
    "3": p.garment,
    "4": p.accent,
    "5": p.boots,
  });
}

function makeHero(p) {
  return { south: heroSprite(p), north: heroBackSprite(p) };
}

function defineHero(palette, info) {
  const sprites = makeHero(palette);
  return { ...info, sprite: sprites.south, sprites };
}

export const HEROES = {
  ranger: defineHero(
    { skin: "#d8b48a", hair: "#3a2418", garment: "#3a4a30", accent: "#7a6440", boots: "#2a1c12" },
    { name: "Aranor", title: "the Ranger",
      base: { hp: 36, mp: 6, atk: 9, def: 5, spd: 7, lvl: 1, xp: 0 },
      spells: [], classKind: "warrior" }),
  archer: defineHero(
    { skin: "#e2c79a", hair: "#d8c060", garment: "#5a6a78", accent: "#a8b8c8", boots: "#3a2a18" },
    { name: "Lendir", title: "the Sindar Archer",
      base: { hp: 28, mp: 10, atk: 8, def: 4, spd: 9, lvl: 1, xp: 0 },
      spells: ["star_arrow"], classKind: "archer" }),
  mage: defineHero(
    { skin: "#dcc8aa", hair: "#cfcfd6", garment: "#3a3a52", accent: "#9aa0d6", boots: "#1a1a26" },
    { name: "Mithrael", title: "the Grey Wanderer",
      base: { hp: 22, mp: 24, atk: 5, def: 3, spd: 6, lvl: 1, xp: 0 },
      spells: ["heal", "holy_light", "lightning"], classKind: "mage" }),
  dwarf: defineHero(
    { skin: "#d6a878", hair: "#9a3a18", garment: "#4a3a2a", accent: "#a08050", boots: "#2a1810" },
    { name: "Gimrek", title: "of Erebor",
      base: { hp: 44, mp: 4, atk: 10, def: 8, spd: 4, lvl: 1, xp: 0 },
      spells: [], classKind: "warrior" }),
  faelwen: defineHero(
    { skin: "#e8d4b0", hair: "#cfcfd6", garment: "#dce4ec", accent: "#b8a878", boots: "#6a6878" },
    { name: "Faelwen", title: "Lady of the Mirror",
      base: { hp: 26, mp: 28, atk: 4, def: 3, spd: 7, lvl: 1, xp: 0 },
      spells: ["heal", "holy_light", "holy_word"], classKind: "mage" }),
  beren: defineHero(
    { skin: "#d6b888", hair: "#3a2818", garment: "#2a1820", accent: "#7a3a3a", boots: "#1a0a0a" },
    { name: "Beren", title: "the Wayward",
      base: { hp: 32, mp: 8, atk: 11, def: 4, spd: 10, lvl: 1, xp: 0 },
      spells: ["shadow_strike"], classKind: "archer" }),
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

function ghoulBody() {
  return [
    "................",
    "................",
    "....000000......",
    "...022222200....",
    "..02244442220...",
    "..02114411220...",
    "..02211112220...",
    "..02222222220...",
    "..03333333330...",
    "..03311113330...",
    "..03333333330...",
    "..03333333330...",
    "...033303330....",
    "...030000300....",
    "...00....00.....",
    "................",
  ];
}

function wargriderBody() {
  return [
    "................",
    "...000....000...",
    "..02220...0220..",
    "..02220...0220..",
    "..02220000022000",
    ".0222222222222220",
    ".0211222222222220",
    ".0211122222112220",
    ".02222222221122 0",
    "..0222222222222 0",
    "..02220.0.0.0220",
    "..0220...0..0220",
    "..0020....0.0020",
    "................",
    "................",
    "................",
  ];
}

function bansheeBody() {
  return [
    "................",
    "....0000000.....",
    "...022222220....",
    "..02222222220...",
    "..02211112220...",
    "..02211112220...",
    "..02244442220...",
    "..02222222220...",
    "..02222222220...",
    ".022222222220...",
    ".022222222222...",
    "0222222222222200",
    "0222222222222220",
    "022200222000222.",
    ".020...020..020.",
    "................",
  ];
}

function trollBody() {
  return [
    "................",
    "...0000000000...",
    "..033333333330..",
    "..033111133330..",
    "..033111133330..",
    "..033444433330..",
    "..033333333330..",
    "..033322333330..",
    "..033322333330..",
    "..033322333330..",
    "..033333333330..",
    "..033333333330..",
    "..033030003330..",
    "..030000000300..",
    "..000.....000...",
    "................",
  ];
}

function heraldBody() {
  return [
    "................",
    ".....000000.....",
    "....044444440...",
    "...04444444440..",
    "...02211221220..",
    "...02211221220..",
    "..0322222222230.",
    "..0322444422230.",
    "..0332222222330.",
    "..0333322333330.",
    "..0333322333330.",
    "..0333222233330.",
    "..0333333333330.",
    "..0033330033330.",
    "...020.....020..",
    "................",
  ];
}

function crebainBody() {
  return [
    "................",
    "................",
    "................",
    "....00....00....",
    "...0220..0220...",
    "..022220022220..",
    ".02222220222220.",
    ".02211220221120.",
    ".02222220222220.",
    "..02220..02220..",
    "...020....020...",
    "................",
    "................",
    "................",
    "................",
    "................",
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
  ghoul: {
    id: "ghoul", name: "Ghoul of Imladris",
    sprite: makeSprite(ghoulBody().map(r => r.replace(/ /g, ".")),
      { "0": "#000", "1": "#a83030", "2": "#5a6a4a", "3": "#3a3a2a", "4": "#3a1a1a" }),
    hp: 18, atk: 7, def: 2, spd: 5, xp: 14, gold: 4,
    weak: "holy",
  },
  wargrider: {
    id: "wargrider", name: "Wargrider Specter",
    sprite: makeSprite(wargriderBody().map(r => r.replace(/ /g, ".")),
      { "0": "#000", "1": "#c83030", "2": "#3a3848" }),
    hp: 24, atk: 9, def: 3, spd: 9, xp: 22, gold: 8,
    weak: "lightning",
  },
  banshee: {
    id: "banshee", name: "Dread Banshee",
    sprite: makeSprite(bansheeBody().map(r => r.replace(/ /g, ".")),
      { "0": "#000", "1": "#dceaff", "2": "#9aa8d8", "4": "#5a3a78" }),
    hp: 26, atk: 6, def: 3, spd: 6, xp: 28, gold: 10,
    weak: "holy", ability: "wail",
  },
  troll: {
    id: "troll", name: "Cave-troll Specter",
    sprite: makeSprite(trollBody().map(r => r.replace(/ /g, ".")),
      { "0": "#000", "1": "#c83030", "2": "#3a2a2a", "3": "#2a3848", "4": "#a07050" }),
    hp: 50, atk: 12, def: 6, spd: 3, xp: 40, gold: 18,
    weak: "holy",
  },
  herald: {
    id: "herald", name: "Witch-King's Herald",
    sprite: makeSprite(heraldBody().map(r => r.replace(/ /g, ".")),
      { "0": "#000", "1": "#a02020", "2": "#1a1020", "3": "#3a2030", "4": "#3a0a18" }),
    hp: 70, atk: 12, def: 5, spd: 7, xp: 100, gold: 50,
    weak: "holy", boss: true,
  },
  crebain: {
    id: "crebain", name: "Crebain Flock",
    sprite: makeSprite(crebainBody().map(r => r.replace(/ /g, ".")),
      { "0": "#000", "1": "#c83030", "2": "#1a1020" }),
    hp: 14, atk: 5, def: 1, spd: 11, xp: 10, gold: 3,
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

function tileWaterFrames() {
  // Four-phase shimmer for the cursed Bruinen.
  const frames = [];
  const sparklePhases = [
    [[2,1,2],[8,5,3],[11,10,2],[4,13,3]],
    [[3,2,2],[9,6,2],[12,11,2],[5,14,2]],
    [[4,3,3],[10,7,2],[13,12,2],[6,15,2]],
    [[5,4,2],[11,8,3],[14,13,2],[7, 1,2]],
  ];
  for (let f = 0; f < 4; f++) {
    const c = document.createElement("canvas");
    c.width = SPR; c.height = SPR;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#1a2050"; ctx.fillRect(0, 0, SPR, SPR);
    // diagonal ripple bands shifted per frame
    ctx.fillStyle = "#2a3a78";
    for (let y = 0; y < SPR; y++) {
      for (let x = 0; x < SPR; x++) {
        if (((x + y + f) % 4) === 0) ctx.fillRect(x, y, 1, 1);
      }
    }
    // mid-tone speckles
    ctx.fillStyle = "#3a4aa0";
    for (let i = 0; i < 8; i++) {
      const x = (i * 5 + f * 3) % SPR;
      const y = (i * 7 + f * 5) % SPR;
      ctx.fillRect(x, y, 1, 1);
    }
    // bright sparkles
    ctx.fillStyle = "#9aa8e8";
    for (const [x, y, w] of sparklePhases[f]) ctx.fillRect(x, y, w, 1);
    frames.push(c);
  }
  return frames;
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

function tileFountainFrames() {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const c = document.createElement("canvas");
    c.width = SPR; c.height = SPR;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#3a342a"; ctx.fillRect(0,0,SPR,SPR);
    ctx.fillStyle = "#7a8898"; ctx.fillRect(2,4,12,10);
    ctx.fillStyle = "#1a2050"; ctx.fillRect(3,5,10,8);
    ctx.fillStyle = "#3a4a78"; ctx.fillRect(4,6,8,1);
    // central jet
    ctx.fillStyle = "#5a6abc";
    ctx.fillRect(7,8,2,3);
    // animated splashes — small white pixels move outward
    ctx.fillStyle = "#cfd8e4";
    const rim = [
      [[5,7],[10,7]],
      [[4,8],[11,8]],
      [[5,9],[10,9]],
      [[6,7],[9,7]],
    ][f];
    for (const [px, py] of rim) ctx.fillRect(px, py, 1, 1);
    // a sparkle
    ctx.fillStyle = "#fff5c2";
    ctx.fillRect(7 + (f % 2), 6 - (f & 1 ? 0 : 1), 1, 1);
    frames.push(c);
  }
  return frames;
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

const animatedTiles = {};
const ANIM_PERIOD_MS = 220;

let flameFrames = null;

export function buildTileCache() {
  tileCache[TILES.GRASS] = tileGrass();
  tileCache[TILES.PATH] = tilePath();
  tileCache[TILES.WALL] = tileWall();
  tileCache[TILES.TREE] = tileTree();
  tileCache[TILES.FLOOR] = tileFloor();
  tileCache[TILES.DOOR] = tileDoor();
  tileCache[TILES.SHRINE] = tileShrine();
  tileCache[TILES.SHRINE_LIT] = tileShrineLit();
  tileCache[TILES.CHEST] = tileChest();
  tileCache[TILES.CHEST_OPEN] = tileChestOpen();
  tileCache[TILES.FOUNTAIN] = tileFountainFrames()[0];
  animatedTiles[TILES.FOUNTAIN] = tileFountainFrames();
  tileCache[TILES.GRAVE] = tileGrave();
  tileCache[TILES.BRIDGE] = tileBridge();
  tileCache[TILES.STATUE] = tileStatue();

  animatedTiles[TILES.WATER] = tileWaterFrames();
  // First water frame as fallback for any non-time-aware caller.
  tileCache[TILES.WATER] = animatedTiles[TILES.WATER][0];

  flameFrames = buildFlameFrames();
  return tileCache;
}

export function getTileCanvas(id, time = 0) {
  const frames = animatedTiles[id];
  if (frames) return frames[Math.floor(time / ANIM_PERIOD_MS) % frames.length];
  return tileCache[id];
}

// ---------- Flame / brazier overlay (drawn over shrines) ----------

function buildFlameFrames() {
  // Three flame poses, drawn slightly larger than 8x10, on a small canvas
  // that the renderer can blit centered on top of a shrine.
  const W2 = 10, H2 = 12;
  const poses = [
    {
      tip: [[5,1]],
      mid: [[4,2],[5,2],[6,2],[4,3],[5,3],[6,3]],
      bel: [[3,4],[4,4],[5,4],[6,4],[7,4],[3,5],[4,5],[5,5],[6,5],[7,5],
            [4,6],[5,6],[6,6]],
      core: [[5,3],[5,4],[5,5]],
    },
    {
      tip: [[4,1]],
      mid: [[4,2],[5,2],[3,3],[4,3],[5,3],[6,3]],
      bel: [[3,4],[4,4],[5,4],[6,4],[7,4],[2,5],[3,5],[4,5],[5,5],[6,5],[7,5],
            [3,6],[4,6],[5,6],[6,6]],
      core: [[4,3],[4,4],[4,5]],
    },
    {
      tip: [[6,1]],
      mid: [[5,2],[6,2],[4,3],[5,3],[6,3],[7,3]],
      bel: [[3,4],[4,4],[5,4],[6,4],[7,4],[3,5],[4,5],[5,5],[6,5],[7,5],[8,5],
            [4,6],[5,6],[6,6],[7,6]],
      core: [[6,3],[6,4],[6,5]],
    },
  ];
  return poses.map(pose => {
    const c = document.createElement("canvas");
    c.width = W2; c.height = H2;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#5a2a18";
    for (const [x, y] of pose.bel) ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = "#c8602a";
    for (const [x, y] of pose.mid) ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = "#ffcc55";
    for (const [x, y] of pose.core) ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = "#fff5c2";
    for (const [x, y] of pose.tip) ctx.fillRect(x, y, 1, 1);
    return c;
  });
}

export function getFlameFrame(time, jitter = 0) {
  if (!flameFrames) return null;
  const i = Math.floor((time + jitter) / 120) % flameFrames.length;
  return flameFrames[i];
}

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
