import {
  HEROES, ENEMIES, TILES, buildTileCache, getTileCanvas, getFlameFrame, isWalkable,
} from "./sprites.js";
import {
  W, H, SPAWN, buildWorld, encounterTable, findInteractable,
  SHRINES, CHESTS, RECRUITS, NPCS, QUEST_ITEMS, CAMPFIRES,
} from "./world.js";
import { ITEMS, SPELLS, EQUIPMENT, eligibleSlots } from "./items.js";
import { startCombat, queuePartyActions, tickResolve } from "./combat.js";

const TILE = 16;
const VIEW_W = 320, VIEW_H = 240;
const VIEW_TX = VIEW_W / TILE, VIEW_TY = VIEW_H / TILE;

const screen = document.getElementById("screen");
const ctx = screen.getContext("2d");
ctx.imageSmoothingEnabled = false;

// Offscreen lighting overlay (same size as the canvas).
const lightCanvas = document.createElement("canvas");
lightCanvas.width = VIEW_W; lightCanvas.height = VIEW_H;
const lightCtx = lightCanvas.getContext("2d");

// Animation-time accumulator (ms since boot).
let animTime = 0;
// Player render-position tween (in pixel coords on the world).
let walk = null; // { fromPx, fromPy, toPx, toPy, start, dur }
const WALK_DUR = 130;

// Particles: drifting mist flecks (pixel-space, world coordinates).
const particles = [];

// Title-screen stars cached per-load.
const titleStars = [];

// Combat fx state.
const fx = {
  dmgNumbers: [],   // { x, y, text, color, born, dur }
  hitFlash: new Map(),  // enemy.instanceId -> until-ms
  partyFlash: new Map(), // party index -> until-ms
  shake: { until: 0, mag: 0 },
  slash: [],        // { enemyIdx, born, dur }
  spells: [],       // { enemyIdx, color, born, dur }
  dissolves: [],    // { enemy snapshot, x, y, born, dur }
};

// World particles (embers).
const embers = [];

// Mini-map visibility flag.
let miniMapOpen = false;

// View mode: "2d" (top-down) or "3d" (fake first-person, M&M4-style).
let viewMode = "2d";

const overlayEl = document.getElementById("overlay");
const partyEl = document.getElementById("party");
const logEl = document.getElementById("log");

const state = {
  phase: "title",   // title | explore | combat | dialog | gameover | victory
  player: { x: SPAWN.x, y: SPAWN.y, facing: "south", anim: 0 },
  party: null,      // populated on new game
  inventory: { potion: 2, manabrew: 1, lembas: 1, starflask: 0 },
  gold: 25,
  steps: 0,
  flags: {},
  grid: null,
  combat: null,
  log(kind, msg) {
    const div = document.createElement("div");
    div.className = kind || "sys";
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.children.length > 80) logEl.removeChild(logEl.firstChild);
  },
  render: () => render(),
};

// Expose for debugging.
window.GAME = state;

const MAX_PARTY = 6;

function buildHero(id) {
  const h = HEROES[id];
  if (!h) throw new Error("Unknown hero id: " + id);
  return {
    id,
    name: h.name,
    title: h.title,
    sprite: h.sprite,
    classKind: h.classKind,
    spells: [...h.spells],
    lvl: h.base.lvl,
    xp: h.base.xp,
    maxHp: h.base.hp, hp: h.base.hp,
    maxMp: h.base.mp, mp: h.base.mp,
    atk: h.base.atk, def: h.base.def, spd: h.base.spd,
    dead: false,
    defending: false,
  };
}

function buildParty() {
  return ["ranger", "archer", "mage", "dwarf"].map(buildHero);
}

// ----- Rendering ----------------------------------------------------------

function getPlayerPixel() {
  const tx = state.player.x * TILE;
  const ty = state.player.y * TILE;
  if (!walk) return { px: tx, py: ty, moving: false };
  const t = Math.min(1, (animTime - walk.start) / walk.dur);
  if (t >= 1) { walk = null; return { px: tx, py: ty, moving: false }; }
  const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  return {
    px: walk.fromPx + (walk.toPx - walk.fromPx) * ease,
    py: walk.fromPy + (walk.toPy - walk.fromPy) * ease,
    moving: true,
  };
}

function render() {
  if (state.phase === "title") return renderTitle();
  if (viewMode === "3d") return render3D();

  const { px: ppx, py: ppy, moving } = getPlayerPixel();

  // Camera centers on the player's interpolated position, clamped to map.
  const camPx = clamp(ppx + TILE / 2 - VIEW_W / 2, 0, W * TILE - VIEW_W);
  const camPy = clamp(ppy + TILE / 2 - VIEW_H / 2, 0, H * TILE - VIEW_H);

  // Optional combat shake offset (combat veil shakes too).
  let shakeX = 0, shakeY = 0;
  if (animTime < fx.shake.until) {
    const k = (fx.shake.until - animTime) / 200;
    shakeX = (Math.random() - 0.5) * fx.shake.mag * k;
    shakeY = (Math.random() - 0.5) * fx.shake.mag * k;
  }

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.save();
  ctx.translate(-camPx + shakeX, -camPy + shakeY);

  // ----- Tiles (with subtle tree-canopy sway) -----
  const tx0 = Math.floor(camPx / TILE);
  const ty0 = Math.floor(camPy / TILE);
  const tx1 = Math.min(W - 1, tx0 + VIEW_TX + 1);
  const ty1 = Math.min(H - 1, ty0 + VIEW_TY + 1);
  for (let wy = ty0; wy <= ty1; wy++) {
    for (let wx = tx0; wx <= tx1; wx++) {
      let id = state.grid[wy][wx];
      if (id === TILES.SHRINE) {
        const sh = SHRINES.find(s => s.x === wx && s.y === wy);
        if (sh && state.flags[sh.id]) id = TILES.SHRINE_LIT;
      } else if (id === TILES.CHEST) {
        const c = CHESTS.find(c => c.x === wx && c.y === wy);
        if (c && state.flags["chest_" + c.x + "_" + c.y]) id = TILES.CHEST_OPEN;
      }
      const img = getTileCanvas(id, animTime);
      if (!img) continue;
      if (id === TILES.TREE) {
        // Sway the canopy (top 9 rows) by a small per-tree sin offset.
        const sway = Math.sin(animTime / 700 + wx * 0.7 + wy * 0.4) * 0.8;
        ctx.drawImage(img, 0, 0, 16, 9, wx * TILE + sway, wy * TILE, 16, 9);
        ctx.drawImage(img, 0, 9, 16, 7, wx * TILE, wy * TILE + 9, 16, 7);
      } else {
        ctx.drawImage(img, wx * TILE, wy * TILE);
      }
    }
  }

  // ----- Recruit NPCs (drawn as hero sprites on the world) -----
  for (const r of RECRUITS) {
    if (state.flags["recruit_" + r.id]) continue;
    if (r.x < tx0 - 1 || r.x > tx1 + 1 || r.y < ty0 - 1 || r.y > ty1 + 1) continue;
    const h = HEROES[r.id];
    if (!h) continue;
    const bob = Math.sin(animTime / 360 + r.x * 1.7) * 0.8;
    drawShadow(r.x * TILE + 8, r.y * TILE + 14, 6, 2);
    ctx.drawImage(h.sprite, r.x * TILE, Math.round(r.y * TILE + bob));
  }

  // ----- Quest NPCs -----
  for (const n of NPCS) {
    if (n.x < tx0 - 1 || n.x > tx1 + 1 || n.y < ty0 - 1 || n.y > ty1 + 1) continue;
    const bob = Math.sin(animTime / 380 + n.x * 1.3) * 0.6;
    drawShadow(n.x * TILE + 8, n.y * TILE + 14, 6, 2);
    // Generic NPC palette (watchman in green/brown).
    const px = n.x * TILE, py = Math.round(n.y * TILE + bob);
    ctx.fillStyle = "#3a2418"; ctx.fillRect(px + 5, py + 1, 6, 4);
    ctx.fillStyle = "#d8b48a"; ctx.fillRect(px + 6, py + 4, 4, 3);
    ctx.fillStyle = "#3a4a30"; ctx.fillRect(px + 4, py + 7, 8, 5);
    ctx.fillStyle = "#7a6440"; ctx.fillRect(px + 5, py + 8, 6, 3);
    ctx.fillStyle = "#2a1c12"; ctx.fillRect(px + 4, py + 12, 3, 3);
    ctx.fillStyle = "#2a1c12"; ctx.fillRect(px + 9, py + 12, 3, 3);
    // ! mark for quest available
    if (!state.flags["quest_" + n.id + "_done"]) {
      ctx.fillStyle = "#fff2a8";
      ctx.fillRect(px + 7, py - 5 + Math.sin(animTime / 200) * 0.5, 1, 2);
      ctx.fillRect(px + 7, py - 1, 1, 1);
    }
  }

  // ----- Quest items (unique pickup props) -----
  for (const q of QUEST_ITEMS) {
    if (state.flags["got_" + q.id]) continue;
    if (q.x < tx0 - 1 || q.x > tx1 + 1 || q.y < ty0 - 1 || q.y > ty1 + 1) continue;
    const t = animTime / 250;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    addBloom(q.x * TILE + 8 - camPx, q.y * TILE + 8 - camPy, 16,
             "rgba(180,210,255,0.5)");
    ctx.restore();
    ctx.fillStyle = "#cfd8e4";
    ctx.fillRect(q.x * TILE + 6, q.y * TILE + 6 + Math.sin(t) * 0.6, 4, 4);
    ctx.fillStyle = "#fff";
    ctx.fillRect(q.x * TILE + 7, q.y * TILE + 7 + Math.sin(t) * 0.6, 2, 2);
  }

  // ----- Campfires -----
  for (const cf of CAMPFIRES) {
    if (cf.x < tx0 - 1 || cf.x > tx1 + 1 || cf.y < ty0 - 1 || cf.y > ty1 + 1) continue;
    // Stone ring
    ctx.fillStyle = "#3a342a";
    ctx.fillRect(cf.x * TILE + 3, cf.y * TILE + 11, 10, 3);
    ctx.fillStyle = "#2a241e";
    for (let i = 0; i < 5; i++) ctx.fillRect(cf.x * TILE + 3 + i * 2, cf.y * TILE + 11, 1, 1);
    // Logs
    ctx.fillStyle = "#5a3a20";
    ctx.fillRect(cf.x * TILE + 5, cf.y * TILE + 9, 6, 1);
    ctx.fillRect(cf.x * TILE + 6, cf.y * TILE + 12, 4, 1);
    // Flame (use shrine flame frame).
    const f = getFlameFrame(animTime, cf.x * 31 + cf.y * 17);
    if (f) ctx.drawImage(f, cf.x * TILE + 3, cf.y * TILE - 4);
  }

  // ----- Brazier flames over shrines -----
  const flame = getFlameFrame(animTime, 0);
  if (flame) {
    for (const s of SHRINES) {
      if (s.x < tx0 - 1 || s.x > tx1 + 1 || s.y < ty0 - 1 || s.y > ty1 + 1) continue;
      const lit = !!state.flags[s.id];
      const f = lit ? getFlameFrame(animTime, s.x * 19) : null;
      if (f) ctx.drawImage(f, s.x * TILE + 3, s.y * TILE - 8);
      // Tiny brazier bowl always present.
      ctx.fillStyle = lit ? "#3a2a1a" : "#1a1820";
      ctx.fillRect(s.x * TILE + 5, s.y * TILE + 2, 6, 2);
    }
  }

  // ----- Mist particles in world space -----
  ctx.save();
  for (const p of particles) {
    const a = (1 - Math.abs(p.t / p.life - 0.5) * 2) * p.alpha;
    if (a <= 0) continue;
    ctx.fillStyle = `rgba(220,225,240,${a.toFixed(3)})`;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  // Embers (warm sparks rising from lit shrines and campfires).
  ctx.globalCompositeOperation = "lighter";
  for (const e of embers) {
    const a = 1 - e.t / e.life;
    if (a <= 0) continue;
    ctx.fillStyle = `rgba(255,200,90,${a.toFixed(3)})`;
    ctx.fillRect(Math.round(e.x), Math.round(e.y), 1, 1);
  }
  ctx.restore();

  // ----- Drop shadow + leader sprite (directional + walk cycle) -----
  drawShadow(ppx + 8, ppy + 14, 6, 2);
  const leader = state.party[0];
  let bobY = 0, bobX = 0;
  if (moving) {
    const t = (animTime - walk.start) / walk.dur;
    bobY = -Math.abs(Math.sin(t * Math.PI)) * 1.2;
    bobX = Math.sin(t * Math.PI * 2) * 0.6;
  }
  // Pick south or back sprite based on facing.
  const facing = state.player.facing || "south";
  const useBack = facing === "north";
  const leaderSprite = useBack ? (leader.sprites?.north || leader.sprite) : leader.sprite;
  // Mirror horizontally for east.
  const drawX = Math.round(ppx + bobX);
  const drawY = Math.round(ppy + bobY);
  if (facing === "east") {
    ctx.save();
    ctx.translate(drawX + 16, drawY);
    ctx.scale(-1, 1);
    drawWalkingBody(leaderSprite, 0, 0, moving ? animTime : 0);
    ctx.restore();
  } else {
    drawWalkingBody(leaderSprite, drawX, drawY, moving ? animTime : 0);
  }

  // World-space floating reward text rises from the player.
  renderWorldFloats(camPx, camPy);

  ctx.restore();

  // ----- Lighting pass: night veil with player + shrine + brazier holes -----
  drawLighting(camPx - shakeX, camPy - shakeY, ppx, ppy);

  // ----- Vignette (always on) -----
  const grd = ctx.createRadialGradient(
    VIEW_W / 2, VIEW_H / 2, 70,
    VIEW_W / 2, VIEW_H / 2, 220);
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Combat veil + enemy line over the canvas.
  if (state.combat) renderCombatVeil(shakeX, shakeY);

  if (miniMapOpen) renderMiniMap();

  renderHUD();
}

function renderMiniMap() {
  const scale = 4;
  const mw = W * scale, mh = H * scale;
  const ox = (VIEW_W - mw) / 2, oy = (VIEW_H - mh) / 2;
  ctx.save();
  ctx.fillStyle = "rgba(5,7,12,0.95)";
  ctx.fillRect(ox - 6, oy - 14, mw + 12, mh + 20);
  ctx.fillStyle = "#c2a76a";
  ctx.font = "bold 9px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillText("MAP — press M to close", ox, oy - 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const id = state.grid[y][x];
      let col = "#0a0d18";
      if (id === TILES.WATER) col = "#1a2050";
      else if (id === TILES.WALL) col = "#3a3a4a";
      else if (id === TILES.PATH || id === TILES.FLOOR || id === TILES.BRIDGE || id === TILES.DOOR) col = "#5a4a3a";
      else if (id === TILES.TREE) col = "#1a2a18";
      else if (id === TILES.GRASS) col = "#1a2a1c";
      else if (id === TILES.SHRINE) col = state.flags["shrine_oath"] || state.flags["shrine_hall"] || state.flags["shrine_vilya"] ? "#fff2a8" : "#7a8898";
      else col = "#3a3a4a";
      ctx.fillStyle = col;
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
  // Shrines
  for (const s of SHRINES) {
    ctx.fillStyle = state.flags[s.id] ? "#fff2a8" : "#9aa0b8";
    ctx.fillRect(ox + s.x * scale - 1, oy + s.y * scale - 1, scale + 2, scale + 2);
  }
  // Campfires
  for (const cf of CAMPFIRES) {
    ctx.fillStyle = "#c8602a";
    ctx.fillRect(ox + cf.x * scale, oy + cf.y * scale, scale, scale);
  }
  // NPCs
  for (const n of NPCS) {
    ctx.fillStyle = "#6f9bd1";
    ctx.fillRect(ox + n.x * scale, oy + n.y * scale, scale, scale);
  }
  // Player
  ctx.fillStyle = "#ff5050";
  ctx.fillRect(ox + state.player.x * scale - 1, oy + state.player.y * scale - 1, scale + 2, scale + 2);
  ctx.restore();
  ctx.textAlign = "left";
}

function drawWalkingBody(sprite, x, y, walkTime) {
  // Split the 16x16 hero into upper body + legs and offset the legs alternately.
  if (!walkTime) {
    ctx.drawImage(sprite, x, y);
    return;
  }
  const phase = Math.floor(walkTime / 90) % 2;
  const legShift = phase === 0 ? -1 : 1;
  ctx.drawImage(sprite, 0, 0, 16, 12, x, y, 16, 12);
  ctx.drawImage(sprite, 0, 12, 16, 4, x + legShift, y + 12, 16, 4);
}

function drawShadow(cx, cy, rx, ry) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLighting(camPx, camPy, ppx, ppy) {
  // Night veil with destination-out radial holes around lights.
  lightCtx.globalCompositeOperation = "source-over";
  lightCtx.fillStyle = "rgba(8,10,22,0.55)";
  lightCtx.fillRect(0, 0, VIEW_W, VIEW_H);

  lightCtx.globalCompositeOperation = "destination-out";
  // Player lantern: warm soft light, slight breathing.
  const breathe = 1 + Math.sin(animTime / 600) * 0.06;
  const lx = ppx - camPx + 8;
  const ly = ppy - camPy + 8;
  punchLight(lx, ly, 56 * breathe, 1.0);

  // Shrine lights when kindled.
  for (const s of SHRINES) {
    if (!state.flags[s.id]) continue;
    const sx = s.x * TILE - camPx + 8;
    const sy = s.y * TILE - camPy + 4;
    punchLight(sx, sy, 36, 0.9);
  }

  // Composite onto the scene as a dim layer.
  lightCtx.globalCompositeOperation = "source-over";
  ctx.drawImage(lightCanvas, 0, 0);

  // Additive warm bloom for shrine lights & player lantern.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const s of SHRINES) {
    if (!state.flags[s.id]) continue;
    const sx = s.x * TILE - camPx + 8;
    const sy = s.y * TILE - camPy + 4;
    addBloom(sx, sy, 30, "rgba(255,200,110,0.55)");
  }
  // Faint lantern bloom on the player.
  addBloom(ppx - camPx + 8, ppy - camPy + 8, 24, "rgba(255,220,160,0.18)");
  ctx.restore();
}

function punchLight(x, y, r, alpha) {
  const g = lightCtx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(0.6, `rgba(0,0,0,${alpha * 0.4})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  lightCtx.fillStyle = g;
  lightCtx.fillRect(x - r, y - r, r * 2, r * 2);
}

function addBloom(x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function combatRegion() {
  const y = state.player.y;
  if (y <= 7)  return "bridge";
  if (y <= 14) return "courtyard";
  if (y <= 23) return "interior";
  if (y <= 31) return "grove";
  return "cavern";
}

const REGION_BACKDROPS = {
  bridge:    { veil: "rgba(8,12,30,0.78)", banner: "#0e1430", trim: "#2a3a64", mistColor: "rgba(140,160,200,${a})" },
  courtyard: { veil: "rgba(10,14,18,0.78)", banner: "#1a1f30", trim: "#2a3148", mistColor: "rgba(150,170,180,${a})" },
  interior:  { veil: "rgba(18,12,12,0.78)", banner: "#251a14", trim: "#3a2820", mistColor: "rgba(200,170,120,${a})" },
  grove:     { veil: "rgba(8,16,12,0.78)", banner: "#142020", trim: "#284836", mistColor: "rgba(150,180,150,${a})" },
  cavern:    { veil: "rgba(14,10,18,0.85)", banner: "#1a1422", trim: "#3a2840", mistColor: "rgba(180,140,200,${a})" },
};

function renderCombatVeil(shakeX, shakeY) {
  const region = combatRegion();
  const theme = REGION_BACKDROPS[region];
  ctx.fillStyle = theme.veil;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Atmospheric mist behind the enemies, color-tinted by region.
  ctx.save();
  const stripeY = 16;
  for (let i = 0; i < 60; i++) {
    const t = (animTime / 60 + i * 17) % 360;
    const x = (t * 1.3) % VIEW_W;
    const y = stripeY + (i * 7) % 96;
    const a = (0.04 + (i % 5) * 0.01).toFixed(3);
    ctx.fillStyle = theme.mistColor.replace("${a}", a);
    ctx.fillRect(x, y, 30, 1);
  }
  ctx.restore();

  // Region-flavored backdrop (e.g., dripping cavern, mossy interior).
  drawCombatBackdrop(region);

  // Banner
  ctx.fillStyle = theme.banner;
  ctx.fillRect(0, 16, VIEW_W, 96);
  ctx.fillStyle = theme.trim;
  ctx.fillRect(0, 16, VIEW_W, 1);
  ctx.fillRect(0, 111, VIEW_W, 1);

  const enemies = state.combat.enemies;
  const slot = VIEW_W / (enemies.length + 1);
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.hp <= 0) continue;
    const baseX = Math.round((i + 1) * slot - 8) + shakeX;
    const baseY = (e.boss ? 28 : 40) + shakeY;
    // Idle bob.
    const bob = Math.sin(animTime / 320 + i * 1.7) * 1.5;
    // Drop shadow.
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(baseX + 8, baseY + 16, 7, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Sprite (with optional red hit flash).
    const flashUntil = fx.hitFlash.get(e.instanceId) || 0;
    if (animTime < flashUntil) {
      ctx.save();
      ctx.drawImage(e.sprite, baseX, baseY + bob);
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = "rgba(220,40,40,0.55)";
      ctx.fillRect(baseX, baseY + bob, 16, 16);
      ctx.restore();
    } else {
      ctx.drawImage(e.sprite, baseX, baseY + bob);
    }
    // status icons above enemy
    if (e.statuses && e.statuses.length) {
      let sx = baseX;
      for (const s of e.statuses) {
        ctx.fillStyle = (s.id === "poison") ? "#7ad06a" : "#f0d878";
        ctx.fillRect(sx, baseY - 8, 3, 3);
        sx += 5;
      }
    }
    // hp pip
    const w = 24, h = 2;
    const px = baseX - 4, py = baseY - 4;
    ctx.fillStyle = "#000"; ctx.fillRect(px, py, w, h);
    ctx.fillStyle = "#b34a4a";
    ctx.fillRect(px, py, Math.round(w * (e.hp / e.maxHp)), h);
  }

  // Slash arcs over targets (white-yellow swipe).
  for (const s of fx.slash) {
    const i = state.combat.enemies.indexOf(s.enemy);
    if (i < 0) continue;
    const baseX = Math.round((i + 1) * slot - 8);
    const baseY = (s.enemy.boss ? 28 : 40);
    const t = (animTime - s.born) / s.dur;
    const a = 1 - t;
    if (a <= 0) continue;
    ctx.save();
    ctx.translate(baseX + 8, baseY + 8);
    ctx.rotate(-Math.PI / 4 + t * Math.PI / 2);
    ctx.strokeStyle = `rgba(255,240,180,${a.toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 12, -1.0, 1.0); ctx.stroke();
    ctx.restore();
  }

  // Spell glyphs (color-coded ring + bloom).
  for (const s of fx.spells) {
    const i = state.combat.enemies.indexOf(s.enemy);
    if (i < 0) continue;
    const baseX = Math.round((i + 1) * slot - 8);
    const baseY = (s.enemy.boss ? 28 : 40);
    const t = (animTime - s.born) / s.dur;
    const a = 1 - t;
    if (a <= 0) continue;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    addBloom(baseX + 8, baseY + 8, 24 * (0.6 + t), s.color);
    ctx.globalAlpha = a;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(baseX + 8, baseY + 8, 6 + t * 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Death dissolves.
  for (const d of fx.dissolves) {
    const t = (animTime - d.born) / d.dur;
    if (t >= 1) continue;
    const cx = d.x + 8, cy = d.y + 8;
    ctx.save();
    for (let i = 0; i < 24; i++) {
      const ang = (i * 7919) % 360 * Math.PI / 180;
      const r = t * 18;
      const px = cx + Math.cos(ang) * r;
      const py = cy + Math.sin(ang) * r - t * 10;
      ctx.fillStyle = `rgba(180,180,210,${(1 - t).toFixed(2)})`;
      ctx.fillRect(px, py, 1, 1);
    }
    ctx.restore();
  }

  // Floating damage numbers.
  ctx.save();
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (const d of fx.dmgNumbers) {
    const t = (animTime - d.born) / d.dur;
    if (t >= 1 || t < 0) continue;
    const a = 1 - t;
    const yoff = -t * 18;
    ctx.fillStyle = d.color.replace("ALPHA", a.toFixed(2));
    ctx.fillText(d.text, d.x, d.y + yoff);
  }
  ctx.restore();
}

function drawCombatBackdrop(region) {
  // Decorative silhouettes behind the enemy line.
  ctx.save();
  if (region === "bridge") {
    ctx.fillStyle = "rgba(60,80,140,0.25)";
    ctx.fillRect(0, 90, VIEW_W, 22);
    ctx.fillStyle = "rgba(40,60,100,0.4)";
    for (let x = 0; x < VIEW_W; x += 14) ctx.fillRect(x, 86, 1, 4);
  } else if (region === "courtyard") {
    ctx.fillStyle = "rgba(40,60,40,0.3)";
    for (let x = 6; x < VIEW_W; x += 36) {
      ctx.fillRect(x, 92, 4, 18);
      ctx.fillRect(x - 4, 88, 12, 6);
    }
  } else if (region === "interior") {
    ctx.fillStyle = "rgba(120,90,40,0.18)";
    for (let x = 0; x < VIEW_W; x += 32) ctx.fillRect(x, 30, 16, 80);
    ctx.fillStyle = "rgba(40,28,16,0.5)";
    for (let x = 16; x < VIEW_W; x += 32) ctx.fillRect(x, 30, 1, 80);
  } else if (region === "grove") {
    ctx.fillStyle = "rgba(40,80,60,0.3)";
    for (let x = 8; x < VIEW_W; x += 28) {
      ctx.fillRect(x, 30 + (x % 7), 4, 70);
    }
  } else if (region === "cavern") {
    ctx.fillStyle = "rgba(40,30,60,0.5)";
    ctx.fillRect(0, 16, VIEW_W, 14);
    for (let x = 2; x < VIEW_W; x += 12) {
      const h = 6 + (x % 5);
      ctx.fillRect(x, 16, 2, h);
    }
    // dripping
    for (let i = 0; i < 8; i++) {
      const x = (i * 41 + Math.floor(animTime / 40) % 80) % VIEW_W;
      const y = 24 + ((animTime / 8 + i * 17) % 80);
      ctx.fillStyle = "rgba(180,200,240,0.3)";
      ctx.fillRect(x, y, 1, 2);
    }
  }
  ctx.restore();
}

function ensureTitleStars() {
  if (titleStars.length) return;
  for (let i = 0; i < 80; i++) {
    titleStars.push({
      x: Math.random() * VIEW_W,
      y: Math.random() * 130,
      a: 0.4 + Math.random() * 0.6,
      tw: Math.random() * Math.PI * 2,
      tws: 0.001 + Math.random() * 0.003,
      par: Math.random() < 0.4 ? 0.3 : 1.0, // some stars on a slow drift layer
    });
  }
}

function renderTitle() {
  ensureTitleStars();
  // Sky gradient.
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, "#03050d");
  sky.addColorStop(0.6, "#0a0e1c");
  sky.addColorStop(1, "#0c1224");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Twinkling stars (parallax drift).
  for (const s of titleStars) {
    const drift = (animTime * 0.005 * s.par) % VIEW_W;
    const x = (s.x + drift) % VIEW_W;
    const tw = (Math.sin(animTime * s.tws + s.tw) + 1) / 2;
    const a = s.a * (0.45 + 0.55 * tw);
    ctx.fillStyle = `rgba(220,225,240,${a.toFixed(3)})`;
    ctx.fillRect(Math.floor(x), Math.floor(s.y), 1, 1);
  }

  // Mountain silhouette (back layer).
  ctx.fillStyle = "#0a0d18";
  drawMountainRange(0, 150, [22, 18, 30, 26, 38, 20, 28, 24, 36, 28, 22, 18, 32]);
  // Mountain silhouette (front layer, sharper).
  ctx.fillStyle = "#10142a";
  drawMountainRange(-12, 168, [16, 28, 22, 38, 30, 24, 36, 28, 22, 30, 26, 18]);

  // Moon with bloom.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const mg = ctx.createRadialGradient(60, 56, 0, 60, 56, 40);
  mg.addColorStop(0, "rgba(220,230,255,0.45)");
  mg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = mg;
  ctx.fillRect(20, 16, 80, 80);
  ctx.restore();
  ctx.fillStyle = "#cfd8e4";
  ctx.beginPath(); ctx.arc(60, 56, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#9aa0b8";
  ctx.beginPath(); ctx.arc(54, 52, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(64, 60, 3, 0, Math.PI * 2); ctx.fill();

  // Faint bridge silhouette in the foreground.
  ctx.fillStyle = "#1a1424";
  ctx.fillRect(0, 200, VIEW_W, 40);
  ctx.fillStyle = "#221a2e";
  ctx.fillRect(40, 196, VIEW_W - 80, 4);
  for (let x = 50; x < VIEW_W - 50; x += 14) {
    ctx.fillRect(x, 196, 1, 8);
  }

  // Title.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 4;
  ctx.fillStyle = "#c2a76a";
  ctx.font = "bold 18px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("SHADOWS OF RIVENDELL", VIEW_W / 2, 116);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#9aa0b8";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText("a pixel-art tale of haunted Imladris", VIEW_W / 2, 132);

  // Pulsing prompt.
  const pulse = 0.5 + 0.5 * Math.sin(animTime / 380);
  ctx.fillStyle = `rgba(216,210,194,${(0.5 + pulse * 0.5).toFixed(3)})`;
  ctx.font = "11px ui-monospace, monospace";
  const prompt = isTouchDevice() ? "Tap to begin" : "Press ENTER to begin";
  ctx.fillText(prompt, VIEW_W / 2, 178);
  ctx.fillStyle = "rgba(122,136,152,0.8)";
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillText(isTouchDevice() ? "Tap LOAD to restore" : "F9 to load saved game", VIEW_W / 2, 192);
  ctx.restore();
  ctx.textAlign = "left";
}

function drawMountainRange(x0, baseY, peaks) {
  ctx.beginPath();
  ctx.moveTo(x0, VIEW_H);
  let x = x0;
  const step = (VIEW_W - x0 * 2) / (peaks.length - 1);
  for (let i = 0; i < peaks.length; i++) {
    ctx.lineTo(x, baseY - peaks[i]);
    x += step;
  }
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.closePath();
  ctx.fill();
}

// ----- HUD ----------------------------------------------------------------

function renderHUD() {
  partyEl.innerHTML = "";
  for (const m of state.party) {
    const lowHp = !m.dead && m.hp / m.maxHp < 0.25;
    const wrap = document.createElement("div");
    wrap.className = "member" + (m.dead ? " dead" : "") + (lowHp ? " low-hp" : "");
    const portrait = document.createElement("canvas");
    portrait.className = "portrait";
    portrait.width = 16; portrait.height = 16;
    portrait.getContext("2d").drawImage(m.sprite, 0, 0);
    portrait.style.width = "28px"; portrait.style.height = "28px";
    wrap.appendChild(portrait);
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = `${m.name} L${m.lvl}`;
    if (m.statuses && m.statuses.length) {
      for (const s of m.statuses) {
        const dot = document.createElement("span");
        dot.style.cssText = "display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:4px;background:" +
          (s.id === "poison" ? "#7ad06a" : "#f0d878");
        name.appendChild(dot);
      }
    }
    info.appendChild(name);
    const hp = document.createElement("div");
    hp.className = "bar";
    const hpFill = document.createElement("span");
    hpFill.style.width = `${Math.max(0, (m.hp / m.maxHp) * 100)}%`;
    hp.appendChild(hpFill);
    info.appendChild(hp);
    if (m.maxMp > 0) {
      const mp = document.createElement("div");
      mp.className = "bar mp";
      const mpFill = document.createElement("span");
      mpFill.style.width = `${Math.max(0, (m.mp / m.maxMp) * 100)}%`;
      mp.appendChild(mpFill);
      info.appendChild(mp);
    }
    const stats = document.createElement("div");
    stats.className = "stats";
    stats.textContent = `HP ${m.hp}/${m.maxHp}  MP ${m.mp}/${m.maxMp}  ATK ${m.atk}  DEF ${m.def}`;
    info.appendChild(stats);
    wrap.appendChild(info);
    partyEl.appendChild(wrap);
  }
  // Gold + steps + shrines lit
  const lit = SHRINES.filter(s => state.flags[s.id]).length;
  const meta = document.createElement("div");
  meta.style.fontSize = "11px";
  meta.style.color = "var(--ink-dim)";
  meta.textContent = `Silver ${state.gold}   Shrines ${lit}/3   Steps ${state.steps}`;
  partyEl.appendChild(meta);
}

// ----- Overlay helpers ----------------------------------------------------

function showOverlay(html, handlers = {}) {
  overlayEl.classList.remove("hidden");
  overlayEl.innerHTML = html;
  for (const [sel, fn] of Object.entries(handlers)) {
    for (const el of overlayEl.querySelectorAll(sel)) {
      el.addEventListener("click", (ev) => fn(ev, el));
    }
  }
}
function hideOverlay() {
  overlayEl.classList.add("hidden");
  overlayEl.innerHTML = "";
}

// ----- Movement / Interaction --------------------------------------------

const DIRS = {
  north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
};

function tryMove(dx, dy) {
  if (state.phase !== "explore") return;
  if (state.combat) return;
  if (walk) return; // ignore inputs mid-tween
  state.player.facing = dx < 0 ? "west" : dx > 0 ? "east" : dy < 0 ? "north" : "south";
  const ox = state.player.x, oy = state.player.y;
  const nx = ox + dx, ny = oy + dy;
  if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
  const t = state.grid[ny][nx];
  const passable = isWalkable(t)
    || t === TILES.SHRINE || t === TILES.SHRINE_LIT
    || t === TILES.CHEST || t === TILES.CHEST_OPEN
    || t === TILES.DOOR || t === TILES.BRIDGE
    || t === TILES.PATH || t === TILES.FLOOR;
  if (!passable) return;
  walk = {
    fromPx: ox * TILE, fromPy: oy * TILE,
    toPx: nx * TILE, toPy: ny * TILE,
    start: animTime, dur: WALK_DUR,
  };
  // Footstep dust puff at the tile just left behind (2D mode only).
  if (viewMode === "2d") spawnFootstepDust(ox, oy);
  state.player.x = nx; state.player.y = ny;
  state.steps++;

  // Auto-interact with the boss tile.
  const fx = findInteractable(nx, ny);
  if (fx && fx.kind === "boss" && !state.flags.boss_defeated) {
    return triggerBoss(fx, { ox, oy });
  }
  if (fx && fx.kind === "midboss" && !state.flags["mid_" + fx.enemy]) {
    return triggerMidBoss(fx, { ox, oy });
  }

  // Random encounter check (skip on shrine / interactive tiles).
  const enc = encounterTable(nx, ny);
  if (enc && Math.random() < enc.rate) {
    rollEncounter(enc);
    render(); return;
  }

  render();
}

function rollEncounter(enc) {
  const count = 1 + (Math.random() < 0.4 ? 1 : 0);
  const ids = [];
  for (let i = 0; i < count; i++) {
    ids.push(enc.pool[Math.floor(Math.random() * enc.pool.length)]);
  }
  state.phase = "combat";
  startCombat(state, ids, { onResolved: combatResolved });
  showCombatMenu();
}

function triggerMidBoss(fx, prev) {
  state.log("lore", fx.intro);
  state.phase = "combat";
  startCombat(state, [fx.enemy], { boss: true, onResolved: (outcome) => {
    state.phase = "explore";
    hideOverlay();
    if (outcome === "win") {
      state.flags["mid_" + fx.enemy] = true;
      state.log("gold", "The herald falls. The way is open.");
    } else if (outcome === "lose") {
      state.phase = "gameover"; showGameOver(); return;
    }
    if (prev && outcome !== "win") {
      state.player.x = prev.ox; state.player.y = prev.oy;
    }
    render();
  }});
  showCombatMenu();
}

function triggerBoss(fx, prev) {
  if (SHRINES.filter(s => state.flags[s.id]).length < 3) {
    state.log("lore", "The cavern hums with malice. Three shrines must blaze before you may enter.");
    if (prev) { state.player.x = prev.ox; state.player.y = prev.oy; }
    render();
    return;
  }
  state.log("lore", fx.intro);
  state.phase = "combat";
  startCombat(state, [fx.enemy], { boss: true, onResolved: combatResolved });
  showCombatMenu();
}

function combatResolved(outcome) {
  state.phase = "explore";
  hideOverlay();
  if (outcome === "lose") {
    state.phase = "gameover";
    showGameOver();
    return;
  }
  if (state.flags.boss_defeated) {
    state.phase = "victory";
    showVictory();
    return;
  }
  render();
}

function interactAt(x, y) {
  const candidates = [[x, y], [x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]];
  for (const [cx, cy] of candidates) {
    const fx = findInteractable(cx, cy);
    if (!fx) continue;
    if (fx.kind === "shrine") return interactShrine(fx);
    if (fx.kind === "chest") return interactChest(fx);
    if (fx.kind === "statue") return interactStatue(fx);
    if (fx.kind === "recruit") return interactRecruit(fx);
    if (fx.kind === "npc") return interactNpc(fx);
    if (fx.kind === "questitem") return interactQuestItem(fx);
    if (fx.kind === "campfire") return interactCampfire(fx);
    if (fx.kind === "midboss") return triggerMidBoss(fx);
    if (fx.kind === "boss") return triggerBoss(fx);
  }
  state.log("sys", "Nothing here calls to you.");
}

function interactNpc(n) {
  if (n.id === "hithon") {
    const hasStone = state.inventory.lore_stone > 0;
    const done = state.flags["quest_hithon_done"];
    if (done) {
      state.log("lore", n.after);
      return;
    }
    if (hasStone) {
      state.flags["quest_hithon_done"] = true;
      state.inventory.lore_stone = 0;
      state.gold += 50;
      // Award the star robe to the mage who needs it most.
      const mage = state.party.find(m => m.classKind === "mage");
      if (mage) {
        mage.equipped = mage.equipped || {};
        // Return any prior armor to the pack.
        if (mage.equipped.armor) {
          const prev = mage.equipped.armor;
          state.inventory["eq:" + prev] = (state.inventory["eq:" + prev] || 0) + 1;
          const pe = EQUIPMENT[prev];
          if (pe?.hp) { mage.maxHp -= pe.hp; if (mage.hp > mage.maxHp) mage.hp = mage.maxHp; }
          if (pe?.mp) { mage.maxMp -= pe.mp; if (mage.mp > mage.maxMp) mage.mp = mage.maxMp; }
        }
        mage.equipped.armor = "star_robe";
        const e = EQUIPMENT.star_robe;
        if (e.hp) mage.maxHp += e.hp;
        if (e.mp) mage.maxMp += e.mp;
        state.log("gold", `${mage.name} dons the Star-Spun Robe.`);
      }
      // Permanent +5 max HP for whole party.
      for (const m of state.party) { m.maxHp += 5; m.hp += 5; }
      state.log("lore", n.has_stone);
      state.log("gold", "Each member gains +5 max HP. (+50 silver)");
      return;
    }
    state.log("lore", n.intro);
    state.log("sys", n.no_quest_yet);
  }
}

function interactQuestItem(q) {
  if (state.flags["got_" + q.id]) {
    state.log("sys", "An empty hollow.");
    return;
  }
  state.flags["got_" + q.id] = true;
  state.inventory[q.id] = (state.inventory[q.id] || 0) + 1;
  state.log("lore", q.flavor);
}

function interactCampfire(cf) {
  const usedKey = "camp_used_" + cf.id;
  if (state.flags[usedKey]) {
    state.log("sys", "The campfire's warmth has faded for now.");
    return;
  }
  state.flags[usedKey] = true;
  for (const m of state.party) {
    if (m.dead) { m.dead = false; m.hp = Math.floor(m.maxHp / 2); }
    else { m.hp = m.maxHp; m.mp = m.maxMp; }
    m.statuses = (m.statuses || []).filter(s => s.id !== "poison");
  }
  state.log("heal", "You rest by the campfire. The party is restored.");
}

function interactShrine(s) {
  if (!state.flags[s.id]) {
    state.flags[s.id] = true;
    state.log("lore", `You kindle ${s.name}. ${s.blessing}`);
    if (s.id === "shrine_hall") {
      for (const m of state.party) {
        if (m.dead) { m.dead = false; m.hp = Math.floor(m.maxHp / 2); }
        else { m.hp = m.maxHp; m.mp = m.maxMp; }
      }
    }
    return;
  }
  // Already lit — offer an offering for a permanent buff (once per shrine).
  const offered = state.flags["offered_" + s.id];
  if (offered) {
    state.log("lore", `${s.name} burns clean. Your offering has been received.`);
    return;
  }
  showOverlay(`
    <h1>${s.name}</h1>
    <p>The shrine's light warms your face.</p>
    <p>Donate <b>30 silver</b> for a permanent boon: pick a hero and a stat.</p>
    <h2>Pick a hero</h2>
    <div class="row">
      ${state.party.map((m, i) => `<button data-hero="${i}">${m.name}</button>`).join("")}
    </div>
    <div id="sub"></div>
    <div class="row"><button data-close>Close</button></div>
  `, {
    "[data-hero]": (ev, el) => {
      const i = Number(el.dataset.hero);
      const sub = overlayEl.querySelector("#sub");
      sub.innerHTML = `
        <h2>${state.party[i].name} — pick a stat</h2>
        <div class="row">
          <button data-stat="atk">+1 ATK</button>
          <button data-stat="def">+1 DEF</button>
          <button data-stat="hp">+8 max HP</button>
        </div>`;
      for (const b of sub.querySelectorAll("button[data-stat]")) {
        b.addEventListener("click", () => {
          if (state.gold < 30) { state.log("sys", "You lack the silver."); return; }
          state.gold -= 30;
          const stat = b.dataset.stat;
          const m = state.party[i];
          if (stat === "atk") m.atk += 1;
          else if (stat === "def") m.def += 1;
          else { m.maxHp += 8; m.hp += 8; }
          state.flags["offered_" + s.id] = true;
          state.log("gold", `${m.name} is blessed with ${stat === "hp" ? "+8 max HP" : "+1 " + stat.toUpperCase()}.`);
          hideOverlay();
        });
      }
    },
    "[data-close]": () => hideOverlay(),
  });
}

function interactChest(c) {
  const k = "chest_" + c.x + "_" + c.y;
  if (state.flags[k]) {
    state.log("sys", "The chest is empty.");
    return;
  }
  state.flags[k] = true;
  for (const it of c.items) {
    if (it.id === "gold") { state.gold += it.n; state.log("gold", `Found ${it.n} silver.`); }
    else if (it.id.startsWith("equip:")) {
      const eqid = it.id.slice("equip:".length);
      state.inventory["eq:" + eqid] = (state.inventory["eq:" + eqid] || 0) + it.n;
      state.log("gold", `Found ${EQUIPMENT[eqid].name}.`);
    } else if (ITEMS[it.id]) {
      state.inventory[it.id] = (state.inventory[it.id] || 0) + it.n;
      state.log("gold", `Found ${it.n} × ${ITEMS[it.id].name}.`);
    }
  }
}

function interactStatue(s) {
  for (const ln of s.lines) state.log("lore", ln);
  render();
}

function interactRecruit(r) {
  if (state.flags["recruit_" + r.id]) {
    state.log("sys", "They have already gone with you.");
    return;
  }
  state.log("lore", r.intro);
  if (state.party.length < MAX_PARTY) {
    showOverlay(`
      <h1>${HEROES[r.id].name} ${HEROES[r.id].title}</h1>
      <p>${r.intro}</p>
      <div class="row">
        <button data-yes>Welcome them</button>
        <button data-no>Decline</button>
      </div>
    `, {
      "[data-yes]": () => { addRecruit(r); hideOverlay(); },
      "[data-no]": () => { hideOverlay(); state.log("sys", "You walk on alone."); },
    });
  } else {
    // Party full — pick someone to dismiss.
    const opts = state.party.map((m, i) =>
      `<button data-swap="${i}">${m.name} (Lvl ${m.lvl})</button>`).join("");
    showOverlay(`
      <h1>Replace whom for ${HEROES[r.id].name}?</h1>
      <p>${r.intro}</p>
      <p>Your fellowship is full. Dismiss one to make room:</p>
      <div class="row">${opts}</div>
      <div class="row"><button data-no>Decline</button></div>
    `, {
      "[data-swap]": (ev, el) => {
        const i = Number(el.dataset.swap);
        const old = state.party[i];
        state.party.splice(i, 1);
        state.log("sys", `${old.name} bids you farewell.`);
        addRecruit(r);
        hideOverlay();
      },
      "[data-no]": () => { hideOverlay(); state.log("sys", "You walk on alone."); },
    });
  }
}

function addRecruit(r) {
  state.party.push(buildHero(r.id));
  state.flags["recruit_" + r.id] = true;
  state.log("gold", r.accepted);
  render();
}

// ----- Combat menu --------------------------------------------------------

function pickWeakestEnemyIdx() {
  const c = state.combat;
  if (!c) return -1;
  let best = -1, bestHp = Infinity;
  for (let i = 0; i < c.enemies.length; i++) {
    const e = c.enemies[i];
    if (e.hp <= 0) continue;
    if (e.hp < bestHp) { best = i; bestHp = e.hp; }
  }
  return best;
}

function showCombatMenu() {
  const c = state.combat;
  if (!c) return;
  const livingParty = state.party.filter(m => !m.dead);
  const plan = new Array(livingParty.length).fill(null);
  let idx = 0;

  function step() {
    if (idx >= livingParty.length) {
      queuePartyActions(state, plan);
      resolveLoop();
      return;
    }
    const actor = livingParty[idx];
    const enemyButtons = c.enemies.map((e, i) =>
      e.hp > 0 ? `<button data-eid="${i}">${e.name} (${e.hp}/${e.maxHp})</button>` : "").join("");
    const allyButtons = state.party.map((m, i) =>
      !m.dead ? `<button data-aid="${i}">${m.name} (${m.hp}/${m.maxHp})</button>` : "").join("");

    const spellOptions = actor.spells.map(id => {
      const sp = SPELLS[id];
      const dis = actor.mp < sp.mp ? "disabled" : "";
      return `<button data-spell="${id}" ${dis}>${sp.name} (${sp.mp} MP)</button>`;
    }).join("");

    const itemOptions = Object.entries(state.inventory)
      .filter(([id, n]) => n > 0)
      .map(([id]) => `<button data-item="${id}">${ITEMS[id].name} ×${state.inventory[id]}</button>`)
      .join("") || "<i>(no items)</i>";

    showOverlay(`
      <h1>Combat — ${actor.name}'s turn</h1>
      <div>HP ${actor.hp}/${actor.maxHp}  MP ${actor.mp}/${actor.maxMp}</div>
      <h2>Action</h2>
      <div class="row">
        <button data-act="attack">Attack (weakest)</button>
        <button data-act="attack-pick">Target...</button>
        ${actor.spells.length ? `<button data-act="spell">Spell</button>` : ""}
        <button data-act="item">Item</button>
        <button data-act="defend">Defend</button>
        <button data-act="flee">Flee</button>
      </div>
      <div id="sub"></div>
    `, {
      "[data-act=attack]": () => {
        const targetIdx = pickWeakestEnemyIdx();
        if (targetIdx < 0) return;
        commit({ kind: "attack", targetIdx });
      },
      "[data-act=attack-pick]": () => pickEnemyTarget(actor, "attack"),
      "[data-act=spell]":  () => showSpellPicker(actor),
      "[data-act=item]":   () => showItemPicker(actor),
      "[data-act=defend]": () => commit({ kind: "defend" }),
      "[data-act=flee]":   () => commit({ kind: "flee" }),
    });

    function pickEnemyTarget(_actor, kind) {
      const sub = overlayEl.querySelector("#sub");
      sub.innerHTML = `<h2>Target</h2><div class="row">${enemyButtons}</div>`;
      for (const b of sub.querySelectorAll("button[data-eid]")) {
        b.addEventListener("click", () => {
          commit({ kind, targetIdx: Number(b.dataset.eid) });
        });
      }
    }
    function pickAllyTarget(then) {
      const sub = overlayEl.querySelector("#sub");
      sub.innerHTML = `<h2>Target ally</h2><div class="row">${allyButtons}</div>`;
      for (const b of sub.querySelectorAll("button[data-aid]")) {
        b.addEventListener("click", () => then(Number(b.dataset.aid)));
      }
    }
    function showSpellPicker(_actor) {
      const sub = overlayEl.querySelector("#sub");
      sub.innerHTML = `<h2>Spell</h2><div class="row">${spellOptions}</div>`;
      for (const b of sub.querySelectorAll("button[data-spell]")) {
        b.addEventListener("click", () => {
          const sid = b.dataset.spell;
          const sp = SPELLS[sid];
          if (sp.target === "ally") pickAllyTarget(aid => commit({ kind: "spell", spellId: sid, targetIdx: aid }));
          else pickEnemyTargetForSpell(sid);
        });
      }
    }
    function pickEnemyTargetForSpell(sid) {
      const sub = overlayEl.querySelector("#sub");
      sub.innerHTML = `<h2>Target</h2><div class="row">${enemyButtons}</div>`;
      for (const b of sub.querySelectorAll("button[data-eid]")) {
        b.addEventListener("click", () => {
          commit({ kind: "spell", spellId: sid, targetIdx: Number(b.dataset.eid) });
        });
      }
    }
    function showItemPicker(_actor) {
      const sub = overlayEl.querySelector("#sub");
      sub.innerHTML = `<h2>Item</h2><div class="row">${itemOptions}</div>`;
      for (const b of sub.querySelectorAll("button[data-item]")) {
        b.addEventListener("click", () => {
          const iid = b.dataset.item;
          const it = ITEMS[iid];
          if (it.target === "party") commit({ kind: "item", itemId: iid });
          else pickAllyTarget(aid => commit({ kind: "item", itemId: iid, targetIdx: aid }));
        });
      }
    }
    function commit(p) { plan[idx] = p; idx++; step(); }
  }
  step();
}

function resolveLoop() {
  showOverlay(`<h1>The clash...</h1><div class="row"><button data-skip="all">Resolve</button></div>`, {
    "[data-skip=all]": () => {
      let safety = 64;
      while (safety-- > 0) {
        const done = tickResolve(state);
        if (done) break;
      }
      render();
      // If combat is still active, replace the overlay with the next round's
      // command menu. Otherwise, leave the overlay alone — endCombat may have
      // already shown a victory or game-over panel via combatResolved.
      if (state.combat &&
          state.combat.phase === "command" &&
          state.combat.enemies.some(e => e.hp > 0) &&
          state.party.some(m => !m.dead)) {
        showCombatMenu();
      }
    },
  });
}

// ----- Save / Load --------------------------------------------------------

const SAVE_KEY_PREFIX = "shadows_of_rivendell_v2_slot_";
const NUM_SLOTS = 3;

function readSlot(slot) {
  try {
    const raw = localStorage.getItem(SAVE_KEY_PREFIX + slot);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function snapshotState() {
  return {
    when: Date.now(),
    player: state.player,
    party: state.party.map(m => ({
      id: m.id, lvl: m.lvl, xp: m.xp,
      maxHp: m.maxHp, hp: m.hp, maxMp: m.maxMp, mp: m.mp,
      atk: m.atk, def: m.def, spd: m.spd, dead: m.dead,
      equipped: m.equipped || {}, statuses: m.statuses || [],
    })),
    inventory: state.inventory,
    gold: state.gold,
    steps: state.steps,
    flags: state.flags,
    difficulty: state.difficulty || "normal",
  };
}

function applySnapshot(snap) {
  state.player = snap.player;
  state.party = snap.party.map(s => {
    const fresh = buildHero(s.id);
    Object.assign(fresh, s);
    fresh.equipped = s.equipped || {};
    fresh.statuses = s.statuses || [];
    return fresh;
  });
  state.inventory = snap.inventory;
  state.gold = snap.gold;
  state.steps = snap.steps;
  state.flags = snap.flags || {};
  applyDifficulty(snap.difficulty || "normal");
  state.phase = "explore";
}

function showSaveSlots() {
  if (state.phase !== "explore") {
    state.log("sys", "You may not save mid-battle.");
    return;
  }
  const slots = [];
  for (let i = 1; i <= NUM_SLOTS; i++) {
    const s = readSlot(i);
    const desc = s
      ? `Lvl ${s.party[0].lvl} ${s.party[0].name} — silver ${s.gold}, steps ${s.steps}`
      : "<i>Empty</i>";
    slots.push(`<li>Slot ${i}: ${desc} <button data-save="${i}">Save here</button></li>`);
  }
  showOverlay(`
    <h1>Save Tale</h1>
    <ul>${slots.join("")}</ul>
    <div class="row"><button data-close>Close</button></div>
  `, {
    "[data-save]": (ev, el) => {
      const slot = Number(el.dataset.save);
      try {
        localStorage.setItem(SAVE_KEY_PREFIX + slot, JSON.stringify(snapshotState()));
        state.log("sys", `Saved to slot ${slot}.`);
        hideOverlay();
      } catch (e) { state.log("sys", "Save failed."); }
    },
    "[data-close]": () => hideOverlay(),
  });
}

function showLoadSlots() {
  const slots = [];
  for (let i = 1; i <= NUM_SLOTS; i++) {
    const s = readSlot(i);
    const desc = s
      ? `Lvl ${s.party[0].lvl} ${s.party[0].name} — silver ${s.gold}, steps ${s.steps}`
      : "<i>Empty</i>";
    slots.push(`<li>Slot ${i}: ${desc} ${s ? `<button data-load="${i}">Load</button>` : ""}</li>`);
  }
  showOverlay(`
    <h1>Load Tale</h1>
    <ul>${slots.join("")}</ul>
    <div class="row"><button data-close>Close</button></div>
  `, {
    "[data-load]": (ev, el) => {
      const slot = Number(el.dataset.load);
      const s = readSlot(slot);
      if (!s) return;
      applySnapshot(s);
      hideOverlay();
      state.log("sys", `Loaded slot ${slot}.`);
    },
    "[data-close]": () => hideOverlay(),
  });
}

// Legacy function kept for the touch action button.
function saveGame() { showSaveSlots(); }
function loadGame() {
  // Find first non-empty slot for an immediate auto-load (used by title F9).
  for (let i = 1; i <= NUM_SLOTS; i++) {
    const s = readSlot(i);
    if (s) { applySnapshot(s); state.log("sys", `Loaded slot ${i}.`); return true; }
  }
  state.log("sys", "No saved tale.");
  return false;
}

// ----- Inventory / Character sheet ---------------------------------------

function showInventory() {
  const itemEntries = Object.entries(state.inventory)
    .filter(([id, n]) => n > 0 && !id.startsWith("eq:") && id !== "lore_stone");
  const items = itemEntries.length
    ? itemEntries.map(([id, n]) =>
        `<li><b>${ITEMS[id]?.name || id}</b> ×${n}${ITEMS[id]?.desc ? ` — <i>${ITEMS[id].desc}</i>` : ""}</li>`).join("")
    : "<li><i>Nothing.</i></li>";

  const eqEntries = Object.entries(state.inventory)
    .filter(([id, n]) => id.startsWith("eq:") && n > 0);
  const eqList = eqEntries.length
    ? eqEntries.map(([id, n]) => {
        const eqid = id.slice(3);
        const e = EQUIPMENT[eqid];
        if (!e) return "";
        const bonus = [
          e.atk ? `+${e.atk} ATK` : null,
          e.def ? `+${e.def} DEF` : null,
          e.hp ? `+${e.hp} HP` : null,
          e.mp ? `+${e.mp} MP` : null,
        ].filter(Boolean).join(", ");
        return `<li><b>${e.name}</b> ×${n} <i>(${e.slot}: ${bonus})</i></li>`;
      }).join("")
    : "<li><i>Nothing.</i></li>";

  showOverlay(`
    <h1>Pack</h1>
    <h2>Items</h2><ul>${items}</ul>
    <h2>Equipment</h2><ul>${eqList}</ul>
    <div>Silver: ${state.gold}</div>
    <div class="row">
      <button data-equip>Equip / Unequip</button>
      <button data-close>Close</button>
    </div>
  `, {
    "[data-equip]": () => showEquipMenu(),
    "[data-close]": () => hideOverlay(),
  });
}

function showEquipMenu() {
  const heroOpts = state.party.map((m, i) => {
    const eq = m.equipped || {};
    const w = eq.weapon ? EQUIPMENT[eq.weapon].name : "—";
    const a = eq.armor ? EQUIPMENT[eq.armor].name : "—";
    const t = eq.trinket ? EQUIPMENT[eq.trinket].name : "—";
    return `<li><b>${m.name}</b> — wpn: ${w}, armor: ${a}, trinket: ${t}
      <div class="row">
        <button data-equip-hero="${i}" data-slot="weapon">Weapon</button>
        <button data-equip-hero="${i}" data-slot="armor">Armor</button>
        <button data-equip-hero="${i}" data-slot="trinket">Trinket</button>
      </div></li>`;
  }).join("");
  showOverlay(`
    <h1>Equip</h1>
    <ul>${heroOpts}</ul>
    <div class="row"><button data-close>Close</button></div>
  `, {
    "[data-equip-hero]": (ev, el) => {
      const heroIdx = Number(el.dataset["equipHero"]);
      const slot = el.dataset.slot;
      pickEquipForSlot(heroIdx, slot);
    },
    "[data-close]": () => showInventory(),
  });
}

function pickEquipForSlot(heroIdx, slot) {
  const m = state.party[heroIdx];
  const owned = Object.entries(state.inventory)
    .filter(([id, n]) => id.startsWith("eq:") && n > 0)
    .map(([id]) => id.slice(3))
    .filter(eqid => EQUIPMENT[eqid].slot === slot && eligibleSlots(m.classKind, eqid));
  const cur = (m.equipped || {})[slot];
  const choices = owned.map(eqid =>
    `<button data-pick="${eqid}">${EQUIPMENT[eqid].name}</button>`).join("");
  showOverlay(`
    <h1>${m.name} — ${slot}</h1>
    <p>Currently equipped: <b>${cur ? EQUIPMENT[cur].name : "—"}</b></p>
    <h2>Choose</h2>
    <div class="row">
      ${choices || "<i>No eligible gear.</i>"}
      ${cur ? `<button data-unequip>Unequip</button>` : ""}
    </div>
    <div class="row"><button data-back>Back</button></div>
  `, {
    "[data-pick]": (ev, el) => {
      const newId = el.dataset.pick;
      m.equipped = m.equipped || {};
      // Return current to inventory.
      if (m.equipped[slot]) {
        const k = "eq:" + m.equipped[slot];
        state.inventory[k] = (state.inventory[k] || 0) + 1;
      }
      m.equipped[slot] = newId;
      const k = "eq:" + newId;
      state.inventory[k] -= 1;
      // Apply HP/MP cap bumps from the new piece (if any).
      const e = EQUIPMENT[newId];
      if (e.hp) m.maxHp += e.hp;
      if (e.mp) m.maxMp += e.mp;
      state.log("gold", `${m.name} equips ${e.name}.`);
      showEquipMenu();
    },
    "[data-unequip]": () => {
      const id = m.equipped[slot];
      const e = EQUIPMENT[id];
      if (e.hp) { m.maxHp -= e.hp; if (m.hp > m.maxHp) m.hp = m.maxHp; }
      if (e.mp) { m.maxMp -= e.mp; if (m.mp > m.maxMp) m.mp = m.maxMp; }
      const k = "eq:" + id;
      state.inventory[k] = (state.inventory[k] || 0) + 1;
      delete m.equipped[slot];
      state.log("sys", `${m.name} unequips ${e.name}.`);
      showEquipMenu();
    },
    "[data-back]": () => showEquipMenu(),
  });
}

function showQuests() {
  const lit = SHRINES.filter(s => state.flags[s.id]).length;
  const stoneStatus = state.flags["quest_hithon_done"]
    ? "<b>Complete</b> — the Lore Stone burns clear."
    : (state.inventory.lore_stone > 0
        ? "<b>Return the Lore Stone to Hithon</b> at the bridge."
        : "Find the <b>Lost Lore Stone</b> in the burial grove.");
  showOverlay(`
    <h1>Journal</h1>
    <h2>Main Quest</h2>
    <p>Kindle the three shrines: <b>${lit}/3</b>. Then descend to the cavern beneath the Vale.</p>
    <h2>Hithon's Lore Stone</h2>
    <p>${stoneStatus}</p>
    <div class="row"><button data-close>Close</button></div>
  `, { "[data-close]": () => hideOverlay() });
}

function showParty() {
  const rows = state.party.map(m => `
    <h2>${m.name} ${m.title}</h2>
    <div>Lvl ${m.lvl} — XP ${m.xp}/${30 + m.lvl * 30}</div>
    <div>HP ${m.hp}/${m.maxHp}    MP ${m.mp}/${m.maxMp}</div>
    <div>ATK ${m.atk}    DEF ${m.def}    SPD ${m.spd}</div>
    <div>Spells: ${m.spells.length ? m.spells.map(s => SPELLS[s].name).join(", ") : "—"}</div>
  `).join("<hr/>");
  showOverlay(`
    <h1>The Fellowship</h1>
    ${rows}
    <div class="row"><button data-close>Close</button></div>
  `, { "[data-close]": () => hideOverlay() });
}

// ----- Game over / Victory -----------------------------------------------

function showGameOver() {
  showOverlay(`
    <h1>Rivendell Falls</h1>
    <p>The shadow lengthens. Imladris is undone.</p>
    <div class="row">
      <button data-restart>Begin Again</button>
      <button data-load>Load Saved Tale</button>
    </div>
  `, {
    "[data-restart]": () => { newGame(); },
    "[data-load]": () => { loadGame(); },
  });
}

function showVictory() {
  showOverlay(`
    <h1>The Vale Restored</h1>
    <p>The Wraith-Lord is unmade. The Bruinen runs clear once more, and Imladris breathes.</p>
    <p>Final tally — silver ${state.gold}, steps ${state.steps}.</p>
    <div class="row">
      <button data-restart>Walk Again</button>
    </div>
  `, { "[data-restart]": () => { newGame(); } });
}

// ----- Title / New Game --------------------------------------------------

function applyDifficulty(diff) {
  state.difficulty = diff;
  if (diff === "easy") { state.difficultyScale = 0.75; state.xpMult = 1.0; }
  else if (diff === "hard") { state.difficultyScale = 1.4; state.xpMult = 1.5; }
  else { state.difficultyScale = 1.0; state.xpMult = 1.0; }
}

function startNewGame(diff) {
  applyDifficulty(diff || "normal");
  state.phase = "explore";
  state.player = { x: SPAWN.x, y: SPAWN.y, facing: "south", anim: 0 };
  state.party = buildParty();
  state.inventory = { potion: 2, manabrew: 1, lembas: 1, starflask: 0, blessoil: 0, antidote: 1 };
  state.gold = 25;
  state.steps = 0;
  state.flags = {};
  state.combat = null;
  hideOverlay();
  logEl.innerHTML = "";
  state.log("lore", "You cross the bridge into Imladris. The river runs black, and the very air weeps.");
  state.log("lore", "Three shrines must be lit before the cavern beneath the Vale will yield.");
  state.log("sys", `Difficulty: ${state.difficulty}.`);
}

function newGame() {
  // Show difficulty picker first.
  showOverlay(`
    <h1>Begin Anew</h1>
    <p>Choose the weight of the Shadow upon Rivendell.</p>
    <div class="row">
      <button data-diff="easy">Easy</button>
      <button data-diff="normal">Normal</button>
      <button data-diff="hard">Hard</button>
    </div>
  `, {
    "[data-diff]": (ev, el) => {
      hideOverlay();
      startNewGame(el.dataset.diff);
    },
  });
}

// ----- Input -------------------------------------------------------------

window.addEventListener("keydown", (ev) => {
  if (state.phase === "title") {
    if (ev.key === "Enter") { newGame(); ev.preventDefault(); }
    if (ev.key === "F9") { if (loadGame()) { ev.preventDefault(); } }
    return;
  }
  if (state.phase === "gameover" || state.phase === "victory") return;
  if (state.combat) return;

  const sprint = ev.shiftKey;
  switch (ev.key) {
    case "ArrowUp": case "w": case "W": moveInput("forward", sprint); ev.preventDefault(); break;
    case "ArrowDown": case "s": case "S": moveInput("back", sprint); ev.preventDefault(); break;
    case "ArrowLeft": case "a": case "A": moveInput("left", sprint); ev.preventDefault(); break;
    case "ArrowRight": case "d": case "D": moveInput("right", sprint); ev.preventDefault(); break;
    case "e": case "E": case " ":
      interactAt(state.player.x, state.player.y); ev.preventDefault(); break;
    case "i": case "I": showInventory(); ev.preventDefault(); break;
    case "c": case "C": showParty(); ev.preventDefault(); break;
    case "m": case "M": miniMapOpen = !miniMapOpen; ev.preventDefault(); break;
    case "q": case "Q": showQuests(); ev.preventDefault(); break;
    case "v": case "V": toggleViewMode(); ev.preventDefault(); break;
    case "Escape": hideOverlay(); miniMapOpen = false; break;
    case "F5": showSaveSlots(); ev.preventDefault(); break;
    case "F9": showLoadSlots(); ev.preventDefault(); break;
  }
});

function toggleViewMode() {
  viewMode = (viewMode === "2d") ? "3d" : "2d";
  // Cancel any in-flight walk tween so view switching is clean.
  walk = null;
  state.log("sys", `View: ${viewMode === "3d" ? "first-person" : "top-down"}.`);
}

// Direction-input dispatcher that respects the active view mode.
//   2D: left/right/forward/back are absolute compass directions (N/S/E/W).
//   3D: forward/back move along facing; left/right turn 90 degrees.
function moveInput(action, sprint) {
  if (viewMode === "3d") {
    if (action === "forward") {
      const v = facingVector(state.player.facing);
      stepMove(v[0], v[1], sprint);
    } else if (action === "back") {
      const v = facingVector(state.player.facing);
      stepMove(-v[0], -v[1], sprint);
    } else if (action === "left") {
      state.player.facing = turnLeft(state.player.facing);
    } else if (action === "right") {
      state.player.facing = turnRight(state.player.facing);
    }
    return;
  }
  // 2D top-down.
  if (action === "forward") stepMove(0, -1, sprint);
  else if (action === "back") stepMove(0, 1, sprint);
  else if (action === "left") stepMove(-1, 0, sprint);
  else if (action === "right") stepMove(1, 0, sprint);
}

function stepMove(dx, dy, sprint) {
  if (!sprint) { tryMove(dx, dy); return; }
  // Sprint: try to move two tiles at once if both target tiles are on a path.
  const ox = state.player.x, oy = state.player.y;
  const t1 = state.grid[oy + dy]?.[ox + dx];
  if (t1 !== TILES.PATH && t1 !== TILES.FLOOR && t1 !== TILES.BRIDGE) {
    tryMove(dx, dy); return;
  }
  const t2 = state.grid[oy + dy * 2]?.[ox + dx * 2];
  if (t2 !== TILES.PATH && t2 !== TILES.FLOOR && t2 !== TILES.BRIDGE) {
    tryMove(dx, dy); return;
  }
  // Two-tile move (skip the intermediate; encounter check on the final tile).
  state.player.x = ox + dx * 2;
  state.player.y = oy + dy * 2;
  state.player.facing = dx < 0 ? "west" : dx > 0 ? "east" : dy < 0 ? "north" : "south";
  walk = {
    fromPx: ox * TILE, fromPy: oy * TILE,
    toPx: state.player.x * TILE, toPy: state.player.y * TILE,
    start: animTime, dur: WALK_DUR,
  };
  state.steps += 2;
  const enc = encounterTable(state.player.x, state.player.y);
  if (enc && Math.random() < enc.rate) rollEncounter(enc);
}

// ----- Touch input -------------------------------------------------------

function moveDir(dir) {
  switch (dir) {
    case "up":    moveInput("forward", false); break;
    case "down":  moveInput("back", false); break;
    case "left":  moveInput("left", false); break;
    case "right": moveInput("right", false); break;
  }
}

function bindHoldRepeat(el, fire) {
  let timer = null;
  let pressed = false;
  const start = (ev) => {
    if (ev) ev.preventDefault();
    if (pressed) return;
    pressed = true;
    fire();
    timer = setInterval(() => {
      if (!pressed) return;
      fire();
    }, 170);
  };
  const stop = () => {
    pressed = false;
    if (timer) { clearInterval(timer); timer = null; }
  };
  el.addEventListener("touchstart", start, { passive: false });
  el.addEventListener("touchend", stop);
  el.addEventListener("touchcancel", stop);
  el.addEventListener("mousedown", start);
  el.addEventListener("mouseup", stop);
  el.addEventListener("mouseleave", stop);
  // Prevent native context menu on long-press.
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

function actionFor(act) {
  if (state.phase === "title") {
    if (act === "interact") newGame();
    else if (act === "load") loadGame();
    return;
  }
  if (state.phase === "gameover" || state.phase === "victory") {
    // Let overlay buttons handle these via their own click handlers.
    return;
  }
  if (state.combat) return; // combat handled by its own DOM overlay
  switch (act) {
    case "interact": interactAt(state.player.x, state.player.y); break;
    case "view": toggleViewMode(); break;
    case "map": miniMapOpen = !miniMapOpen; break;
    case "inventory": showInventory(); break;
    case "party": showParty(); break;
    case "save": showSaveSlots(); break;
    case "load": showLoadSlots(); break;
  }
}

function bindTouchControls() {
  for (const btn of document.querySelectorAll("#dpad .dp")) {
    bindHoldRepeat(btn, () => moveDir(btn.dataset.dir));
  }
  for (const btn of document.querySelectorAll("#actions .ab")) {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      actionFor(btn.dataset.act);
    });
  }
  // Tap on the canvas during the title screen acts as Enter.
  screen.addEventListener("touchend", (ev) => {
    if (state.phase === "title") {
      ev.preventDefault();
      newGame();
    }
  }, { passive: false });
  screen.addEventListener("click", () => {
    if (state.phase === "title") newGame();
  });
  // Stop touch scrolling when interacting with controls.
  for (const sel of ["#dpad", "#actions", "#overlay"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    el.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }
}

// ----- Boot --------------------------------------------------------------

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function facingVector(f) {
  if (f === "north") return [0, -1];
  if (f === "south") return [0,  1];
  if (f === "east")  return [1,  0];
  if (f === "west")  return [-1, 0];
  return [0, 1];
}
function leftVector(f) {
  // 90° counter-clockwise from facing.
  if (f === "north") return [-1, 0];
  if (f === "south") return [1, 0];
  if (f === "east")  return [0, -1];
  if (f === "west")  return [0, 1];
  return [-1, 0];
}
function turnLeft(f)  { return ({ north: "west", west: "south", south: "east", east: "north" })[f] || "south"; }
function turnRight(f) { return ({ north: "east", east: "south", south: "west", west: "north" })[f] || "south"; }

function inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

// Tiles that visually block the corridor view in 3D mode.
function isViewBlocking(id) {
  if (id == null) return true; // out of bounds = wall
  return id === TILES.WALL || id === TILES.WATER || id === TILES.TREE
      || id === TILES.FOUNTAIN || id === TILES.STATUE || id === TILES.GRAVE;
}

// Frames define the inset rectangle of the corridor at each depth, with
// frames[0] = full canvas and successive frames shrinking toward the
// vanishing point.
const VIEW_FRAMES = [
  { x0: 0,   y0: 0,   x1: 320, y1: 240 },
  { x0: 48,  y0: 36,  x1: 272, y1: 204 },
  { x0: 96,  y0: 72,  x1: 224, y1: 168 },
  { x0: 132, y0: 100, x1: 188, y1: 140 },
  { x0: 152, y0: 114, x1: 168, y1: 126 },
];

function render3D() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Combat shake also wobbles the first-person frame.
  let shakeX = 0, shakeY = 0;
  if (animTime < fx.shake.until) {
    const k = (fx.shake.until - animTime) / 200;
    shakeX = (Math.random() - 0.5) * fx.shake.mag * k;
    shakeY = (Math.random() - 0.5) * fx.shake.mag * k;
  }
  ctx.save();
  ctx.translate(shakeX, shakeY);

  // Sky / ceiling with subtle horizontal banding.
  const ceil = ctx.createLinearGradient(0, 0, 0, VIEW_H / 2);
  ceil.addColorStop(0, "#05070e");
  ceil.addColorStop(1, "#15192a");
  ctx.fillStyle = ceil;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H / 2);

  // Floor (perspective shading toward vanishing point).
  for (let y = VIEW_H / 2; y < VIEW_H; y++) {
    const t = (y - VIEW_H / 2) / (VIEW_H / 2);
    const r = Math.round(20 + t * 30);
    const g = Math.round(20 + t * 26);
    const b = Math.round(28 + t * 14);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, VIEW_W, 1);
  }
  // Floor herringbone hint.
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const y = VIEW_H / 2 + i * 18 + 6;
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(VIEW_W, y); ctx.stroke();
  }
  // Vanishing point lines on the floor.
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  for (let i = 0; i <= 8; i++) {
    const x = i * 40;
    ctx.beginPath();
    ctx.moveTo(x, VIEW_H);
    ctx.lineTo(160, VIEW_H / 2);
    ctx.stroke();
  }

  const dirVec = facingVector(state.player.facing);
  const lvec = leftVector(state.player.facing);

  // Collect entities to draw at each depth (with side: -1 left, 0 forward, +1 right).
  const visibleProps = []; // { d, side, kind, payload }
  const facingForward = (d) => [state.player.x + dirVec[0] * d, state.player.y + dirVec[1] * d];
  function tileAt(x, y) {
    if (!inBounds(x, y)) return null;
    let id = state.grid[y][x];
    if (id === TILES.SHRINE) {
      const sh = SHRINES.find(s => s.x === x && s.y === y);
      if (sh && state.flags[sh.id]) id = TILES.SHRINE_LIT;
    } else if (id === TILES.CHEST) {
      const c = CHESTS.find(c => c.x === x && c.y === y);
      if (c && state.flags["chest_" + c.x + "_" + c.y]) id = TILES.CHEST_OPEN;
    }
    return id;
  }

  // Far-to-near, so closer panels paint over farther ones.
  for (let d = 4; d >= 1; d--) {
    const [tx, ty] = facingForward(d);
    if (!inBounds(tx, ty)) continue;
    const tile = tileAt(tx, ty);

    // Side walls between (d-1) and (d).
    const ltx = tx + lvec[0], lty = ty + lvec[1];
    const ltile = tileAt(ltx, lty);
    if (isViewBlocking(ltile)) {
      drawSideWall(VIEW_FRAMES[d - 1], VIEW_FRAMES[d], "left", ltile, d);
    }
    const rtx = tx - lvec[0], rty = ty - lvec[1];
    const rtile = tileAt(rtx, rty);
    if (isViewBlocking(rtile)) {
      drawSideWall(VIEW_FRAMES[d - 1], VIEW_FRAMES[d], "right", rtile, d);
    }

    // Entity props on side tiles (recruits, NPCs, chests etc.) - simplified, only forward axis.

    if (isViewBlocking(tile)) {
      drawFrontWall(VIEW_FRAMES[d], tile, d);
    } else {
      // Open passage. Render forward decorations (door, shrine, chest).
      if (tile === TILES.DOOR) drawDoorAtDepth(VIEW_FRAMES[d - 1], VIEW_FRAMES[d]);
      // Static interactables visible ahead.
      const fx = findInteractable(tx, ty);
      if (fx) visibleProps.push({ d, fx, tile });
    }
  }

  // Draw forward props (back-to-front is already by depth ordering: we want larger=closer drawn on top).
  visibleProps.sort((a, b) => b.d - a.d);
  for (const p of visibleProps) drawForwardProp(p);

  // Vignette + lighting darken corners.
  const grd = ctx.createRadialGradient(160, 120, 60, 160, 120, 200);
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.restore();

  // Floating reward text renders centered for the first-person view.
  if (worldFloats.length) {
    ctx.save();
    ctx.font = "bold 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    let i = 0;
    for (const f of worldFloats) {
      const t = (animTime - f.born) / f.dur;
      if (t < 0 || t > 1) continue;
      const a = (1 - t);
      ctx.fillStyle = f.color.replace("ALPHA", a.toFixed(2));
      ctx.fillText(f.text, VIEW_W / 2, VIEW_H / 2 - 30 - t * 24 - i * 12);
      i++;
    }
    ctx.restore();
    ctx.textAlign = "left";
  }

  // Compass + UI overlays render in screen-space (no shake).
  drawCompass(state.player.facing);

  if (state.combat) renderCombatVeil(0, 0);
  if (miniMapOpen) renderMiniMap();
  renderHUD();
}

function depthShade(d, base) {
  const k = Math.max(0.25, 1 - (d - 1) * 0.18);
  return base.map(c => Math.round(c * k));
}
function rgb([r, g, b]) { return `rgb(${r},${g},${b})`; }

function frontFillFor(tile, d) {
  if (tile === TILES.WALL)     return rgb(depthShade(d, [80, 80, 100]));
  if (tile === TILES.WATER)    return rgb(depthShade(d, [40, 60, 130]));
  if (tile === TILES.TREE)     return rgb(depthShade(d, [40, 70, 50]));
  if (tile === TILES.FOUNTAIN) return rgb(depthShade(d, [110, 130, 150]));
  if (tile === TILES.STATUE)   return rgb(depthShade(d, [120, 130, 150]));
  if (tile === TILES.GRAVE)    return rgb(depthShade(d, [80, 80, 95]));
  return rgb(depthShade(d, [60, 60, 70]));
}

function drawFrontWall(frame, tile, d) {
  ctx.fillStyle = frontFillFor(tile, d);
  ctx.fillRect(frame.x0, frame.y0, frame.x1 - frame.x0, frame.y1 - frame.y0);
  // Brick/etching pattern.
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1;
  const w = frame.x1 - frame.x0, h = frame.y1 - frame.y0;
  const rows = Math.max(2, Math.round(h / 14));
  for (let i = 1; i < rows; i++) {
    const y = frame.y0 + (i / rows) * h;
    ctx.beginPath(); ctx.moveTo(frame.x0, y); ctx.lineTo(frame.x1, y); ctx.stroke();
  }
  for (let r = 0; r < rows; r++) {
    const off = r % 2 === 0 ? 0 : 0.5;
    const cols = 3;
    for (let c = 1; c < cols; c++) {
      const x = frame.x0 + ((c + off) / cols) * w;
      const y0 = frame.y0 + (r / rows) * h;
      const y1 = frame.y0 + ((r + 1) / rows) * h;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    }
  }
  // Tree silhouette overlay.
  if (tile === TILES.TREE) {
    ctx.fillStyle = "rgba(20,30,20,0.5)";
    ctx.beginPath();
    ctx.arc((frame.x0 + frame.x1) / 2, frame.y0 + h * 0.3, h * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
  // Statue silhouette.
  if (tile === TILES.STATUE || tile === TILES.GRAVE) {
    ctx.fillStyle = "rgba(40,40,60,0.6)";
    const cx = (frame.x0 + frame.x1) / 2;
    ctx.fillRect(cx - w * 0.18, frame.y0 + h * 0.25, w * 0.36, h * 0.6);
  }
}

function drawSideWall(near, far, side, tile, d) {
  const x_near = side === "left" ? near.x0 : near.x1;
  const x_far  = side === "left" ? far.x0  : far.x1;
  ctx.beginPath();
  ctx.moveTo(x_near, near.y0);
  ctx.lineTo(x_far,  far.y0);
  ctx.lineTo(x_far,  far.y1);
  ctx.lineTo(x_near, near.y1);
  ctx.closePath();
  ctx.fillStyle = frontFillFor(tile, d);
  ctx.fill();
  // Brick stripes following depth.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x_near, near.y0);
  ctx.lineTo(x_far,  far.y0);
  ctx.lineTo(x_far,  far.y1);
  ctx.lineTo(x_near, near.y1);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1;
  // Horizontal brick rows interpolated.
  const rows = 4;
  for (let r = 1; r < rows; r++) {
    const t = r / rows;
    const y_n = near.y0 + (near.y1 - near.y0) * t;
    const y_f = far.y0 + (far.y1 - far.y0) * t;
    ctx.beginPath();
    ctx.moveTo(x_near, y_n); ctx.lineTo(x_far, y_f); ctx.stroke();
  }
  // Vertical receding line.
  ctx.beginPath();
  ctx.moveTo(x_far, far.y0); ctx.lineTo(x_far, far.y1); ctx.stroke();
  ctx.restore();
}

function drawDoorAtDepth(near, far) {
  // Render a door silhouette in the far frame (a vertical brown rectangle).
  const cx = (far.x0 + far.x1) / 2;
  const w = (far.x1 - far.x0) * 0.5;
  ctx.fillStyle = "rgba(60,40,20,0.85)";
  ctx.fillRect(cx - w / 2, far.y0 + 4, w, far.y1 - far.y0 - 4);
  ctx.fillStyle = "rgba(200,160,90,0.7)";
  ctx.fillRect(cx + w / 2 - 3, (far.y0 + far.y1) / 2, 1, 2);
}

function drawForwardProp({ d, fx, tile }) {
  const frame = VIEW_FRAMES[d - 1];
  const next = VIEW_FRAMES[d];
  const cx = (frame.x0 + frame.x1) / 2;
  const baseY = (frame.y1 + next.y1) / 2;
  const size = (frame.y1 - next.y1) * 0.9;
  if (fx.kind === "shrine") {
    const lit = !!state.flags[fx.id];
    ctx.fillStyle = lit ? "rgba(255,200,90,0.9)" : "rgba(150,160,180,0.8)";
    ctx.fillRect(cx - size * 0.2, baseY - size * 0.6, size * 0.4, size * 0.6);
    if (lit) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      addBloom(cx, baseY - size * 0.4, size, "rgba(255,200,90,0.6)");
      ctx.restore();
    }
  } else if (fx.kind === "chest") {
    const opened = state.flags["chest_" + fx.x + "_" + fx.y];
    ctx.fillStyle = opened ? "rgba(50,30,18,0.9)" : "rgba(120,80,40,0.95)";
    ctx.fillRect(cx - size * 0.25, baseY - size * 0.35, size * 0.5, size * 0.35);
  } else if (fx.kind === "campfire") {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    addBloom(cx, baseY - size * 0.3, size, "rgba(255,140,60,0.7)");
    ctx.restore();
    ctx.fillStyle = "rgba(60,30,10,0.9)";
    ctx.fillRect(cx - size * 0.25, baseY - size * 0.15, size * 0.5, size * 0.15);
  } else if (fx.kind === "recruit") {
    if (!state.flags["recruit_" + fx.id]) {
      const h = HEROES[fx.id];
      if (h) {
        const sx = cx - size * 0.4;
        const sy = baseY - size * 0.9;
        ctx.drawImage(h.sprite, sx, sy, size * 0.8, size * 0.8);
      }
    }
  } else if (fx.kind === "npc") {
    ctx.fillStyle = "rgba(58, 36, 24, 1)";
    ctx.fillRect(cx - size * 0.18, baseY - size * 0.9, size * 0.36, size * 0.3);
    ctx.fillStyle = "rgba(216, 180, 138, 1)";
    ctx.fillRect(cx - size * 0.12, baseY - size * 0.6, size * 0.24, size * 0.2);
    ctx.fillStyle = "rgba(58, 74, 48, 1)";
    ctx.fillRect(cx - size * 0.25, baseY - size * 0.4, size * 0.5, size * 0.4);
  } else if (fx.kind === "questitem") {
    if (!state.flags["got_" + fx.id]) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      addBloom(cx, baseY - size * 0.35, size * 0.7, "rgba(180,210,255,0.7)");
      ctx.restore();
      ctx.fillStyle = "#cfd8e4";
      ctx.fillRect(cx - 3, baseY - size * 0.4, 6, 6);
    }
  } else if (fx.kind === "boss" || fx.kind === "midboss") {
    // intimidating dark blob ahead
    ctx.fillStyle = "rgba(160, 30, 30, 0.85)";
    ctx.fillRect(cx - size * 0.4, baseY - size * 0.95, size * 0.8, size * 0.95);
  }
}

function drawCompass(facing) {
  ctx.save();
  ctx.fillStyle = "rgba(5,7,12,0.78)";
  ctx.fillRect(VIEW_W - 44, 4, 40, 40);
  // Center of compass disc.
  const cx = VIEW_W - 24, cy = 22;
  ctx.fillStyle = "#1a1f30";
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#3a3f55";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.stroke();
  // Cardinal ticks.
  ctx.fillStyle = "#7a8898";
  ctx.font = "6px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("N", cx, cy - 6);
  ctx.fillText("S", cx, cy + 10);
  ctx.fillText("W", cx - 8, cy + 2);
  ctx.fillText("E", cx + 8, cy + 2);
  // Pointing arrow toward facing.
  const ang = { north: -Math.PI / 2, east: 0, south: Math.PI / 2, west: Math.PI }[facing] || 0;
  ctx.fillStyle = "#c2a76a";
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ang) * 9, cy + Math.sin(ang) * 9);
  ctx.lineTo(cx + Math.cos(ang + 2.5) * 4, cy + Math.sin(ang + 2.5) * 4);
  ctx.lineTo(cx + Math.cos(ang - 2.5) * 4, cy + Math.sin(ang - 2.5) * 4);
  ctx.closePath();
  ctx.fill();
  // Mode hint below.
  ctx.fillStyle = "#7a8898";
  ctx.font = "7px ui-monospace, monospace";
  ctx.fillText("3D · V", cx, cy + 19);
  ctx.restore();
  ctx.textAlign = "left";
}

let _isTouch = null;
function isTouchDevice() {
  if (_isTouch !== null) return _isTouch;
  _isTouch = ("ontouchstart" in window) ||
             (navigator.maxTouchPoints > 0) ||
             matchMedia("(pointer: coarse)").matches;
  return _isTouch;
}

// ----- fx event API (combat.js posts here via state.emitFx) ---------------

function emitFx(kind, payload) {
  switch (kind) {
    case "damage_enemy": {
      const e = payload.enemy;
      if (!state.combat) return;
      const idx = state.combat.enemies.indexOf(e);
      const slot = VIEW_W / (state.combat.enemies.length + 1);
      const baseX = Math.round((idx + 1) * slot);
      const baseY = (e.boss ? 24 : 36);
      fx.dmgNumbers.push({
        x: baseX, y: baseY, text: String(payload.dmg),
        color: "rgba(255,200,90,ALPHA)",
        born: animTime, dur: 700,
      });
      fx.hitFlash.set(e.instanceId, animTime + 200);
      fx.shake.until = animTime + 180;
      fx.shake.mag = Math.min(4, 1 + payload.dmg / 20);
      break;
    }
    case "damage_party": {
      const memberIdx = state.party.indexOf(payload.member);
      if (memberIdx < 0) return;
      // Damage number rendered over the enemy line area (approximate).
      const x = 40 + memberIdx * 60;
      fx.dmgNumbers.push({
        x, y: 96, text: String(payload.dmg),
        color: "rgba(255,90,90,ALPHA)",
        born: animTime, dur: 700,
      });
      fx.shake.until = animTime + 180;
      fx.shake.mag = Math.min(4, 1 + payload.dmg / 20);
      break;
    }
    case "heal": {
      const x = VIEW_W / 2;
      fx.dmgNumbers.push({
        x, y: 80, text: "+" + payload.amt,
        color: "rgba(120,220,140,ALPHA)",
        born: animTime, dur: 700,
      });
      break;
    }
    case "slash_vfx": {
      fx.slash.push({ enemy: payload.target, born: animTime, dur: 220 });
      break;
    }
    case "spell_vfx": {
      fx.spells.push({ enemy: payload.target, color: payload.color, born: animTime, dur: 360 });
      break;
    }
    case "dissolve": {
      const i = state.combat?.enemies.indexOf(payload.target);
      if (i == null || i < 0) break;
      const slot = VIEW_W / (state.combat.enemies.length + 1);
      const baseX = Math.round((i + 1) * slot - 8);
      const baseY = (payload.target.boss ? 28 : 40);
      fx.dissolves.push({ x: baseX, y: baseY, born: animTime, dur: 600 });
      break;
    }
    case "reward_float": {
      // Float XP and gold above the player after victory (world space in 2D,
      // screen space in 3D — we render both via worldFloats).
      worldFloats.push({
        text: `+${payload.xp} XP`,
        color: "rgba(255,220,90,ALPHA)",
        born: animTime, dur: 1500,
      });
      worldFloats.push({
        text: `+${payload.gold} silver`,
        color: "rgba(255,200,90,ALPHA)",
        born: animTime + 200, dur: 1500,
      });
      break;
    }
  }
}

// Floating texts in the world (XP, gold, etc.).
const worldFloats = [];
state.emitFx = emitFx;

// ----- Particle system (mist) ---------------------------------------------

function spawnMist() {
  if (state.phase !== "explore") return;
  if (Math.random() > 0.35) return;
  const camPx = clamp(state.player.x * TILE + TILE / 2 - VIEW_W / 2, 0, W * TILE - VIEW_W);
  const camPy = clamp(state.player.y * TILE + TILE / 2 - VIEW_H / 2, 0, H * TILE - VIEW_H);
  // Spawn near the left edge of the view, drifting east.
  const wx = camPx + Math.random() * 8 - 8;
  const wy = camPy + Math.random() * VIEW_H;
  particles.push({
    x: wx, y: wy,
    vx: 4 + Math.random() * 6, vy: -1 + Math.random() * 2,
    size: Math.random() < 0.5 ? 2 : 3,
    alpha: 0.25 + Math.random() * 0.25,
    t: 0, life: 3500 + Math.random() * 2500,
  });
  if (particles.length > 60) particles.shift();
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    p.x += p.vx * dt / 1000;
    p.y += p.vy * dt / 1000;
    if (p.t > p.life) particles.splice(i, 1);
  }
  // Embers float upward, fade out.
  for (let i = embers.length - 1; i >= 0; i--) {
    const e = embers[i];
    e.t += dt;
    e.x += e.vx * dt / 1000;
    e.y += e.vy * dt / 1000;
    if (e.t > e.life) embers.splice(i, 1);
  }
  // Reap stale damage numbers / VFX.
  fx.dmgNumbers = fx.dmgNumbers.filter(d => animTime - d.born < d.dur);
  fx.slash = fx.slash.filter(s => animTime - s.born < s.dur);
  fx.spells = fx.spells.filter(s => animTime - s.born < s.dur);
  fx.dissolves = fx.dissolves.filter(d => animTime - d.born < d.dur);
  for (const [k, t] of fx.hitFlash) if (t < animTime) fx.hitFlash.delete(k);
  // Reap world floats (XP / gold rewards).
  for (let i = worldFloats.length - 1; i >= 0; i--) {
    if (animTime - worldFloats[i].born > worldFloats[i].dur) worldFloats.splice(i, 1);
  }
}

function renderWorldFloats(camPx, camPy) {
  if (!worldFloats.length) return;
  ctx.save();
  ctx.font = "bold 9px ui-monospace, monospace";
  ctx.textAlign = "center";
  const baseX = state.player.x * TILE + 8 - camPx;
  const baseY = state.player.y * TILE - camPy;
  let i = 0;
  for (const f of worldFloats) {
    const t = (animTime - f.born) / f.dur;
    if (t < 0 || t > 1) continue;
    const a = (1 - t) * (t < 0.1 ? t / 0.1 : 1);
    const yoff = -t * 32 - i * 10;
    ctx.fillStyle = f.color.replace("ALPHA", a.toFixed(2));
    ctx.fillText(f.text, baseX, baseY + yoff);
    i++;
  }
  ctx.restore();
  ctx.textAlign = "left";
}

function spawnFootstepDust(tileX, tileY) {
  // Only kick up dust on dry ground tiles (path / floor / bridge).
  const t = state.grid[tileY]?.[tileX];
  if (t !== TILES.PATH && t !== TILES.FLOOR && t !== TILES.BRIDGE) return;
  const baseX = tileX * TILE + 8;
  const baseY = tileY * TILE + 14;
  for (let i = 0; i < 3; i++) {
    particles.push({
      x: baseX + (Math.random() - 0.5) * 6,
      y: baseY + Math.random() * 2,
      vx: (Math.random() - 0.5) * 6,
      vy: -2 - Math.random() * 4,
      size: 1,
      alpha: 0.3 + Math.random() * 0.2,
      t: 0, life: 350 + Math.random() * 250,
    });
  }
}

function spawnEmbers() {
  if (state.phase !== "explore" || state.combat) return;
  for (const s of SHRINES) {
    if (!state.flags[s.id]) continue;
    if (Math.random() > 0.3) continue;
    embers.push({
      x: s.x * TILE + 6 + Math.random() * 4,
      y: s.y * TILE + 4 - Math.random() * 4,
      vx: (Math.random() - 0.5) * 4,
      vy: -10 - Math.random() * 10,
      t: 0, life: 1200 + Math.random() * 600,
    });
  }
  for (const cf of CAMPFIRES) {
    if (Math.random() > 0.4) continue;
    embers.push({
      x: cf.x * TILE + 6 + Math.random() * 4,
      y: cf.y * TILE + 4 - Math.random() * 4,
      vx: (Math.random() - 0.5) * 6,
      vy: -12 - Math.random() * 12,
      t: 0, life: 900 + Math.random() * 600,
    });
  }
  if (embers.length > 80) embers.splice(0, embers.length - 80);
}

// ----- Main loop ----------------------------------------------------------

let lastFrame = 0;
function frame(now) {
  if (!lastFrame) lastFrame = now;
  const dt = Math.min(64, now - lastFrame);
  lastFrame = now;
  animTime += dt;
  spawnMist();
  spawnEmbers();
  updateParticles(dt);
  render();
  requestAnimationFrame(frame);
}

function boot() {
  buildTileCache();
  state.grid = buildWorld();
  state.party = buildParty();
  bindTouchControls();
  requestAnimationFrame(frame);
}

boot();
