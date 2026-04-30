import { TILES } from "./sprites.js";

// World map of haunted Rivendell, generated programmatically so feature
// coordinates are authoritative and the map is guaranteed consistent.
//
// Vertical layout (north to south):
//   y=0..6      cliffs and the cursed Bruinen with the bridge
//   y=7..14     outer courtyard - shrine 1 (Oath)
//   y=15..23    Last Homely House interior - shrine 2 (Hearth)
//   y=24..31    burial grove - shrine 3 (Stone of Vilya)
//   y=32..37    cavern descent - boss

export const W = 50;
export const H = 38;

export const SPAWN = { x: 8, y: 7 };

// Static fixtures (single source of truth for both the generator and the
// interaction code).
export const SHRINES = [
  { x: 9,  y: 11, id: "shrine_oath",
    name: "Shrine of Elrond's Oath",
    blessing: "Aranor's blade is hallowed. Holy damage rises." },
  { x: 25, y: 19, id: "shrine_hall",
    name: "Hearth of the Hall of Fire",
    blessing: "The hearth warms your spirits. The party is fully restored." },
  { x: 25, y: 28, id: "shrine_vilya",
    name: "Stone of Vilya",
    blessing: "A glimmer of Vilya. Mithrael's spells gain power." },
];

export const CHESTS = [
  { x: 16, y: 13, items: [
      { id: "potion", n: 2 }, { id: "lembas", n: 1 },
      { id: "equip:leather_jerkin", n: 1 } ] },
  { x: 30, y: 21, items: [
      { id: "manabrew", n: 2 }, { id: "gold", n: 30 },
      { id: "equip:elven_longbow", n: 1 }, { id: "equip:silver_dagger", n: 1 },
      { id: "blessoil", n: 1 } ] },
  { x: 38, y: 29, items: [
      { id: "starflask", n: 1 }, { id: "gold", n: 60 },
      { id: "equip:hallowed_axe", n: 1 }, { id: "antidote", n: 2 },
      { id: "equip:ring_of_durin", n: 1 } ] },
];

export const STATUES = [
  { x: 6, y: 9, lines: [
    "[A weather-worn statue of Earendil.]",
    "Long has the river been still. Yet now it whispers in tongues no Eldar should know.",
  ]},
  { x: 14, y: 9, lines: [
    "[A statue of Glorfindel, eyes gouged.]",
    "Even the bright flame has dimmed. Kindle the three shrines, traveller.",
  ]},
  { x: 25, y: 22, lines: [
    "[A bust of Elrond, cracked at the brow.]",
    "Three hallows — Oath, Hearth, Stone — must blaze before you descend.",
  ]},
  { x: 14, y: 30, lines: [
    "[A weeping statue, name effaced.]",
    "South lies the cavern. Do not fall before all three are kindled.",
  ]},
];

export const FIXED = [
  { x: 26, y: 34, kind: "midboss", enemy: "herald",
    intro: "A cloaked herald bars the way. \"Turn back, kindler of shrines.\"" },
  { x: 26, y: 36, kind: "boss", enemy: "nazgul",
    intro: "A cold rises from the cavern. The Wraith-Lord of the Bruinen drifts forth." },
];

// NPCs with simple dialogue / a side quest.
export const NPCS = [
  { x: 11, y: 8, id: "hithon",
    name: "Hithon the Watchman",
    intro: "[A grizzled elf leans against a broken spear.] \"Stranger! The Lost Lore Stone of Imladris fell into the burial grove when the dead rose. If you find it, return it here. There is reward enough.\"",
    no_quest_yet: "\"Look in the grove, south of the Hall.\"",
    has_stone: "\"The Stone! You found it!\" Hithon presses a star-spun robe and 50 silver into your hands. \"Wear it well.\"",
    after: "\"The Stone glimmers again. May it light your way.\"",
  },
  { x: 14, y: 11, id: "brethil",
    name: "Brethil the Healer",
    role: "healer",
    intro: "[A white-robed elf tends a kettle of athelas.] \"Twenty silver and I will mend you all — body and breath. The fallen, too.\"",
  },
];

// Side-quest item placement.
export const QUEST_ITEMS = [
  { x: 22, y: 28, id: "lore_stone", name: "Lost Lore Stone",
    desc: "A pale stone, faintly glowing.",
    flavor: "You lift the Lore Stone. It hums in your hand." },
];

// Campfires - safe rest spots, fully restore the party (once per visit).
export const CAMPFIRES = [
  { x: 14, y: 13, id: "camp_courtyard" },
  { x: 16, y: 30, id: "camp_grove" },
];

// Recruitable heroes hidden in the world. Interact (E) to recruit.
export const RECRUITS = [
  { x: 32, y: 19, id: "faelwen",
    intro: "[A pale lady kneels by the hearth.] \"I am Faelwen, healer of the Mirror. Let me walk with you.\"",
    accepted: "Faelwen joins your fellowship." },
  { x: 38, y: 27, id: "beren",
    intro: "[A hooded figure rises from the graves.] \"Beren they once called me. Lost. Useful with a knife.\"",
    accepted: "Beren the Wayward joins your fellowship." },
];

// ----- Generator ----------------------------------------------------------

function fill(grid, x0, y0, x1, y1, t) {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      grid[y][x] = t;
    }
  }
}

function set(grid, x, y, t) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  grid[y][x] = t;
}

function rect(grid, x0, y0, x1, y1, t) {
  for (let x = x0; x <= x1; x++) { set(grid, x, y0, t); set(grid, x, y1, t); }
  for (let y = y0; y <= y1; y++) { set(grid, x0, y, t); set(grid, x1, y, t); }
}

export function buildWorld() {
  const grid = [];
  for (let y = 0; y < H; y++) {
    const row = new Array(W).fill(TILES.GRASS);
    grid.push(row);
  }

  // Northern cliffs (impassable trees) along the edges.
  for (let x = 0; x < W; x++) {
    set(grid, x, 0, TILES.WALL);
    set(grid, x, H - 1, TILES.WALL);
  }
  for (let y = 0; y < H; y++) {
    set(grid, 0, y, TILES.WALL);
    set(grid, W - 1, y, TILES.WALL);
  }

  // ---- Bruinen river across the top ----
  fill(grid, 1, 1, W - 2, 5, TILES.WATER);

  // Bridge crossing (north-south) at x = 8.
  for (let y = 1; y <= 5; y++) set(grid, 8, y, TILES.BRIDGE);
  // bridge planks one wider for visual presence
  for (let y = 2; y <= 4; y++) set(grid, 9, y, TILES.BRIDGE);

  // Path leading down from the bridge.
  for (let y = 6; y <= 14; y++) set(grid, 8, y, TILES.PATH);
  for (let y = 6; y <= 14; y++) set(grid, 9, y, TILES.PATH);

  // ---- Outer courtyard (y 7..14) ----
  // sparse tree line at the cliff edges
  for (let x = 1; x < W - 1; x++) {
    if ((x * 7) % 11 < 3 && grid[6][x] === TILES.GRASS) set(grid, x, 6, TILES.TREE);
  }
  // Cobble plaza around shrine 1
  fill(grid, 6, 10, 14, 13, TILES.PATH);

  // Statues flanking shrine 1
  set(grid, SHRINES[0].x, SHRINES[0].y, TILES.SHRINE);
  set(grid, STATUES[0].x, STATUES[0].y, TILES.STATUE);
  set(grid, STATUES[1].x, STATUES[1].y, TILES.STATUE);

  // Fountain in the plaza
  set(grid, 12, 12, TILES.FOUNTAIN);

  // East path leading to the Last Homely House
  for (let x = 14; x <= 22; x++) set(grid, x, 12, TILES.PATH);
  for (let x = 14; x <= 22; x++) set(grid, x, 13, TILES.PATH);

  // A scattering of haunted trees in the courtyard wilderness
  const courtyardTrees = [
    [3, 7], [4, 9], [3, 11], [2, 13], [5, 14],
    [16, 7], [18, 8], [20, 7], [22, 9], [19, 10],
    [4, 8], [3, 14], [21, 14], [20, 11],
  ];
  for (const [x, y] of courtyardTrees) if (grid[y][x] === TILES.GRASS) set(grid, x, y, TILES.TREE);

  // ---- The Last Homely House (y 15..23) ----
  // Outer walls
  fill(grid, 18, 15, 36, 23, TILES.WALL);
  // Interior floor
  fill(grid, 19, 16, 35, 22, TILES.FLOOR);
  // Doors: north (from courtyard) and south (to grove)
  set(grid, 22, 15, TILES.DOOR);
  set(grid, 28, 23, TILES.DOOR);
  // West annex doorway from the path
  set(grid, 18, 19, TILES.DOOR);
  // Path connecting courtyard plaza (right side) into the north door.
  for (let y = 14; y <= 15; y++) set(grid, 22, y, TILES.PATH);
  // Path from west door
  for (let x = 14; x <= 18; x++) set(grid, x, 19, TILES.PATH);

  // Hearth (shrine 2) at center, statue of Elrond, chest, and decor.
  set(grid, SHRINES[1].x, SHRINES[1].y, TILES.SHRINE);
  set(grid, STATUES[2].x, STATUES[2].y, TILES.STATUE);
  set(grid, CHESTS[1].x, CHESTS[1].y, TILES.CHEST);
  // a few wall pillars inside for atmosphere
  for (const [x, y] of [[21,17],[21,21],[33,17],[33,21]]) set(grid, x, y, TILES.WALL);

  // Chest in the courtyard
  set(grid, CHESTS[0].x, CHESTS[0].y, TILES.CHEST);

  // ---- Burial grove (y 24..31) ----
  // Path leading south from the Last Homely House south door.
  for (let y = 23; y <= 32; y++) { set(grid, 28, y, TILES.PATH); set(grid, 27, y, TILES.PATH); }
  // Twisted graves clustered around shrine 3
  const graves = [
    [22, 26],[23, 26],[31, 26],[32, 26],
    [22, 30],[23, 30],[31, 30],[32, 30],
    [20, 28],[34, 28],
  ];
  for (const [x, y] of graves) set(grid, x, y, TILES.GRAVE);
  // Trees framing the grove
  for (const [x, y] of [
    [10, 25],[12, 27],[14, 26],[15, 28],[12, 30],
    [38, 25],[40, 27],[42, 26],[44, 28],[42, 30],
    [11, 32],[14, 33],[40, 32],[42, 33],
  ]) if (grid[y][x] === TILES.GRASS) set(grid, x, y, TILES.TREE);
  // Shrine 3, a weeping statue, and a chest in the grove
  set(grid, SHRINES[2].x, SHRINES[2].y, TILES.SHRINE);
  set(grid, STATUES[3].x, STATUES[3].y, TILES.STATUE);
  set(grid, CHESTS[2].x, CHESTS[2].y, TILES.CHEST);

  // ---- Cavern descent (y 32..37) ----
  // Stone passage with cavern walls.
  fill(grid, 5, 33, W - 6, 33, TILES.WALL);
  fill(grid, 5, 33, 5, 36, TILES.WALL);
  fill(grid, W - 6, 33, W - 6, 36, TILES.WALL);
  // Cavern floor
  fill(grid, 6, 34, W - 7, 36, TILES.FLOOR);
  // Mouth of the cavern (a doorway in the wall)
  set(grid, 25, 33, TILES.DOOR);
  // Path connecting grove path into the cavern mouth
  for (let y = 32; y <= 33; y++) { set(grid, 27, y, TILES.PATH); set(grid, 28, y, TILES.PATH); }
  set(grid, 26, 33, TILES.DOOR);

  // Connection patch to ensure 27,32 and 28,32 are reachable
  set(grid, 27, 32, TILES.PATH);
  set(grid, 28, 32, TILES.PATH);

  return grid;
}

// Encounter zones: chance-per-step weighted by region.
export function encounterTable(x, y) {
  if (y <= 5) return null;
  if (y <= 9)  return { rate: 0.10, pool: ["spectre", "wargrider", "crebain", "warg"] };
  if (y <= 14) return { rate: 0.06, pool: ["ghoul", "spectre", "warg", "crebain"] };
  if (y <= 23) return { rate: 0.05, pool: ["shade", "banshee", "wight", "crebain"] };
  if (y <= 31) return { rate: 0.10, pool: ["wight", "ghoul", "banshee", "shade"] };
  return { rate: 0.12, pool: ["troll", "wight", "wargrider", "shade"] };
}

export function findInteractable(x, y) {
  for (const s of SHRINES) if (s.x === x && s.y === y) return { kind: "shrine", ...s };
  for (const s of STATUES) if (s.x === x && s.y === y) return { kind: "statue", ...s };
  for (const c of CHESTS) if (c.x === x && c.y === y) return { kind: "chest", ...c };
  for (const r of RECRUITS) if (r.x === x && r.y === y) return { kind: "recruit", ...r };
  for (const n of NPCS) if (n.x === x && n.y === y) return { kind: "npc", ...n };
  for (const q of QUEST_ITEMS) if (q.x === x && q.y === y) return { kind: "questitem", ...q };
  for (const c of CAMPFIRES) if (c.x === x && c.y === y) return { kind: "campfire", ...c };
  for (const f of FIXED) if (f.x === x && f.y === y) return { ...f };
  return null;
}
