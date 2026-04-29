// Items, equipment, statuses, and spells.

// Equipment slots: weapon, armor, trinket.
// Each entry: { slot, name, atk?, def?, hp?, mp?, classKinds? }.
export const EQUIPMENT = {
  // Weapons
  ranger_blade:   { slot: "weapon", name: "Ranger's Blade",     atk: 3, classKinds: ["warrior", "archer"] },
  elven_longbow:  { slot: "weapon", name: "Elven Longbow",      atk: 4, classKinds: ["archer"] },
  hallowed_axe:   { slot: "weapon", name: "Hallowed Axe",       atk: 5, classKinds: ["warrior"] },
  staff_of_lore:  { slot: "weapon", name: "Staff of Lore",      atk: 1, mp: 8, classKinds: ["mage"] },
  silver_dagger:  { slot: "weapon", name: "Silver Dagger",      atk: 3, classKinds: ["archer", "warrior"] },
  // Armor
  leather_jerkin: { slot: "armor", name: "Leather Jerkin",      def: 2, hp: 6 },
  mithril_shirt:  { slot: "armor", name: "Mithril Shirt",       def: 4, hp: 10 },
  star_robe:      { slot: "armor", name: "Star-Spun Robe",      def: 2, mp: 6, classKinds: ["mage"] },
  // Trinkets
  evenstar:       { slot: "trinket", name: "Evenstar Pendant",  hp: 8, mp: 4 },
  ring_of_durin:  { slot: "trinket", name: "Ring of Durin",     def: 1, hp: 6 },
};

export function eligibleSlots(memberClassKind, equipId) {
  const e = EQUIPMENT[equipId];
  if (!e) return false;
  if (!e.classKinds) return true;
  return e.classKinds.includes(memberClassKind);
}

// Status effects on combatants. tick() runs each round end. duration in turns.
export const STATUSES = {
  poison: {
    name: "Poison", color: "#7ad06a",
    onTurn(state, unit) {
      const dmg = 4;
      unit.hp -= dmg;
      if (unit.hp < 0) unit.hp = 0;
      state.emitFx?.("damage_party", { member: unit, dmg });
      state.log("hit", `${unit.name} suffers ${dmg} from poison.`);
    },
  },
  bless: {
    name: "Bless", color: "#f0d878",
    // No per-turn effect; bonuses applied in combat resolution lookups.
  },
};

export function effectiveAtk(unit) {
  let atk = unit.atk;
  for (const s of unit.statuses || []) {
    if (s.id === "bless") atk += 3;
  }
  if (unit.equipped) {
    for (const slot of ["weapon", "armor", "trinket"]) {
      const id = unit.equipped[slot];
      if (id && EQUIPMENT[id]?.atk) atk += EQUIPMENT[id].atk;
    }
  }
  return atk;
}

export function effectiveDef(unit) {
  let def = unit.def;
  for (const s of unit.statuses || []) {
    if (s.id === "bless") def += 2;
  }
  if (unit.equipped) {
    for (const slot of ["weapon", "armor", "trinket"]) {
      const id = unit.equipped[slot];
      if (id && EQUIPMENT[id]?.def) def += EQUIPMENT[id].def;
    }
  }
  return def;
}

export const ITEMS = {
  potion:   { name: "Athelas Draught", desc: "Restores 25 HP.",
              kind: "consumable", target: "ally",
              apply(state, target) { heal(target, 25); state.log("heal", `${target.name} drinks an athelas draught (+25 HP).`); } },
  manabrew: { name: "Miruvor",        desc: "Restores 15 MP.",
              kind: "consumable", target: "ally",
              apply(state, target) { mana(target, 15); state.log("heal", `${target.name} sips Miruvor (+15 MP).`); } },
  lembas:   { name: "Lembas Wafer",   desc: "Restores 50 HP.",
              kind: "consumable", target: "ally",
              apply(state, target) { heal(target, 50); state.log("heal", `${target.name} eats lembas (+50 HP).`); } },
  starflask:{ name: "Star-glass Flask", desc: "Heals all allies for 30 HP.",
              kind: "consumable", target: "party",
              apply(state) {
                for (const m of state.party) if (!m.dead) heal(m, 30);
                state.log("heal", "The star-glass blazes — the party is restored (+30 HP each).");
              } },
  blessoil: { name: "Vial of Blessing", desc: "Grants Bless (+ATK/DEF) for 5 turns.",
              kind: "consumable", target: "ally",
              apply(state, target) {
                target.statuses = target.statuses || [];
                target.statuses.push({ id: "bless", turns: 5 });
                state.log("heal", `${target.name} is blessed by ancient oils.`);
              } },
  antidote: { name: "Athelas Poultice", desc: "Cures Poison.",
              kind: "consumable", target: "ally",
              apply(state, target) {
                target.statuses = (target.statuses || []).filter(s => s.id !== "poison");
                state.log("heal", `${target.name} is cleansed of poison.`);
              } },
};

export const SPELLS = {
  heal:        { name: "Mend",          mp: 4,  target: "ally",
                 cast(state, caster, target) {
                   const amt = 18 + caster.lvl * 4 + (state.flags.shrine_vilya ? 8 : 0);
                   heal(target, amt);
                   state.emitFx?.("heal", { amt });
                   state.log("heal", `${caster.name} weaves Mend on ${target.name} (+${amt} HP).`);
                 } },
  holy_light:  { name: "Holy Light",    mp: 6,  target: "enemy",
                 cast(state, caster, target) {
                   const base = 14 + caster.lvl * 3 + (state.flags.shrine_vilya ? 6 : 0);
                   const dmg = base * (target.weak === "holy" ? 2 : 1);
                   target.hp -= dmg;
                   state.emitFx?.("damage_enemy", { enemy: target, dmg });
                   state.emitFx?.("spell_vfx", { target, color: "#fff2a8" });
                   state.log("hit", `${caster.name} calls Holy Light — ${target.name} takes ${dmg}.`);
                 } },
  lightning:   { name: "Sky-Sunder",    mp: 8,  target: "enemy",
                 cast(state, caster, target) {
                   const base = 20 + caster.lvl * 3 + (state.flags.shrine_vilya ? 8 : 0);
                   const dmg = base * (target.weak === "lightning" ? 2 : 1);
                   target.hp -= dmg;
                   state.emitFx?.("damage_enemy", { enemy: target, dmg });
                   state.emitFx?.("spell_vfx", { target, color: "#a0d0ff" });
                   state.log("hit", `${caster.name} hurls Sky-Sunder — ${target.name} takes ${dmg}.`);
                 } },
  star_arrow:  { name: "Star Arrow",    mp: 5,  target: "enemy",
                 cast(state, caster, target) {
                   const dmg = 16 + caster.lvl * 3;
                   target.hp -= dmg;
                   state.emitFx?.("damage_enemy", { enemy: target, dmg });
                   state.emitFx?.("spell_vfx", { target, color: "#cfd8e4" });
                   state.log("hit", `${caster.name} looses a Star Arrow — ${target.name} takes ${dmg}.`);
                 } },
  holy_word:   { name: "Holy Word",     mp: 10, target: "party",
                 cast(state, caster) {
                   const amt = 14 + caster.lvl * 3 + (state.flags.shrine_vilya ? 6 : 0);
                   for (const m of state.party) {
                     if (m.dead) continue;
                     m.hp = Math.min(m.maxHp, m.hp + amt);
                   }
                   state.emitFx?.("heal", { amt });
                   state.log("heal", `${caster.name} sings a Holy Word — the party is mended (+${amt} HP each).`);
                 } },
  shadow_strike:{ name: "Shadow Strike", mp: 6, target: "enemy",
                 cast(state, caster, target) {
                   const crit = Math.random() < 0.4 ? 2 : 1;
                   const dmg = (18 + caster.lvl * 4) * crit;
                   target.hp -= dmg;
                   state.emitFx?.("damage_enemy", { enemy: target, dmg });
                   state.emitFx?.("spell_vfx", { target, color: "#a040c0" });
                   state.log("hit", `${caster.name} ${crit > 1 ? "lands a critical " : ""}Shadow Strike on ${target.name} for ${dmg}.`);
                 } },
  bane:        { name: "Bane",          mp: 5, target: "enemy",
                 cast(state, caster, target) {
                   target.statuses = target.statuses || [];
                   target.statuses.push({ id: "poison", turns: 4 });
                   state.emitFx?.("spell_vfx", { target, color: "#7ad06a" });
                   state.log("hit", `${caster.name} curses ${target.name} with Bane.`);
                 } },
};

function heal(unit, amt) {
  unit.hp = Math.min(unit.maxHp, unit.hp + amt);
}
function mana(unit, amt) {
  unit.mp = Math.min(unit.maxMp, unit.mp + amt);
}
