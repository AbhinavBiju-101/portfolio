# SkynetGrid — Version Log

SkynetGrid is a Java LAN administration tool (`GUI` admin console + `Server` hub + `Node` client agent) built for supervised computer-lab monitoring, deployed with the lab assistant's sign-off. This log reconstructs the feature history across all 34 numbered builds plus the `v20A`/`v20B` and "v21 fail" side-branches found in the archive, based on a line-by-line diff of `GUI.java`, `Node.java`, `Server.java`, and `RoundedButton.java` between every consecutive version.

---

## v1 — Initial Prototype
_Last modified: 08 Dec 2025, 08:40_

**Added**
- Core three-part architecture: `Server` (hub), `Node` (client agent), `GUI` (admin console).
- `Server`: accepts client sockets, tracks connected nodes in a `HashMap`, first-connected node becomes "host," broadcasts messages to all nodes.
- `Node`: connects to a hardcoded server IP, basic host/active-node query methods.
- `GUI`: password-gated console (`"letmein"`), static grid of location buttons.

---

## v2 — Live Status Grid + Concurrency Fixes
_Last modified: 08 Dec 2025, 21:54_

**Added**
- `startNodeRefreshTimer` / `refreshNodeStatus`: background daemon thread polls node status every second and recolors the grid (red = active, black = offline, yellow text = host).
- `Node.queryHost()` / `queryNodes()` retry logic (3 attempts).
- Synchronized reads on the client's `DataInputStream` to prevent concurrent-read corruption.
- `Server`: explicit `hostLocation` tracking and a synchronized `nodeMap` for thread-safe node registration; dedicated GUI request handlers for "get active nodes" / "get host location."

**Changed**
- Admin node's location is now suffixed `"-admin"` instead of `"Anonymous"`.
- Password changed from `"letmein"` to `"1"`.

**Removed**
- Old unused "console thread to stop server."

---

## v3 — File Transfer, Remote Launch, Command Menu
_Last modified: 09 Dec 2025, 00:45_

**Added**
- Function menu: **Broadcast, Send File, Launch class (java), Open file, Shutdown, Run Command in Terminal.**
- Password re-prompt flow (`askPassword()`), with per-action confirmation dialogs.
- File-send protocol extended with a `destPath` field so the admin can force a save location on the client or let the client choose.
- `Node`: async query API (`CompletableFuture`-based `queryHostAsync`/`queryNodesAsync`), `getIP()` via `NetworkInterface` enumeration (skips loopback), versioned protocol (`VERSION` constant introduced, starts at 3).
- `RoundedButton` custom Swing component.

**Changed**
- File-send signature now takes a `forcedDest` parameter.

---

## v4 — Remote "Update All" + Reconnect Handling
_Last modified: 09 Dec 2025, 01:59_

**Added**
- **"Update all"** menu action — pushes files to clients with a forced destination path (`/home/student/Downloads/SkynetGrid`), then restarts the client service.
- `Node`: systemd service start/stop helpers, automatic reconnect-after-disconnect logic, `restartHere()` to relaunch the process from a new install location.
- `getIP()` promoted to `Node` (was previously duplicated).

**Changed**
- Function list order tweaked; duplicate `"Open file"` case cleaned up.

---

## v5 — Shutdown Filtering
_Last modified: 09 Dec 2025, 05:37_

**Added**
- `Node.sendShutdownRequest(sender)` — shutdown requests now carry the requester's identity.
- `Server.shutdownServer(filter)` — shutdown can target a filtered subset of nodes instead of everyone.

**Removed**
- Old unfiltered `shutdownServer()`.

---

## v6 — Persistent Location File
_Last modified: 09 Dec 2025, 07:33_

**Added**
- `Node.readLocationFromFile()` — node location is now read from a `Location` file on disk instead of being hardcoded, so the same build can be deployed to many machines with different identities.

**Removed**
- Hardcoded `location = "R2C3"` default.
- Old inline loopback-skip logic (superseded by file-based approach in v7).

---

## v7 — Multi-Server Discovery
_Last modified: 09 Dec 2025, 08:56_

**Added**
- `Node`: tries a list of candidate `SERVERS` IPs in turn rather than one fixed address; virtual/Docker/veth network interfaces are now explicitly filtered out of IP discovery.
- `GUI.main()` becomes the real entry point (previously `start()`).

---

## v8 — LAN Auto-Discovery
_Last modified: 10 Dec 2025, 01:17_

**Added**
- `Node.discoverServer()` — broadcasts on the LAN to find a running server automatically instead of relying on a static IP list.
- `Server.getLocalLanAddress()` — determines its own LAN-facing address for discovery replies.
- `GUI`: now starts its own embedded `Node` in the background non-blocking.

**Removed**
- Static `SERVERS[]` candidate-IP list (superseded by broadcast discovery).

---

## v9 — UDP Discovery Refinement
_Last modified: 10 Dec 2025, 05:24_

**Added**
- Fixed listening port (`50001`) for discovery `DatagramSocket`.
- Loopback/Docker interface filtering re-applied to the discovery path.
- `Server`: replies to discovery unicast directly back to the requester's IP/port.

---

## v10 — Leader Election
_Last modified: 10 Dec 2025, 06:42_

**Added**
- `Node.tryBecomeServer()` — nodes attempt to "lock" the server role via a socket-based election; if no server is discovered, the first node to grab the lock spins up the `Server` locally and the rest connect to it. This removed the need for a person to manually start a hub.

---

## v11 — Folder Transfer + Admin Password Split
_Last modified: 11 Dec 2025, 07:51_

**Added**
- **"Send Folder"** action — recursively walks a chosen folder and sends every file to selected clients.
- **"Stop Server"** action.
- `askAdminPassword()` — separate confirmation gate for admin-only actions (distinct from login password).
- `Node.readData(fileName)` — generic key-value file reader (used later for `Location`/`Hash`).

**Changed**
- File receive logic reworked to always resolve `saveTo` against a forced path.

---

## v12 — Async Multi-File Update, Election Port
_Last modified: 12 Dec 2025, 00:46_

**Added**
- `Server`: dedicated `ELECTION_PORT` (49999) for the leader-election handshake, kept open deliberately ("do NOT close this socket") so late-joining nodes can detect an existing server.
- `Update all` reworked to send files to every selected computer **asynchronously in parallel**, waiting for all transfers to finish before restarting services, with a confirmation dialog when complete.

**Removed**
- The v11-era systemd service-file writer embedded in `Node` (service management logic was being reworked, reappears differently in v25).

---

## v13 — Remote Terminal Execution
_Last modified: 23 Dec 2025, 08:48_

**Added**
- **"Run Command in Terminal"** — runs an arbitrary bash command on the target node via `ProcessBuilder`, inheriting the terminal's I/O so spawned GUI windows are visible on the client.
- Toggleable multi-select highlighting on the grid buttons.

---

## v14 — Live Screen Streaming
_Last modified: 11 Jan 2026, 23:08_

**Added**
- **"View Screen"** action — first version of remote screen viewing.
- `Node`: new inner classes `ScreenStreamer` (captures the local screen via `java.awt.Robot`, JPEG-encodes frames, streams at ~20 FPS to the server) and `ScreenViewer` (Swing panel that receives and paints incoming frames).
- `Server`: dedicated screen-relay layer — `startScreenServer()`, `handleScreenConnection()`, `addScreenViewer()`; server forwards a target node's captured stream to any admin viewers watching it, without closing either socket.
- Protocol extended with an `MSG` type discriminator (`CMD` vs `SCREEN`).

---

## v15 — Adaptive Screen Streaming
_Last modified: 12 Jan 2026, 00:39_

**Added**
- Change-detection: `computeHash()` / `hasChanged()` — frames are only sent when the screen content actually changes (perceptual hash + threshold), cutting bandwidth versus constant 20 FPS.
- Socket timeouts and a cleaner `receiveLoop()`/`cleanup()` lifecycle for the viewer.

**Removed**
- Old fixed-rate unconditional frame capture loop.

---

## v16 — Version Reporting, Display Server Detection
_Last modified: 14 Jan 2026, 00:09_

**Added**
- `Node.queryVersionAsync()` — nodes report their build `VERSION` back to the admin so the GUI can show per-node version tooltips.
- `isX11Session()` / `isWaylandSession()` detection (screen capture behaves differently under Wayland).
- `GUI`: async version query wired into the refresh loop; button tooltips now show `node@ip:version`.

**Changed**
- **"Stop Server"** renamed/replaced with **"Restart Server."**

---

## v17 — Screen Viewer Window Polish
_Last modified: 14 Jan 2026, 06:05_

**Added**
- Proper viewer window lifecycle: cleanup on close, near-square auto grid sizing for multi-viewer layouts, host highlighting and status coloring in the viewer chrome.
- **"Toggle Admin Nodes"** — show/hide admin-only nodes in the grid.

---

## v18 — Maximize/Restore Viewer
_Last modified: 14 Jan 2026, 19:56_

**Added**
- Click-to-maximize screen viewer with mouse enter/exit/click handling and a restore-to-grid control.
- Startup watchdog for the viewer (detects a node that never sends a first frame vs. one that's genuinely idle).

---

## v19 — Remote Keyboard & Mouse Control
_Last modified: 15 Jan 2026, 06:43_

**Added**
- Full remote-input forwarding: `MOUSE_MOVE`, `MOUSE_DOWN`, `MOUSE_UP`, `SCROLL`, `KEYDOWN`, `KEYUP` message types.
- `Node.handleInputEvent()` replays the received input locally via `java.awt.Robot`.
- `GUI`: coordinate remapping (`mapToRemote`) from the maximized viewer window back to the real remote screen resolution; ~60 FPS input send cap; forced key-release on focus loss to avoid "stuck key" bugs.
- `Server`: now caches each node's **latest frame** so a newly-attached viewer sees something immediately instead of a blank window.
- Node install-time autostart registration (`enableNodeAutostart`) folded into normal client boot, controllable independently of the GUI.

---

## v20A — Theming Pass
_Last modified: 15 Jan 2026, 07:33_

**Added**
- Darker function-panel and button color scheme, smaller button font, custom scrollbar styling import.

## v20B — Server Election Rework (Successor/Follower Roles)
_Last modified: 16 Jan 2026, 04:49_

**Added**
- Formal `Role` enum (`NORMAL`, `SUCCESSOR`, `FOLLOWER`) replacing the earlier binary "am I the server" lock: a node can now be pre-designated as a **successor** and take over hub duties if the server disappears, or **follow** a newly announced successor.
- `discoverServerWithGrace()` — grace period so nodes don't immediately re-elect during a brief server restart.

**Removed**
- The simple `tryBecomeServer()` socket-lock election from v10–v12.

---

## v21 — Election Rollback
_Last modified: 18 Jan 2026, 05:17_

**Changed**
- The v20B role-based election/successor system was reverted back to the simpler v12-era direct election + reconnect model (`tryBecomeServer`, `closeClient`). The successor/follower `Role` machinery was removed as too fragile for the lab network conditions.
- `GUI.start()` no longer starts its embedded `Node` from `main()` directly (moved).

### Side branch: "SkynetGrid v21 fail"
An experimental, ultimately abandoned variant found alongside v21:
- Took the admin password as a **command-line argument** instead of prompting (`args[0]`), which would crash on launch with no args.
- Password check switched to a per-location hash scheme (`"Pass#"+location+Node.readData("Hash")`).
- Function-panel permission gating (disabling buttons for non-authorized admins) and the password prompt were both commented out/disabled — marked "fail" and not carried forward into v22.

---

## v22 — Protocol Version Bump, Node Init Refactor
_Last modified: 20 Jan 2026, 06:31_

**Added**
- `Node.initialize()` and `SERVER_VERSION` tracking for basic client/server version negotiation.

---

## v21 (fail) — Abandoned Rewrite
_Last modified: 18 Feb 2026, 20:33_

Not actually from the v21/v22 window despite the folder name — its `GUI.java`, `Node.java`, and `Server.java` are dated a full month after v22. This was a rewrite attempt started about a month into the v23+ stretch, named "v21" to mark what it was based on rather than when it happened, then set aside; nothing from it made it into a later numbered version.

---

## v23 — Maximize/Snap UI, Compile-and-Run Remote
_Last modified: 23 Feb 2026, 06:32_

**Added**
- `ScreenWrapperPanel` — dedicated wrapper class handling maximize/restore, hover UI (top-center label, maximize button), and all keyboard/mouse forwarding for the viewer (extracted out of `GUI` into its own reusable component).
- **Remote compile workflow**: admin can send raw Java source files to selected clients, have them compiled in place, and restart the client automatically.
- Wayland detection code (`isX11Session`/`isWaylandSession`) removed in favor of a simpler "poll until server appears" retry loop; `Robot` construction now tolerates `AWTException` on unsupported sessions instead of pre-checking.

---

## v24 — Screenshot & Browser-Pause "Prank" Commands
_Last modified: 26 Feb 2026, 05:04_

**Added**
- **"Take Screenshot"** action with a dedicated camera-icon UI control on the viewer.
- **"Pause Browser"** action with a duration prompt.
- Snap-window button added next to maximize.
- Viewer frame buffering: `getCurrentFrame()` lets the UI grab the latest decoded frame outside the network thread (avoids tearing/blocking).

**Removed**
- Old inline camera icon comments/placeholder code cleaned up as the feature was finalized.

---

## v25 — FPS-Adaptive Streaming
_Last modified: 26 Feb 2026, 07:22_

**Added**
- Live FPS counter/label on the viewer, computed via `updateFps()`.
- `setRepaintRate()` — viewer repaint speed increases when maximized (more responsive when actively watched) and drops when minimized (saves CPU/bandwidth).
- Frame decoding moved off the network receive thread onto a background decode step.

---

## v26 — Alt+Tab, Log Viewer, Self-Healing Install
_Last modified: 26 Feb 2026, 08:54_

**Added**
- **"Alt+Tab"** remote action (synthesizes the key combo on the target).
- **"View Logs"** action.
- `Node.backupSelf()` — client periodically backs up its own class files; on startup it can **restore itself from backup** and recreate its systemd service file if either goes missing (resilience against a student deleting/tampering with the install).
- `onQueryResult` callback plumbing so remote command output can be routed back and displayed in the admin GUI (used by "View Logs"/"Run Command").

**Removed**
- Older ad-hoc `MSG|CMD|INPUT` parsing scattered across the message handler, consolidated into the new query/result callback path.

---

## v27 — Query Console, Grid Layout Rework
_Last modified: 27 Feb 2026, 00:42_

**Added**
- **"Run Query"** action — free-text command box whose output is displayed back in a results window (`showQueryResult`), distinct from the older "fire-and-forget" terminal command.
- Grid buttons reorganized into logical groups (a "Transfer" submenu bundling Send File/Send Folder/Launch/Open) and a `shouldReverseGrid()` layout tweak so buttons in odd rows face the opposite direction (visual symmetry for the physical lab layout).
- "Switch Window" button placeholder added next to the snap control.

**Removed**
- Standalone Alt+Tab top-level button (folded into the reorganized menu).

---

## v28 — Login Screen Restoration
_Last modified: 27 Feb 2026, 07:45_

**Changed**
- Password gate (`askPassword`) and the "Incorrect Password" dialog were reinstated after being effectively bypassed in the v21 "fail" experiment lineage.
- Viewer repaint rate tuned (60 FPS max when focused instead of 50).

---

## v29 — Background Decode Thread, Persistent Autostart Naming
_Last modified: 27 Feb 2026, 22:25_

**Added**
- Dedicated single-thread `ExecutorService` for frame decoding (further isolates network I/O from UI work).
- Client autostart service renamed from `"SkynetGrid"` to the disguised name **`"systemd-runtime"`**, matching the covert-install scheme described in the deployment instructions.

**Removed**
- Old inline "compile all java files" comment block (compile-and-run logic already stabilized from v23 onward).

---

## v30 — Screen Recording (AVI Export)
_Last modified: 28 Feb 2026, 00:24_

**Added**
- **Screen recording** — a "Record" button captures a sequence of frames from a viewer and writes them out as an uncompressed/MJPEG **AVI file** (hand-rolled RIFF/AVI container writer: `writeAvi`, `writeLe16`, `writeLe32`, header/index chunk construction) with a recording indicator overlay.

---

## v31 — Stability Checkpoint
_Last modified: 28 Feb 2026, 05:10_

No functional code changes from v30; packaged as a checkpoint build (identical `GUI.java`/`Node.java`/`Server.java`/`RoundedButton.java` sources).

---

## v32 — Remote File Explorer (v1)
_Last modified: 02 Mar 2026, 19:54_

**Added**
- **"File Explorer"** action — new file-browser window listing a remote directory (parsed from `ls -la` output) with Up/Refresh/Download/Delete buttons and double-click-to-open-folder navigation.

---

## v33 — File Explorer Rewrite (Full-Featured)
_Last modified: 02 Mar 2026, 21:07_

**Added**
- `FileExplorer` promoted to its own full class (previously inline in `GUI`) with: toolbar, path bar with direct navigation, status bar, sortable listing (folders first), custom `FileListRenderer` with **hand-drawn file-type icons** (folder, document, image, audio, video, archive, symlink, generic/unknown — all drawn programmatically, no image assets).
- Create Folder, Rename, Delete (with confirmation), Download File, and **Download Folder** (server-side zip, then transferred and cleaned up).
- Image **preview** on double-click (downloads to a temp file first).
- Binary-safe remote `cat`: uses the existing `QUERY_CMD` channel with base64 encoding to pull arbitrary file bytes through the text-based command protocol.
- Temp-file cleanup tracking so preview/download scratch files don't accumulate on the admin machine.
- `Server`: per-admin session `pass` field added (auth prep for v34's fix).

---

## v34 — Theme System, Admin Auth Fix (Latest)
_Last modified: 03 Mar 2026, 00:55_

**Added**
- **Light/Dark theme switcher** — `"Switch Theme"` menu action.
- `RoundedButton` rewritten around a `Theme`/`State` model: buttons now have an explicit `State` enum (`OFFLINE`, `ACTIVE`, `SELECTED`, `DEAD`) mapped to themeable colors instead of raw `setBackground()` calls, with `DARK`/`LIGHT` `Theme` presets and helper methods (`markActive()`, `markDead()`, `markOffline()`, `toggleSelected()`, `applyTheme()`).
- `Node.queryResultHandlers` — per-request callback map replacing the older single `onQueryResult` field, allowing multiple concurrent remote-query results to be routed correctly.

**Fixed**
- Admin login password hash bug: the expected hash was being computed against the **full** `"location-admin"` string instead of just the base `location`, which would have made admin passwords impossible to match correctly; now split on `"-"` before hashing.

**Removed**
- Old preview-only "Download to temp, show image" code path in `FileExplorer`, consolidated into the general download flow.

---

## Final — Repackaged Build
_Last modified: 04 Mar 2026, 08:11_

An unlabelled folder dated a day after v34, source-checked the same way as every other flagged gap in this log. No functional changes turned up in a diff against v34 — this looks like a repackage/export pass rather than a new feature build, so it's noted here rather than given its own numbered heading.

---

## Summary of Feature Timeline

| Capability | Introduced | Notes |
|---|---|---|
| Basic grid + broadcast | v1 | |
| Live node status polling | v2 | |
| File send / remote launch / shutdown | v3–v5 | |
| Auto server discovery (LAN broadcast) | v8–v9 | |
| Leader election (self-hosting hub) | v10, reworked v20B, reverted v21 | |
| Folder transfer | v11 | |
| Remote terminal command execution | v13 | |
| Live screen viewing | v14, adaptive v15 | |
| Remote mouse/keyboard control | v19 | |
| Remote compile & run | v23 | |
| Screenshot / pause-browser / Alt+Tab "prank" tools | v24, v26 | |
| Self-healing install / disguised autostart | v26, v29 | |
| Screen recording to AVI | v30 | |
| Remote file explorer | v32, rewritten v33 | |
| Theming system | v34 | |
| Admin auth hash fix | v34 | |

*Log generated from a diff of the four core source files (`GUI.java`, `Node.java`, `Server.java`, `RoundedButton.java`) across all 34 build folders in the provided archive.*
