import {
  HEROES, ENEMIES, TILES, buildTileCache, getTileCanvas, isWalkable,
} from "./sprites.js";
import {
  W, H, SPAWN, buildWorld, encounterTable, findInteractable,
  SHRINES, CHESTS,
} from "./world.js";
import { ITEMS, SPELLS } from "./items.js";
import { startCombat, queuePartyActions, tickResolve } from "./combat.js";

const TILE = 16;
const VIEW_W = 320, VIEW_H = 240;
const VIEW_TX = VIEW_W / TILE, VIEW_TY = VIEW_H / TILE;

const screen = document.getElementById("screen");
const ctx = screen.getContext("2d");
ctx.imageSmoothingEnabled = false;

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

function buildParty() {
  const ids = ["ranger", "archer", "mage", "dwarf"];
  return ids.map(id => {
    const h = HEROES[id];
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
  });
}

// ----- Rendering ----------------------------------------------------------

function render() {
  if (state.phase === "title") return renderTitle();
  // World view.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const cx = clamp(state.player.x - Math.floor(VIEW_TX / 2), 0, W - VIEW_TX);
  const cy = clamp(state.player.y - Math.floor(VIEW_TY / 2), 0, H - VIEW_TY);

  // Tiles.
  for (let ty = 0; ty < VIEW_TY; ty++) {
    for (let tx = 0; tx < VIEW_TX; tx++) {
      const wx = cx + tx, wy = cy + ty;
      if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
      let id = state.grid[wy][wx];
      // dynamic: shrines lit / chests open
      if (id === TILES.SHRINE) {
        const sh = SHRINES.find(s => s.x === wx && s.y === wy);
        if (sh && state.flags[sh.id]) id = TILES.SHRINE_LIT;
      } else if (id === TILES.CHEST) {
        const c = CHESTS.find(c => c.x === wx && c.y === wy);
        if (c && state.flags["chest_" + c.x + "_" + c.y]) id = TILES.CHEST_OPEN;
      }
      const img = getTileCanvas(id);
      if (img) ctx.drawImage(img, tx * TILE, ty * TILE);
    }
  }

  // Party leader sprite (hero 0).
  const leader = state.party[0];
  const px = (state.player.x - cx) * TILE;
  const py = (state.player.y - cy) * TILE;
  ctx.drawImage(leader.sprite, px, py);

  // Pall of shadow over the bridge zone (haunted ambience).
  ctx.fillStyle = "rgba(20,20,40,0.18)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Vignette.
  const grd = ctx.createRadialGradient(
    VIEW_W / 2, VIEW_H / 2, 60,
    VIEW_W / 2, VIEW_H / 2, 200);
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Combat veil + enemy line over the canvas.
  if (state.combat) renderCombatVeil();

  renderHUD();
}

function renderCombatVeil() {
  ctx.fillStyle = "rgba(5,5,10,0.7)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
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
    const x = Math.round((i + 1) * slot - 8);
    const y = e.boss ? 28 : 40;
    if (e.hp > 0) {
      ctx.drawImage(e.sprite, x, y);
      // hp pip
      const w = 24, h = 2;
      const px = x - 4, py = y - 4;
      ctx.fillStyle = "#000"; ctx.fillRect(px, py, w, h);
      ctx.fillStyle = "#b34a4a";
      ctx.fillRect(px, py, Math.round(w * (e.hp / e.maxHp)), h);
    }
  }
}

function renderTitle() {
  ctx.fillStyle = "#04060a";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Background tile pattern: distant trees and a faint bridge.
  for (let i = 0; i < 60; i++) {
    const x = (i * 37) % VIEW_W;
    const y = ((i * 17) % 40) + 180;
    ctx.fillStyle = "#0e1420";
    ctx.fillRect(x, y, 2, 8);
  }
  // Moon
  ctx.fillStyle = "#cfd8e4";
  ctx.beginPath();
  ctx.arc(60, 60, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#9aa0b8";
  ctx.beginPath(); ctx.arc(54, 56, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(66, 64, 3, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#c2a76a";
  ctx.font = "bold 18px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("SHADOWS OF RIVENDELL", VIEW_W / 2, 110);
  ctx.fillStyle = "#9aa0b8";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText("a pixel-art tale of haunted Imladris", VIEW_W / 2, 126);

  ctx.fillStyle = "#d8d2c2";
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillText("Press ENTER to begin", VIEW_W / 2, 170);
  ctx.fillStyle = "#7a8898";
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillText("F9 to load saved game", VIEW_W / 2, 184);
  ctx.textAlign = "left";
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
  state.player.x = nx; state.player.y = ny;
  state.steps++;

  // Auto-interact with the boss tile.
  const fx = findInteractable(nx, ny);
  if (fx && fx.kind === "boss" && !state.flags.boss_defeated) {
    return triggerBoss(fx, { ox, oy });
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
  // Inspect player tile and the four neighbors.
  const candidates = [[x, y], [x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]];
  for (const [cx, cy] of candidates) {
    const fx = findInteractable(cx, cy);
    if (!fx) continue;
    if (fx.kind === "shrine") return interactShrine(fx);
    if (fx.kind === "chest") return interactChest(fx);
    if (fx.kind === "statue") return interactStatue(fx);
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
    const fresh = buildParty();
    state.party = fresh.map((m, i) => ({ ...m, ...snap.party[i] }));
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

// ----- Boot --------------------------------------------------------------

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function boot() {
  buildTileCache();
  state.grid = buildWorld();
  state.party = buildParty();
  // initial render shows title screen
  render();
  // Tiny ambient pulse to redraw periodically (keeps any future animation responsive).
  setInterval(() => {
    if (state.phase !== "title") render();
  }, 500);
}

boot();
