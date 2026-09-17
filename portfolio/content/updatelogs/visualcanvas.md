# VisualCanvas — Update Log

A Linux desktop visualization and simulation environment that puts computer science, chemistry, mathematics and physics on one editable canvas, saved to a custom `.vcanvas` format.

This log covers the 23 folders in the archive (`v3` through `8.0`, plus the final `Canvas` build), from a diff of the inner classes and methods of `VisualCanvas.java` — a single monolithic source file — between consecutive versions. `v1` and `v2` were not preserved, and `v3` is the earliest folder containing source rather than just compiled classes.

**At a glance:** 43 inner classes / 2,401 lines → 234 classes / 4,272 lines plus a separate 800-line N-body simulator. The arc is a pivot at v4, then steady expansion of chemistry, then a full rigid-body physics engine from v7 on.

**On the `saves/` folders:** from 7.3 onward each version carries a `saves/` directory of `.vcanvas` files (`pulleys`, `rope`, `piston`, `rocket`, `robot`, `balloon`, `jeeLevel`, `1000_kg_planet`, `infinite energy`, `noGravityTest`). These are test scenes used to check the physics engine against known setups, not features — they're what makes the archive bulky.

---

## v3 — Earliest Preserved Build
**Contains** — 43 classes, and a wider scope than the project ended up with:
- **Framework:** `AppFrame`, `CanvasPanel`, `Session`, `AnimEngine`, `AnimState`, `UndoManager`, `UndoableAction`, `Draggable`, `Connector`, `FolderPanel`.
- **CS structures:** `DSRenderer`, `LLRend` (linked list), `StackRend`, `QueueRend`, `DequeRend`, `CQRend` (circular queue), `HeapRend`, `TreeRend` with `T`/`TNode`, `GraphRend` with `GN`/`GE`.
- **Chemistry:** `ChemRenderer`, `Atom`, `Bond`, `ChemFolderPanel` — with `buildH2O()`, `buildCH4()`, `buildCO2()`, `buildNH3()`, `buildBenzene()`, `buildEthanol()`, `buildAcetone()`, `buildHexane()`, `buildH2SO4()`, `buildHCl()`, `buildEthane()`, `buildH2O2()`.
- **Mathematics:** `MathFolderPanel`, `VennRend`, `MatrixRend` + `Mat`, `VectorRend` + `Vec`, `FuncGraphRend` + `Func`, and `ExprEval` — a hand-written expression evaluator for graphing arbitrary functions.
- **Physics:** `PhysicsRenderer`, `PhysObj`, `PhysicsFolderPanel`.

---

## v4 — The Pivot
The single biggest change of direction in the project. Line count drops 2,401 → 1,751 as whole modules are cut and the rest is restructured.

**Added**
- `BaseRenderer` — a common abstraction all renderers now extend, instead of each one reimplementing hit-testing and dragging.
- `MouseConsumer` with `onPress()`, `onDrag()`, `onRelease()`, `onRightClick()`, `onRightDragEnd()`, `mouseWheelMoved()` — unified interaction handling.
- `BinomRend` and `binom()` / `binomCoeff()` / `factorial()` — **binomial expansion**.
- `ProbDistRend` with `drawNormal()`, `drawPoisson()`, `drawBinomial()` — **probability distributions**.
- `hitObj()` / `hitConn()` / `activeRenderer()` / `colorFor()`, sidebar collapse/expand, tab duplication.
- Molecule builders renamed to the `bH2O()` / `bCH4()` short form and moved behind the new renderer base.

**Removed**
- `ExprEval`, `Func`, `FuncGraphRend` — function graphing.
- `Mat`, `MatrixRend` — matrices.
- `Vec`, `VectorRend` — vectors.
- `Connector`, `PhysObj`, `PhysicsFolderPanel`, `T` — replaced by `Conn`, `PObj`, `PhysFolderPanel`.

*The maths module is rebuilt around what's actually useful for schoolwork — Venn diagrams, probability, binomial expansion — and the general-purpose CAS ambitions of v3 are dropped.*

---

## v5 — Desktop Integration
**Added**
- `createShortcut()` — installs a desktop launcher.
- `componentResized()` / `componentShown()`, `positionStrip()`, `mouseEntered()` / `mouseExited()` — responsive layout for the tool strip.

---

## v5.5 — Checkpoint
No source change from v5.

---

## v5.8 — Minor Additions
+31 lines of small refinements.

---

## v6 — The `.vcanvas` Format
**Added**
- `saveCanvas()` / `loadCanvas()` / `saveTo()` / `safeFile()` / `saveIntList()` / `loadIntList()` / `loadLine()` — **the custom `.vcanvas` file format**. Projects become persistent documents rather than throwaway sessions.
- `copySelected()` / `pasteSelected()` and `KeyEventDispatcher` / `dispatchKeyEvent()` — clipboard and global keyboard shortcuts.
- `ChemArrow` + `drawArrow()` — reaction arrows, so the chemistry canvas can show a process and not just a molecule.
- `buildFormula()` — molecular formula display.
- Seven more molecules: aniline, cumene, ethylene, HNO₃, methanol, phenol.
- `windowClosing()` — save-on-exit prompt.

---

## v6.2 — Selection and Bonding
**Added**
- `showGroupMenu()`, `pasteFromSelection()`, `setToolAuto()`, `getVertices()`, `bdNoCharge()` (bond without formal charge), `desc()`.

---

## 6.5 — Checkpoint
+17 lines.

---

## 6.7 — Tree and Deque Operations
**Added**
- `rebuildTree()`, `addR()` / `remR()` (recursive insert and remove), `deq()` — real interactive operations on the tree and deque structures rather than static renderings. +342 lines.

---

## v6.8 — Pulleys, Reaction Chemistry
**Added**
- `PulleyConn` — the first non-trivial physics constraint.
- `showArrowMenu()` / `arrowAt()` — reaction-arrow editing.
- `satTest()` — saturation checking.
- Eleven more molecules: diborane, HI, KMnO₄, Na₂Cr₂O₇, NaOH, nitrobenzene, O₂, O₃, PCl₅, toluene. The catalogue now covers most of a school inorganic/organic syllabus.

---

## 6.9 — Rendering Polish
**Added**
- `atomTextColor()` — per-element label colouring.

---

## 7 — Rigid-Body Physics
**Added**
- `applyImpulsePhys()`, `contactVelPhys()`, `findContactPoint()`, `momentOfInertia()`, `radius()`, `resolveCircleCircle()` — impulse-based collision resolution with rotational inertia. This is where the physics module stops being decorative and becomes a real engine.

---

## 7.1 — Contact Manifolds
**Added**
- `contactManifold()` — replaces single-point contact with a proper manifold, so resting objects are stable instead of jittering.
- `pointInPoly()`, `findIdByLabel()`, `showPhysicsSettings()` — a settings panel for gravity, damping and iteration count.

**Removed**
- `findContactPoint()`, superseded.

---

## 7.2 – 7.4 — Refinement
Small corrections; +22, +2 and +66 lines respectively.

---

## 7.5 — Polygon Collision, Pulley Systems
**Added**
- `resolveCirclePolygon()` — circles can now collide with arbitrary polygons, not just other circles.
- `configPulleySystem()` — multi-pulley configuration.

---

## 7.6 — Broad-Phase and Sleeping
**Added**
- `SpatialGrid` with `insert()`, `collectPairs()`, `key()` — spatial hashing for broad-phase collision detection, replacing the O(n²) all-pairs check. This is the change that lets the canvas hold large object counts.
- `sleeping()`, `trySettle()`, `wake()` — objects that come to rest stop consuming solver time until disturbed.

---

## 7.7 – 7.9 — Stabilisation
No source changes to `VisualCanvas.java` across these three. At **7.9**, `NBodySimulation.java` appears — an 800-line standalone gravitational simulator with Barnes–Hut tree approximation (`BHNode`, `NodePool`), its own `SpatialGrid`, and a threaded `Simulation`/`RenderData` split for rendering large body counts.

---

## 8.0 — Cross-Platform Installation
**Added**
- `isWindows()` / `isMac()` / `createShortcutLinux()` — platform detection and per-platform launcher installation.
- `regKeyDefault()`, `regKeyNamed()`, `regDelete()`, `regEscape()`, `notifyShellAssocChanged()`, `runPowerShellEncoded()`, `runLogged()`, `esc()` — Windows registry work to **register `.vcanvas` as a file association**, so saved canvases open by double-click.

---

## Final build (`Canvas`) — Shipped
Identical source to 8.0. This is the packaged build, with `+libs`, the compiled classes and the `saves/` test scenes.

---

## Summary of Feature Timeline

| Capability | Introduced | Notes |
|---|---|---|
| CS structures (list, stack, queue, heap, tree, graph) | v3 | |
| Molecule builder | v3 | 12 molecules, grows to 30+ |
| Venn diagrams | v3 | |
| Function graphing + expression evaluator | v3 | **removed v4** |
| Matrices and vectors | v3 | **removed v4** |
| `BaseRenderer` abstraction | v4 | the pivot |
| Binomial expansion | v4 | |
| Probability distributions | v4 | |
| Desktop shortcut | v5 | Linux/Mac added 8.0 |
| `.vcanvas` save format | v6 | |
| Copy/paste + global shortcuts | v6 | |
| Reaction arrows | v6, editable v6.8 | |
| Interactive tree/deque operations | 6.7 | |
| Pulley constraints | v6.8 | |
| Impulse-based rigid-body physics | 7 | |
| Contact manifolds | 7.1 | |
| Circle–polygon collision | 7.5 | |
| Spatial-hash broad phase | 7.6 | the large-object-count optimisation |
| Sleeping/settling bodies | 7.6 | |
| Barnes–Hut N-body simulator | 7.9 | separate `NBodySimulation.java` |
| `.vcanvas` file association | 8.0 | |

*Log generated from a diff of the inner classes and methods of `VisualCanvas.java` across all 23 folders in the archive, plus `NBodySimulation.java` from 7.9 onward.*
