// Items and spells.

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
                   state.log("hit", `${caster.name} calls Holy Light — ${target.name} takes ${dmg}.`);
                 } },
  lightning:   { name: "Sky-Sunder",    mp: 8,  target: "enemy",
                 cast(state, caster, target) {
                   const base = 20 + caster.lvl * 3 + (state.flags.shrine_vilya ? 8 : 0);
                   const dmg = base * (target.weak === "lightning" ? 2 : 1);
                   target.hp -= dmg;
                   state.emitFx?.("damage_enemy", { enemy: target, dmg });
                   state.log("hit", `${caster.name} hurls Sky-Sunder — ${target.name} takes ${dmg}.`);
                 } },
  star_arrow:  { name: "Star Arrow",    mp: 5,  target: "enemy",
                 cast(state, caster, target) {
                   const dmg = 16 + caster.lvl * 3;
                   target.hp -= dmg;
                   state.emitFx?.("damage_enemy", { enemy: target, dmg });
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
                   state.log("hit", `${caster.name} ${crit > 1 ? "lands a critical " : ""}Shadow Strike on ${target.name} for ${dmg}.`);
                 } },
};

function heal(unit, amt) {
  unit.hp = Math.min(unit.maxHp, unit.hp + amt);
}
function mana(unit, amt) {
  unit.mp = Math.min(unit.maxMp, unit.mp + amt);
}
