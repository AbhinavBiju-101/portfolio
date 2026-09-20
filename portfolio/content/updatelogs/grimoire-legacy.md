# Grimoire: Legacy — Update Log

Grimoire: Legacy began as a pen-and-paper duelling game — two players pick five spells each from a shared grimoire, cast one per turn simultaneously, and resolve the results by hand with a calculator. It stopped being tractable on paper once spells started interacting with each other, so it was rebuilt in Java as a full combat engine.

This log reconstructs the build history across the 17 folders in the archive (`v2` through `v15`, plus the intermediate `v6.5`/`v6.7` builds and the final `Grimoire_Legacy` folder), from a line-by-line diff of the core sources between every consecutive version. `v1` was not preserved.

**At a glance:** 6 spells → 59 spells · 450 → 10,665 lines · flat effect application → a simultaneous-resolution engine with a linked-list turn queue, stacking effects, cooldowns and AI opponents.

---

## v2 — First Java Port
_Last modified: 31 Oct 2025, 00:40_

**Added**
- The six core classes the whole engine still rests on: `Grimoire` (the spell catalogue), `Game` (the loop), `Player`, `Spell`, `Effect`, and `Turn`.
- Six starting spells, defined as anonymous `Spell` subclasses that each override `apply()` — the pattern every later spell follows.
- Straight damage, defence and healing resolution.

*This is the direct translation of the paper rules: pick spells, cast, subtract numbers.*

---

## v3 — Effect Subclassing, Turn Rows
_Last modified: 31 Oct 2025, 08:37_

**Added**
- `AttackEffect`, `DefenceEffect` and `HealEffect` split out of the single generic `Effect` — each kind of effect now resolves itself rather than `Game` branching on a type field.
- `Row` — the display/record unit for a single turn, with `addLeft()` for player-A output.
- `applyDef()` for defence subtraction.

**Note**
- This folder is stored as duplicated `… (1).java` files — a Google Drive copy artifact from re-uploading the same folder, not a real code change.

---

## v4 — Chained Spells, Two-Sided Turn Rows
_Last modified: 31 Oct 2025, 09:47_

**Added**
- `SingleSpell` and `ChainSpell` — the first split between one-shot spells and spells that queue follow-up effects onto later turns.
- `Row.addRight()` and `getPrevious()`, completing the two-column battle-log layout (player A on the left, player B mirrored on the right) that the engine still prints.

---

## v5 — Full Spell Catalogue, Formatted Console
_Last modified: 31 Oct 2025, 22:58_

**Added**
- Spell count jumped from 6 to 19 — the first real grimoire rather than a test set.
- `initializeDisplay()` and a proper `main()` entry point.
- Formatted console output: aligned columns, spell tables, the turn-by-turn battle log.

**Changed**
- `Grimoire` rewritten around a declarative `Spell[]` array (+94 lines) instead of ad-hoc construction.

---

## v6 — Defence as a First-Class Object
_Last modified: 02 Nov 2025, 00:05_

**Added**
- `Def.java` — defence is no longer a plain integer on `Player`; it becomes a stackable object with its own duration, so multiple shields can overlap and expire independently.
- `EffectType.java` — the `Attack` / `Defence` / `Healing` / `Buff` / `Debuff` enum that spells are categorised by.
- `defSum()` for totalling active defence.

**Changed**
- Heavy rewrite across `Player` (+155) and `Grimoire` (+107/−70) to route everything through the new defence and effect-type model.

*This is the first version where the engine models state rather than just arithmetic.*

---

## v6.5 — Spell Catalogue Expansion
_Last modified: 02 Nov 2025, 02:03_

**Added**
- Spell count 19 → 45. `Grimoire.java` grows by 354 lines almost entirely in spell definitions: damage-over-time, multi-hit barrages, multi-turn defences, buffs and debuffs.

**Changed**
- `Game` resolution logic reworked (+72/−38) to handle the wider variety of effect timings the new spells needed.

---

## v6.7 — Resolution Order Fixes
_Last modified: 03 Nov 2025, 06:17_

**Changed**
- `Game` (+56/−23): corrections to the order in which simultaneous effects resolve — the hard part of "both players cast at once" is deciding what lands before what.

---

## v7 — Turn Queue Rework
_Last modified: 05 Nov 2025, 08:02_

**Changed**
- `Row` (+41/−4) reworked so turns link forward and backward, letting a spell reach `game.currentTurn.next.next` to schedule an effect three turns ahead. This is the linked-list turn queue the project is known for.

---

## v8 — Menu System
_Last modified: 06 Nov 2025, 03:11_

**Added**
- `Menu.java` with a nested `Option` type, plus `add()`, `validate()`, `getInput()` and `sort()` — a reusable console menu instead of hand-rolled `switch` blocks.

**Changed**
- `Game` (+106/−95) largely rewritten to drive itself through the menu rather than a fixed prompt sequence.

**Removed**
- The inline input-parsing code the menu replaced.

---

## v9 — AI Opponents
_Last modified: 11 Dec 2025, 05:35_

**Added**
- `Enemy.java` — the first computer-controlled opponent, with `initialize()` and `choice()` for automatic spell selection.
- `Game` grows +176 lines wiring single-player mode in alongside the existing two-player duel.

*Intent expansion: up to here it was strictly a two-human duelling engine. This is where it becomes a game you can play alone.*

---

## v10 — Prototype Cloning, Crits, Loadouts
_Last modified: 12 Dec 2025, 21:22_

**Added**
- `Clone` — Prototype-pattern state cloning, so a match can be reset or a hypothetical resolved without rebuilding every object.
- `CritEffect` — critical hits.
- `setLoadout()`, `resetPlayers()`, `resetTurns()`, and the split between `fight_duel()` (player vs player) and `fight_enemy()` (player vs AI).

**Removed**
- `getCurrentTurn()` / `getPlayer()` accessors, folded into the reset logic.

**Changed**
- `Game` heavily pruned (+109/−197) — the largest net deletion in the project, as duplicated duel/enemy code collapsed into shared paths.

---

## v11 — Cast Legality
_Last modified: 13 Dec 2025, 00:48_

**Added**
- `canCast()` — cooldown and duration are now checked before a spell is allowed, rather than being corrected after the fact.

---

## v12 — Capacitor Effects, Enemy Depth
_Last modified: 19 Dec 2025, 06:31_

**Added**
- `CapacitorEffect` — effects that charge over several turns and discharge later.
- `Enemy` gains +50 lines of selection logic.

**Changed**
- `Effect` (+54) and `Grimoire` (+67/−71) reworked around the charge/discharge model.

---

## v13 — Multiplier Effects, Documentation Pass
_Last modified: 21 Dec 2025, 01:38_

**Added**
- `MultiplierEffect` — percentage attack/defence scaling, the mechanic behind buffs like Focus and debuffs like Taunt.
- Spell count 45 → 58.
- Full generated Javadoc (30 HTML files) committed alongside the source.

**Removed**
- `SingleSpell` / `ChainSpell` — the v4 split is retired. Every spell is now a plain `Spell` whose `apply()` schedules whatever effects it likes onto whichever turns it likes, which turned out to subsume both cases.
- `displayLoadout()`, folded into the menu.

**Changed**
- `Grimoire` +281/−126, `Row` −88 (simplified once the spell hierarchy flattened), `Spell` −30.

*The Javadoc inflates the line count from ~2,100 to ~10,600 here; the real code change is the effect-multiplier system and the spell-hierarchy flattening.*

---

## v14 — Cleanup
_Last modified: 21 Dec 2025, 05:34_

**Removed**
- `__SHELL12.java`, a stray BlueJ scratch file.

**Changed**
- Minor `Enemy` tuning.

---

## v15 — Enemy Behaviour Tuning
_Last modified: 24 Dec 2025, 06:50_

**Changed**
- `Enemy` (+42/−1) — smarter spell choice; `Grimoire`, `Game`, `Effect` and `Player` each get small balance corrections.

---

## Final build (`Grimoire_Legacy`) — Balance Pass
_Last modified: 02 Aug 2026, 01:43_

**Changed**
- Small corrections across `Game` (+4/−12), `Grimoire` (+12/−2), `Player` and `Menu`. No new mechanics — this is the settled version.

---

## Summary of Feature Timeline

| Capability | Introduced | Notes |
|---|---|---|
| Core duel loop, damage/heal/defence | v2 | direct port of the paper rules |
| Typed effect subclasses | v3 | |
| Two-column battle log | v3–v4 | |
| Chained / multi-turn spells | v4 | retired v13, subsumed by general `apply()` |
| Stackable defence objects | v6 | |
| Effect-type taxonomy | v6 | |
| Linked-list turn queue | v7 | |
| Reusable console menu | v8 | |
| AI opponents | v9 | first single-player mode |
| Prototype-pattern cloning | v10 | |
| Critical hits | v10 | |
| Cooldown/duration gating | v11 | |
| Charge-and-discharge effects | v12 | |
| Percentage multiplier effects | v13 | |
| Generated Javadoc | v13 | |

**Spell growth:** v2 → 6 · v5 → 19 · v6.5 → 45 · v13 → 58 (the shipped catalogue expands further at runtime through spell-set combinations).

*Log generated from a diff of `Grimoire.java`, `Game.java`, `Player.java`, `Spell.java`, `Effect.java`, `Turn.java`, `Row.java`, `Menu.java` and `Enemy.java` across all 17 build folders in the archive.*
