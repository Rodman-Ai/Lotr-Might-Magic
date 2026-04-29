import { ENEMIES } from "./sprites.js";
import { SPELLS, ITEMS } from "./items.js";

// Combat is a turn-based overlay. The screen renders the enemy line and
// the menu in plain DOM (#overlay) for accessibility and to keep the canvas
// busy with the dungeon view behind a darkened veil.

export function startCombat(state, enemyIds, opts = {}) {
  const enemies = enemyIds.map((id, i) => spawnEnemy(id, i));
  state.combat = {
    enemies,
    boss: !!opts.boss,
    turn: 0,
    actionsQueued: [],
    activeMember: 0,
    phase: "command", // command | resolving | done
    fled: false,
    onResolved: opts.onResolved || null,
  };
  state.log("lore", `A foul presence! ${enemies.map(e => e.name).join(", ")} appear.`);
  if (opts.boss) state.log("lore", "There is no fleeing this fight.");
  state.render();
}

function spawnEnemy(id, idx) {
  const base = ENEMIES[id];
  return {
    ...base,
    instanceId: idx,
    maxHp: base.hp,
    hp: base.hp,
  };
}

// Returns { actor, kind } for the next acting unit by speed, or null when round done.
function nextActor(state) {
  const c = state.combat;
  if (!c.actionsQueued.length) return null;
  // Peek the highest-speed remaining queued action.
  c.actionsQueued.sort((a, b) => b.spd - a.spd);
  return c.actionsQueued.shift();
}

export function queuePartyActions(state, plan) {
  // plan: array, one entry per living party member, in party order.
  // entry: { kind: "attack"|"spell"|"item"|"defend"|"flee", targetIdx?, spellId?, itemId? }
  const c = state.combat;
  let i = 0;
  for (const m of state.party) {
    if (m.dead) continue;
    const p = plan[i++];
    c.actionsQueued.push({ side: "party", actor: m, plan: p, spd: m.spd });
  }
  // Enemy intents
  for (const e of c.enemies) {
    if (e.hp <= 0) continue;
    const targets = state.party.filter(m => !m.dead);
    if (!targets.length) continue;
    const t = targets[Math.floor(Math.random() * targets.length)];
    c.actionsQueued.push({ side: "enemy", actor: e, plan: { kind: "attack", target: t }, spd: e.spd });
  }
  c.phase = "resolving";
}

// Resolve one queued action. Returns true when the round is finished.
export function tickResolve(state) {
  const c = state.combat;
  if (!c) return true;
  // Remove dead actors first.
  c.actionsQueued = c.actionsQueued.filter(a =>
    a.side === "party" ? !a.actor.dead : a.actor.hp > 0);

  const next = nextActor(state);
  if (!next) {
    c.phase = "command";
    if (c.fled) { endCombat(state, "fled"); return true; }
    if (c.enemies.every(e => e.hp <= 0)) { endCombat(state, "win"); return true; }
    if (state.party.every(m => m.dead)) { endCombat(state, "lose"); return true; }
    return true;
  }

  if (next.side === "party") {
    resolvePartyAction(state, next.actor, next.plan);
  } else {
    resolveEnemyAction(state, next.actor, next.plan);
  }

  // Check immediate end conditions.
  if (state.party.every(m => m.dead)) { endCombat(state, "lose"); return true; }
  if (c.enemies.every(e => e.hp <= 0)) { endCombat(state, "win"); return true; }
  if (c.fled && next.side === "party") { endCombat(state, "fled"); return true; }

  return false;
}

function resolvePartyAction(state, actor, plan) {
  const c = state.combat;
  switch (plan.kind) {
    case "attack": {
      const t = c.enemies[plan.targetIdx];
      if (!t || t.hp <= 0) {
        const live = c.enemies.find(e => e.hp > 0);
        if (!live) return;
        return doAttack(state, actor, live);
      }
      return doAttack(state, actor, t);
    }
    case "spell": {
      const sp = SPELLS[plan.spellId];
      if (!sp || actor.mp < sp.mp) {
        state.log("sys", `${actor.name} falters — not enough strength.`); return;
      }
      actor.mp -= sp.mp;
      let target;
      if (sp.target === "ally") target = state.party[plan.targetIdx];
      else target = c.enemies[plan.targetIdx] || c.enemies.find(e => e.hp > 0);
      if (!target) return;
      sp.cast(state, actor, target);
      return;
    }
    case "item": {
      const it = ITEMS[plan.itemId];
      const stack = state.inventory[plan.itemId];
      if (!it || !stack || stack <= 0) {
        state.log("sys", `${actor.name} fumbles for nothing.`); return;
      }
      state.inventory[plan.itemId] = stack - 1;
      const target = it.target === "party" ? null : state.party[plan.targetIdx];
      it.apply(state, target);
      return;
    }
    case "defend": {
      actor.defending = true;
      state.log("sys", `${actor.name} braces.`); return;
    }
    case "flee": {
      if (c.boss) { state.log("sys", `${actor.name} cannot flee this presence.`); return; }
      const chance = 0.6;
      if (Math.random() < chance) { c.fled = true; state.log("sys", `${actor.name} leads the party away.`); }
      else state.log("sys", `${actor.name} cannot break free!`);
      return;
    }
  }
}

function doAttack(state, actor, target) {
  const roll = 0.85 + Math.random() * 0.3;
  const blessed = (state.flags.shrine_oath && actor.name === "Aranor") ? 4 : 0;
  let dmg = Math.max(1, Math.floor((actor.atk + blessed) * roll - target.def * 0.5));
  target.hp -= dmg;
  state.emitFx?.("damage_enemy", { enemy: target, dmg });
  state.log("hit", `${actor.name} strikes ${target.name} for ${dmg}.`);
  if (target.hp <= 0) state.log("sys", `${target.name} dissolves into mist.`);
}

function resolveEnemyAction(state, actor, plan) {
  if (actor.hp <= 0) return;

  // Special enemy abilities — chance-based AoE for banshees.
  if (actor.ability === "wail" && Math.random() < 0.45) {
    state.log("hit", `${actor.name} unleashes a soul-rending wail!`);
    for (const m of state.party) {
      if (m.dead) continue;
      const roll = 0.7 + Math.random() * 0.3;
      const dmg = Math.max(1, Math.floor(actor.atk * 0.7 * roll - m.def * (m.defending ? 1.0 : 0.4)));
      m.hp -= dmg;
      state.emitFx?.("damage_party", { member: m, dmg });
      if (m.hp <= 0) { m.hp = 0; m.dead = true; state.log("hit", `${m.name} falls!`); }
    }
    return;
  }

  const t = plan.target;
  if (t.dead) {
    const alt = state.party.filter(m => !m.dead);
    if (!alt.length) return;
    plan.target = alt[Math.floor(Math.random() * alt.length)];
  }
  const target = plan.target;
  const roll = 0.8 + Math.random() * 0.3;
  let dmg = Math.max(1, Math.floor(actor.atk * roll - target.def * (target.defending ? 1.2 : 0.6)));
  target.hp -= dmg;
  state.emitFx?.("damage_party", { member: target, dmg });
  if (target.hp <= 0) {
    target.hp = 0;
    target.dead = true;
    state.log("hit", `${actor.name} fells ${target.name}!`);
  } else {
    state.log("hit", `${actor.name} claws ${target.name} for ${dmg}.`);
  }
}

function endCombat(state, outcome) {
  const c = state.combat;
  if (outcome === "win") {
    let xp = 0, gold = 0;
    for (const e of c.enemies) { xp += e.xp; gold += e.gold; }
    const live = state.party.filter(m => !m.dead);
    const each = Math.ceil(xp / Math.max(1, live.length));
    for (const m of live) {
      m.xp += each;
      while (m.xp >= xpForNext(m.lvl)) {
        m.xp -= xpForNext(m.lvl);
        levelUp(state, m);
      }
    }
    state.gold += gold;
    state.log("gold", `Victory. ${each} XP each, ${gold} silver.`);
    if (c.boss) state.flags.boss_defeated = true;
  } else if (outcome === "lose") {
    state.log("hit", "Your party falls. Darkness takes Rivendell.");
    state.flags.game_over = true;
  } else {
    state.log("sys", "You slip away into the mist.");
  }
  // Clear defending markers.
  for (const m of state.party) m.defending = false;
  const onResolved = c.onResolved;
  state.combat = null;
  if (onResolved) onResolved(outcome);
}

function xpForNext(lvl) { return 30 + lvl * 30; }

function levelUp(state, m) {
  m.lvl += 1;
  m.maxHp += 6 + Math.floor(Math.random() * 4);
  m.maxMp += m.classKind === "mage" ? 4 : (m.classKind === "archer" ? 2 : 1);
  m.atk += 1;
  if (m.lvl % 2 === 0) m.def += 1;
  m.hp = m.maxHp;
  m.mp = m.maxMp;
  state.log("gold", `${m.name} reaches level ${m.lvl}!`);
}
