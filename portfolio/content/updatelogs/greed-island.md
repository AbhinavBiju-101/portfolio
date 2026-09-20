# Greed Island — Update Log

Greed Island is a multithreaded evolutionary simulation: autonomous agents, each running as its own thread, make probabilistic decisions from inherited traits and compete for limited resources across a map, reproducing and mutating between generations.

This log covers the 10 folders in the archive (`v1`–`v8`, plus `v6.5` and the `v6_simulated_branchA` side-branch), from a line-by-line diff of the core simulation classes between consecutive versions.

**A note on the archive:** this BlueJ folder doubled as a general scratchpad for years, so most versions also contain unrelated practice code — `Goldbach.java`, `Hamming.java`, `OddEven.java`, `TransArray.java`, threading tutorials, a `MultiTabBrowser`, an early `ChatServer`/`ChatClient` pair, `NumberToWords200Scales`. None of that is part of the simulation, and it's excluded from the analysis below. The count of "core" classes is what matters, not the raw file count.

**At a glance:** 13 core classes → a trait-inheritance engine with per-agent threads, a crafting tree, a weighted-travel map and generational mutation.

---

## v1 — Foundation
_Last modified: 08 Aug 2025, 00:20_

**Added**
- The base object model: `Character`, `Item`, `Inventory`, `Location`, `Listener`, `Dialogue`, `Decision`, `RarityPool`, `itemType`, `Greed_Island` (the driver).
- `RarityPool` — the weighted-random drop system carried over directly from **Mining Simulator**, which is where the whole idea of probability-weighted selection in this project comes from.
- `Decision` with a `Decide`/`setTrait` interface — the earliest sketch of agents choosing actions.

---

## v2 — Crafting, Items, Threading
_Last modified: 14 Aug 2025, 00:52_

**Added**
- A real item hierarchy: `Resource`, `Craftable`, `Edible`, `Weapon`, plus concrete items — `Apple`, `Berries`, `Poisonous_Berries`, `Wood`, `Logs`, `Sticks`, `Stone`, `Vines`, `Axe`, `Bow`, `Arrows`, `Poison_Arrows`.
- `canCraft()` / `getCraftable()` / `craft()` — a recipe tree, so items combine into better items.
- `eat()` and edible effects, including poisoning.
- `Menu` for console interaction, `Entry`/`Hash`/`Comparison` helper types.
- `FListener` / `BiFListener` — the first functional-listener types, and `Task` / `SleepTask` / `TimeSetter` / `Runner`, the beginnings of the event scheduler.
- `getContestantsAt()` — agents become location-aware of each other.

**Removed**
- `Decision.java` — the interface-based approach is dropped in favour of probability tables on `Character` itself.

**Changed**
- `Character` +208/−52, `Inventory` +79/−66 — the largest early rewrite.

---

## v3 — Duplicate Upload
_Last modified: 14 Aug 2025, 02:49_

**Note**
- Every file appears twice, as `Name.java` and `Name (1).java`. This is a Google Drive duplication artifact from re-uploading the folder, not a real version.

**Added**
- The only genuine changes: `getHungerUnits()`, `getTime()` and `setInfluence()` — the first hook for one agent's actions influencing another's decision weights.

---

## v4 — Pruning, HTML Output, Networking Experiment
_Last modified: 15 Aug 2025, 04:25_

**Added**
- `HtmlWriter` + `output.html` — dumps simulation state to a browsable HTML report instead of only console text.
- `network.java` — an early, abandoned attempt at running the simulation across machines.
- `getAttackUnits()`, `getCraftUnits()`, `menuAction()`, `RListener`.

**Removed**
- The first real cleanup: all the unrelated practice classes (`Goldbach`, `Hamming`, `OddEven`, `TransArray`, `Entry`, `Hash`, `NumberOperator`, `FItest`, `Task`, `checker`, threading tutorials) are deleted from the project folder. −425 lines net.

---

## v5 — Event Scheduler, Dialogue System
_Last modified: 16 Aug 2025, 04:20_

**Added**
- `StateListener` and `TickListener` — the simulation clock gains typed listeners that fire on state change and on every tick, replacing ad-hoc polling.
- `enqueueAndWait()` — ordered, blocking task handoff between agent threads, which is what stops 20 concurrent agents from corrupting shared state.
- `printMessage()` / `printParagraph()` — the message-pacing system that makes a 20-agent simulation readable as a narrative instead of a wall of output.
- `start()` / `stop()` lifecycle on listeners.

**Changed**
- `Character` +156/−144 and `Listener` +154/−86 — a near-total rewrite of how agents are driven.
- `Dialogue` +182/−16 — event narration.

---

## v6 — Peak Scratchpad, Map Rendering
_Last modified: 19 Aug 2025, 03:14_

**Added**
- `MapWithCharacters` and `paintComponent()` — a graphical view of agent positions on the map.
- `Raise`, `comparator`, `makeComparable` — sorting and comparison utilities for ranking agents.

**Note**
- This is the folder with the most unrelated code in it (`ChatServer`, `ChatClient`, `MultiTabBrowser`, `StringToBinary`, `NumberToWords200Scales`, a `script.js`/`index.html` pair). The simulation itself grows modestly; the folder grows by 2,705 lines mostly from scratch work.

---

## `v6_simulated_branchA` — Cooking Branch
_Last modified: 19 Mar 2026, 08:58_

A side-branch off v6, not a sequential version.

**Added**
- `Fire`, `Coal`, `Salmon`, `Cooked_Salmon` — a cooking mechanic: light a fire, cook raw food into better food.
- `Apple` +108/−20 as the edible model generalises.

**Removed**
- Everything unrelated to the simulation (`ChatServer`, `ChatClient`, `HtmlWriter`, `MultiTabBrowser`, `network.java`, `output.html`) — this branch is the clean-room version of v6.

*The cooking items survive into the mainline; the HTML/network experiments do not.*

---

## v6.5 — Checkpoint
_Last modified: 20 Mar 2026, 09:54_

**Changed**
- Minor `Location` and `Apple` corrections. A `__SHELL1.java` BlueJ scratch file appears.

---

## v7 — Travel Costs, Final Prune
_Last modified: 31 Jul 2026, 08:57_

**Added**
- `TravelCosts` with a nested `Route` type, plus `addRoute()`, `findRoute()`, `getTravelCost()`, `addDestination()` — the map becomes a weighted graph. Moving between locations now costs energy proportional to distance, so travel is a real decision with a tradeoff rather than a free action.
- `Container` — generalised storage.

**Removed**
- The last of the scratch files (`Code_bin`, `Comparison`, `TO_DO_LIST`, `__SHELL1`, `itemType`) and the dead decision types (`Decision1`, `Decision2`, `Observe`, `Drink`, `Runner`, `SleepTask`, `TimeSetter`, `MapWithCharacters`).
- The graphical map view is dropped — the simulation goes back to being console-only.

**Changed**
- `Resource` +329/−15 — the item system consolidates into one place. `Item` −89. Net −958 lines.

*This is the version where the project stops being a folder of experiments and becomes a single coherent simulation.*

---

## v8 — Trait Inheritance Tuning (Latest)
_Last modified: 01 Aug 2026, 04:12_

**Added**
- `setDecisionProbabilities()` — the final form of the genetics model. Each agent carries a `Traits` map (`Sleep`, `Travel`, `Eat`, `Give`, `Craft`, `Attack`, `DecisionFrequency`); offspring inherit the parent's values with a per-trait mutation delta applied, and the decision probability model is rebuilt from the mutated traits rather than reset to defaults.

**Changed**
- `Character` +363/−345 — an almost complete rewrite of the inheritance and mutation path, and the single largest same-file churn in the project's history.

---

## Summary of Feature Timeline

| Capability | Introduced | Notes |
|---|---|---|
| Core agent/item/location model | v1 | |
| Weighted rarity pools | v1 | carried over from Mining Simulator |
| Crafting tree | v2 | |
| Edibles, hunger, poisoning | v2 | |
| Per-agent threads | v2–v5 | listener/scheduler model settles in v5 |
| Cross-agent influence | v3 | |
| HTML state report | v4 | dropped by v7 |
| Distributed simulation | v4 | abandoned experiment |
| Tick/state listeners | v5 | |
| Message pacing | v5 | |
| Graphical map view | v6 | dropped by v7 |
| Cooking (fire, coal, salmon) | `v6_simulated_branchA` | merged to mainline |
| Weighted travel graph | v7 | travel becomes a costed decision |
| Trait inheritance + mutation | v8 | the generational loop |

*Log generated from a diff of `Character.java`, `Item.java`, `Inventory.java`, `Location.java`, `Listener.java`, `Dialogue.java`, `Menu.java`, `RarityPool.java`, `Resource.java` and `Greed_Island.java` across all 10 folders in the archive, with unrelated scratch code excluded.*
