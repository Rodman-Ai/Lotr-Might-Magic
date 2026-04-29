import {
  HEROES, ENEMIES, TILES, buildTileCache, getTileCanvas, getFlameFrame, isWalkable,
} from "./sprites.js";
import {
  W, H, SPAWN, buildWorld, encounterTable, findInteractable,
  SHRINES, CHESTS, RECRUITS,
} from "./world.js";
import { ITEMS, SPELLS } from "./items.js";
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
};

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

  // ----- Tiles -----
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
      if (img) ctx.drawImage(img, wx * TILE, wy * TILE);
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
  ctx.restore();

  // ----- Drop shadow + leader sprite with walk bob -----
  drawShadow(ppx + 8, ppy + 14, 6, 2);
  const leader = state.party[0];
  let bobY = 0, bobX = 0;
  if (moving) {
    const t = (animTime - walk.start) / walk.dur;
    bobY = -Math.abs(Math.sin(t * Math.PI)) * 1.2;
    bobX = Math.sin(t * Math.PI * 2) * 0.6;
  }
  ctx.drawImage(leader.sprite, Math.round(ppx + bobX), Math.round(ppy + bobY));

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

  renderHUD();
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

function renderCombatVeil(shakeX, shakeY) {
  ctx.fillStyle = "rgba(5,5,10,0.78)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Atmospheric mist behind the enemies.
  ctx.save();
  const stripeY = 16;
  for (let i = 0; i < 60; i++) {
    const t = (animTime / 60 + i * 17) % 360;
    const x = (t * 1.3) % VIEW_W;
    const y = stripeY + (i * 7) % 96;
    ctx.fillStyle = `rgba(120,140,180,${0.04 + (i % 5) * 0.01})`;
    ctx.fillRect(x, y, 30, 1);
  }
  ctx.restore();

  // Banner
  ctx.fillStyle = "#1a1f30";
  ctx.fillRect(0, 16, VIEW_W, 96);
  ctx.fillStyle = "#2a3148";
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
    // hp pip
    const w = 24, h = 2;
    const px = baseX - 4, py = baseY - 4;
    ctx.fillStyle = "#000"; ctx.fillRect(px, py, w, h);
    ctx.fillStyle = "#b34a4a";
    ctx.fillRect(px, py, Math.round(w * (e.hp / e.maxHp)), h);
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
    const wrap = document.createElement("div");
    wrap.className = "member" + (m.dead ? " dead" : "");
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
    if (fx.kind === "midboss") return triggerMidBoss(fx);
    if (fx.kind === "boss") return triggerBoss(fx);
  }
  state.log("sys", "Nothing here calls to you.");
  render();
}

function interactShrine(s) {
  if (state.flags[s.id]) {
    state.log("lore", `${s.name} already burns clean.`);
    render(); return;
  }
  state.flags[s.id] = true;
  state.log("lore", `You kindle ${s.name}. ${s.blessing}`);
  if (s.id === "shrine_hall") {
    for (const m of state.party) {
      if (m.dead) { m.dead = false; m.hp = Math.floor(m.maxHp / 2); }
      else { m.hp = m.maxHp; m.mp = m.maxMp; }
    }
  }
  render();
}

function interactChest(c) {
  const k = "chest_" + c.x + "_" + c.y;
  if (state.flags[k]) {
    state.log("sys", "The chest is empty.");
    render(); return;
  }
  state.flags[k] = true;
  for (const it of c.items) {
    if (it.id === "gold") { state.gold += it.n; state.log("gold", `Found ${it.n} silver.`); }
    else {
      state.inventory[it.id] = (state.inventory[it.id] || 0) + it.n;
      state.log("gold", `Found ${it.n} × ${ITEMS[it.id].name}.`);
    }
  }
  render();
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
        <button data-act="attack">Attack</button>
        ${actor.spells.length ? `<button data-act="spell">Spell</button>` : ""}
        <button data-act="item">Item</button>
        <button data-act="defend">Defend</button>
        <button data-act="flee">Flee</button>
      </div>
      <div id="sub"></div>
    `, {
      "[data-act=attack]": () => pickEnemyTarget(actor, "attack"),
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

const SAVE_KEY = "shadows_of_rivendell_save_v1";

function saveGame() {
  if (state.phase !== "explore") {
    state.log("sys", "You may not save mid-battle.");
    return;
  }
  const snap = {
    player: state.player,
    party: state.party.map(m => ({
      id: m.id, lvl: m.lvl, xp: m.xp,
      maxHp: m.maxHp, hp: m.hp, maxMp: m.maxMp, mp: m.mp,
      atk: m.atk, def: m.def, spd: m.spd, dead: m.dead,
    })),
    inventory: state.inventory,
    gold: state.gold,
    steps: state.steps,
    flags: state.flags,
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
    state.log("sys", "The journey is recorded.");
  } catch (e) {
    state.log("sys", "Save failed.");
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { state.log("sys", "No saved tale."); return false; }
    const snap = JSON.parse(raw);
    state.player = snap.player;
    state.party = snap.party.map(s => {
      const fresh = buildHero(s.id);
      return Object.assign(fresh, s);
    });
    state.inventory = snap.inventory;
    state.gold = snap.gold;
    state.steps = snap.steps;
    state.flags = snap.flags || {};
    state.phase = "explore";
    hideOverlay();
    render();
    state.log("sys", "Saved tale restored.");
    return true;
  } catch (e) {
    state.log("sys", "Load failed.");
    return false;
  }
}

// ----- Inventory / Character sheet ---------------------------------------

function showInventory() {
  const items = Object.entries(state.inventory)
    .filter(([id, n]) => n > 0)
    .map(([id, n]) => `<li><b>${ITEMS[id].name}</b> ×${n} — <i>${ITEMS[id].desc}</i></li>`)
    .join("") || "<li><i>Nothing.</i></li>";
  showOverlay(`
    <h1>Pack</h1>
    <ul>${items}</ul>
    <div>Silver: ${state.gold}</div>
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

function newGame() {
  state.phase = "explore";
  state.player = { x: SPAWN.x, y: SPAWN.y, facing: "south", anim: 0 };
  state.party = buildParty();
  state.inventory = { potion: 2, manabrew: 1, lembas: 1, starflask: 0 };
  state.gold = 25;
  state.steps = 0;
  state.flags = {};
  state.combat = null;
  hideOverlay();
  logEl.innerHTML = "";
  state.log("lore", "You cross the bridge into Imladris. The river runs black, and the very air weeps.");
  state.log("lore", "Three shrines must be lit before the cavern beneath the Vale will yield.");
  render();
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

  switch (ev.key) {
    case "ArrowUp": case "w": case "W": tryMove(0, -1); ev.preventDefault(); break;
    case "ArrowDown": case "s": case "S": tryMove(0, 1); ev.preventDefault(); break;
    case "ArrowLeft": case "a": case "A": tryMove(-1, 0); ev.preventDefault(); break;
    case "ArrowRight": case "d": case "D": tryMove(1, 0); ev.preventDefault(); break;
    case "e": case "E": case " ":
      interactAt(state.player.x, state.player.y); ev.preventDefault(); break;
    case "i": case "I": showInventory(); ev.preventDefault(); break;
    case "c": case "C": showParty(); ev.preventDefault(); break;
    case "Escape": hideOverlay(); break;
    case "F5": saveGame(); ev.preventDefault(); break;
    case "F9": loadGame(); ev.preventDefault(); break;
  }
});

// ----- Touch input -------------------------------------------------------

function moveDir(dir) {
  switch (dir) {
    case "up":    tryMove(0, -1); break;
    case "down":  tryMove(0,  1); break;
    case "left":  tryMove(-1, 0); break;
    case "right": tryMove(1,  0); break;
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
    case "inventory": showInventory(); break;
    case "party": showParty(); break;
    case "save": saveGame(); break;
    case "load": loadGame(); break;
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
  }
}
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
  // Reap stale damage numbers.
  fx.dmgNumbers = fx.dmgNumbers.filter(d => animTime - d.born < d.dur);
  for (const [k, t] of fx.hitFlash) if (t < animTime) fx.hitFlash.delete(k);
}

// ----- Main loop ----------------------------------------------------------

let lastFrame = 0;
function frame(now) {
  if (!lastFrame) lastFrame = now;
  const dt = Math.min(64, now - lastFrame);
  lastFrame = now;
  animTime += dt;
  spawnMist();
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
