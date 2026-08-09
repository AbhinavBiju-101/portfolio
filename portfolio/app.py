from flask import Flask, render_template, send_from_directory, abort, redirect, Response, request, jsonify
import os
import re
import json
import time
import uuid
import queue
import shutil
import socket
import threading
import subprocess
import sys
import zipfile
import markdown as md
import requests
from datetime import datetime

app = Flask(__name__)


@app.template_filter("markdownify")
def markdownify(text):
    """Render a markdown string to safe-ish HTML for use in templates."""
    if not text:
        return ""
    return md.markdown(text, extensions=["fenced_code", "tables"])


def load_content_text(relative_path):
    """Read a plain-text file from content/<relative_path>. Keeps long text
    blocks (like a full in-game spell list) out of the PROJECTS dict itself —
    edit the .txt file directly to update what's shown, no code change needed."""
    path = os.path.join(app.root_path, "content", relative_path)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


# Captured directly from the real game's "View Grimoire Spells" output
# (java -jar grimoire-legacy.jar), not hand-typed — see
# content/grimoire-legacy/spell_list.txt to update it (e.g. after adding
# new spells, just re-paste fresh output from the game into that file).
GRIMOIRE_SPELL_LIST = load_content_text("grimoire-legacy/spell_list.txt")

# Captured the same way as the grimoire spell list above: real output from
# the actual game (java -jar mining-simulator.jar -> log in -> "2. Index"),
# ANSI color codes stripped and "Spawn Message: null" lines dropped for
# readability, not hand-typed. See content/mining-simulator/item_index.txt
# to update it (e.g. after adding a new mineral) — just re-paste fresh
# "Index" output from the game into that file.
MINING_ITEM_INDEX = load_content_text("mining-simulator/item_index.txt")


# --- Project data -----------------------------------------------------
# "images"       -> gallery screenshots are auto-discovered, not listed here.
#                    Drop files named shot1.png, shot2.png, shot3.png, ... (also
#                    .jpg/.jpeg/.webp) into static/images/<slug>/ and they show
#                    up in the gallery automatically, in numeric order — no code
#                    change needed. Any other filename in that folder (used for
#                    a thumbnail, a tutorial screenshot, etc.) is left alone and
#                    won't appear in the gallery.
# "description"  -> rendered as markdown.
# "skills"       -> small labels on the card, detail page, and Skills page.
# "github"       -> "owner/repo" string. The Download button redirects straight
#                    to GitHub's auto-generated zip archive for the default
#                    branch — nothing to upload or keep in sync manually.
# "download_file"-> fallback: filename in static/downloads/, used only if
#                    "github" isn't set.
# "runtime"      -> which in-browser preview to offer. One of:
#                      "pyodide"      Python, runs fully client-side
#                      "java-console" Java console/Scanner apps — runs
#                                     server-side (java -jar), streamed live
#                                     into a terminal-style modal
#                      "python-console" Python console/input() apps — same
#                                     idea as java-console (server-side
#                                     process, streamed live into the same
#                                     terminal-style modal, same
#                                     start/stream/input/stop routes) but
#                                     runs `python3 -u script.py` instead
#                      "cheerpj"      Java Swing/AWT (GUI) apps, client-side
#                      "gradle"       placeholder, not implemented yet
#                      None           no preview
# "preview_entry"      -> filename inside static/previews/<slug>/
# "preview_main_class" -> only used by "cheerpj"; class with public static void main
# "sections"     -> flexible content areas below the description (tutorials,
#                    showcases, demos). Each has a title and a list of blocks:
#                      {"type": "markdown", "content": "..."}
#                      {"type": "image", "src": "step1.png", "caption": "..."}
#                      {"type": "video", "src": "https://youtube.com/embed/XYZ"}  # or local .mp4
# "pinned"       -> True to mark this as one of your top/flagship projects.
#                    Pinned projects sort first on /projects (and get a
#                    small "Pinned" badge there), and are the ones shown in
#                    the homepage's "Featured Projects" strip. Everything
#                    still shows up on /projects regardless — this only
#                    affects ordering/highlighting, not visibility. Meant
#                    for exactly the "top 10 vs smaller projects" split —
#                    once you've got more than a handful of projects, pin
#                    your best ~10 and leave smaller/support ones (like
#                    Chatroom) unpinned.
# "created"      -> free-form date string, same granularity as certification
#                    dates ("Aug 2021", "2024", "Mar 2025") — whatever you can
#                    actually pin down. Shown on the detail page. Placeholder
#                    values below — swap in the real ones by checking each
#                    project's oldest commit / first working version.
# "updated"      -> same format as "created". Placeholder values below —
#                    swap in the real ones by checking each project's most
#                    recent commit / latest release you actually shipped.
PROJECTS = [
    {
        "slug": "grimoire-legacy",
        "pinned": True,
        "name": "Grimoire: Legacy",
        "tagline": "A turn-based spell combat simulator with 150+ unique spells and deep effect interactions.",
        "created": "TBD",
        "updated": "TBD",
        "description": (
            "**Grimoire: Legacy** started on paper and pen — duels tracked by "
            "hand, random numbers rolled on a calculator. Players pick 5 spells "
            "from a shared grimoire and duel by casting one per turn "
            "simultaneously, until it grew too complex to track manually.\n\n"
            "After learning Java, I rebuilt it as a full text-based combat "
            "engine that handles all the calculations, effect tracking, and "
            "turn management automatically. That let me finally finish "
            "designing and balancing the complete collection: **150+ spells** "
            "and **30+ unique AI enemies** to duel against.\n\n"
            "Under the hood it leans on a deliberately over-engineered "
            "architecture for a personal project — a flyweight-style spell "
            "factory, nested linked lists for the turn queue, priority "
            "queues, and prototype-pattern cloning for player/enemy state."
        ),
        "github": "FTHZS/Grimoire-Legacy",
        "languages": ["Java"],
        "skills": ["Game Design", "Data Structures", "OOP Design"],
        "runtime": "java-console",
        "preview_entry": "grimoire-legacy.jar",
        "preview_main_class": "Game",
        "sections": [
            {
                "title": "How it works",
                "blocks": [
                    {"type": "markdown", "content": (
                        "**Core rules**\n"
                        "- Each duelist starts with 1000 Health\n"
                        "- Pick 5 spells from the grimoire before the duel\n"
                        "- Both players cast one spell per turn, simultaneously\n"
                        "- Spells have cooldowns of 1-5 turns before they can be recast\n"
                        "- First to 0 Health loses\n\n"
                        "**Spell categories**\n"
                        "- Attack — direct damage\n"
                        "- Defence — barriers that absorb damage over multiple turns\n"
                        "- Healing — restores Health\n"
                        "- Buff / Debuff — raise your stats or lower the opponent's\n"
                        "- Passive — triggers automatically each turn, no input needed\n\n"
                        "Effects can stack, override each other, or apply "
                        "damage-over-time (burn, poison). Resolution order "
                        "matters: buffs apply before attacks, and defence "
                        "absorbs damage before Health is reduced.\n\n"
                        "**Architecture**\n"
                        "- Every `Player` and `Enemy` has a `Clone()` method — "
                        "duels run on cloned copies rather than the originals, so "
                        "a fresh, isolated duel state is built without mutating "
                        "the source object (Prototype pattern)\n"
                        "- Clones don't get their own copies of each spell — they "
                        "look them up by name from a single shared `grimoire` "
                        "registry (Flyweight pattern), so 150+ spells exist as "
                        "one definition each, not duplicated per player"
                    )},
                ],
            },
            {
                "title": "Example spells:",
                "blocks": [
                    {"type": "markdown", "content": (
                        "| Spell | Cooldown | Effect |\n"
                        "|---|---|---|\n"
                        "| Fireball | 1 turn | 100 damage instantly |\n"
                        "| Shield | 3 turns | 50 defence/turn for 3 turns |\n"
                        "| Emblaze | 5 turns | 100 damage/turn for 5 turns |\n"
                        "| Focus | 4 turns | +20% attack for 3 turns |\n"
                        "| Capacitor | 5 turns | Stores damage taken, releases it all at once |\n"
                        "| Golem | 3 turns | 80 damage/turn for 3 turns (persistent summon) |"
                    )},
                    {"type": "text", "caption": "The full spell grimoire, viewable in-game and sortable by set, cooldown, or duration.", "content": (
                        GRIMOIRE_SPELL_LIST
                    )},
                ],
            },
            {
                "title": "Notable classes",
                "blocks": [
                    {"type": "markdown", "content": (
                        "**`Row`** — the combat log's text layout engine, "
                        "written from scratch with no external formatting "
                        "library. Give it a column count and a width, and "
                        "`addLeft()`/`addRight()` place a word without ever "
                        "splitting it mid-word at a column boundary — if a "
                        "column is already occupied, `Row` doesn't overwrite "
                        "it; it links a fresh `Row` onto its own `sub` field "
                        "and recurses into that instead, so a row silently "
                        "grows as many lines tall as it needs. `Turn` owns "
                        "one `Row` per turn and is what every `Effect` below "
                        "actually writes its combat text into — it's not a "
                        "demo class, it's the UI.\n\n"
                        "**`Effect`** (abstract) — `AttackEffect`, "
                        "`HealEffect`, `DefenceEffect`, `CritEffect`, "
                        "`CapacitorEffect`, `MultiplierEffect`. Each `Effect` "
                        "is its own singly-linked-list node (the `next` "
                        "field lives directly on `Effect`, no separate node "
                        "wrapper), and `Turn.addEffect()` walks the chain to "
                        "insert by `priority` — buffs before attacks, "
                        "attacks before defence resolves, and so on. The "
                        "interesting part is effects don't just read that "
                        "list, some rewrite it mid-resolution: `CritEffect` "
                        "walks the current turn's chain looking for a "
                        "matching `AttackEffect` from the same caster and "
                        "multiplies its `value` by 1.5 in place — or, if "
                        "that attack hasn't been queued yet this turn, "
                        "defers itself onto *next* turn's chain and tries "
                        "again. `CapacitorEffect` does something similar: "
                        "it zeroes out every attack from its caster this "
                        "turn, banks the total, and re-queues a smaller "
                        "version of itself with `life-1` — until `life` "
                        "hits 1, when it converts the whole banked total "
                        "into one real `AttackEffect`."
                    )},
                ],
            },
            {
                "title": "What I learned",
                "blocks": [
                    {"type": "markdown", "content": (
                        "The hardest part was the effect-resolution system — "
                        "when several effects hit the same turn, they need a "
                        "consistent order to resolve in. Each spell is its own "
                        "anonymous class with a custom `apply()` method, so new "
                        "spells slot in without touching the core engine. A "
                        "turn queue (linked list of `Turn` objects) schedules "
                        "multi-turn effects in advance — and within a single "
                        "`Turn`, effects aren't just appended, they're inserted "
                        "into a hand-rolled priority-ordered linked list, walking "
                        "forward until it finds where the new effect's priority "
                        "fits, so resolution order stays correct without needing "
                        "a separate sort step.\n\n"
                        "Playtesting through the simulator surfaced real balance "
                        "problems I couldn't catch by hand: some spell combos "
                        "looped infinitely, certain defensive strategies dragged "
                        "duels past 40 turns, and passive spells were initially "
                        "far too strong with no cooldown at all."
                    )},
                ],
            },
            {
                "title": "Project status",
                "blocks": [
                    {"type": "markdown", "content": (
                        "Complete and playable — all spells implemented and "
                        "balanced through extensive playtesting against the "
                        "built-in enemy roster.\n\n"
                        "**Next up:** more enemy types, more spells, and a "
                        "tournament mode with bans, restricted spell slots, "
                        "and timed inputs."
                    )},
                ],
            },
        ],
    },
    {
        "slug": "mining-simulator",
        "pinned": True,
        "name": "Mining Simulator",
        "tagline": "A text-based mining game — 35 minerals across 4 rarity variants each, with LCM-based weighted drop rates and persistent player accounts.",
        "created": "TBD",
        "updated": "TBD",
        "description": (
            "A console mining game with account login and an inventory "
            "system, built around a weighted-rarity drop table: **35 "
            "minerals** across three collections (Earth, Imaginary, Air), "
            "each obtainable in up to **4 rarity variants** — Normal, "
            "Ionized, Spectral, and Transdimensional — stacking on top of "
            "the mineral's own base rarity for another full layer of \"how "
            "lucky did you get.\" The rarer minerals also carry multiple "
            "random flavor-text lines that print as you uncover them. A "
            "limited-time event system periodically shifts drop odds "
            "toward a specific collection.\n\n"
            "The interesting part is how the drop table is actually built. "
            "Rather than hardcoding drop percentages, each mineral just "
            "gets a rarity *ratio* (some as skewed as 1:5:672), and a "
            "dedicated `LCMCalculator` class computes the least common "
            "multiple across every ratio in a collection to turn those "
            "into a single fair, integer-sized pool to roll against — so "
            "adding a new mineral with an arbitrary rarity never requires "
            "rebalancing anything else by hand.\n\n"
            "Accounts persist to a local file in a small custom format "
            "(not JSON, not serialization — a handwritten `|| username { "
            "... }` block parser), tracking join date, blocks mined, "
            "events triggered, and the rarest ore ever discovered."
        ),
        "download_file": "mining-simulator.zip",
        "languages": ["Java"],
        "skills": ["Game Design", "Algorithms", "File Handling"],
        "runtime": "java-console",
        "preview_entry": "mining-simulator.jar",
        "sections": [
            {
                "title": "How it works",
                "blocks": [
                    {"type": "markdown", "content": (
                        "- Log in or sign up — accounts persist to a local file, "
                        "parsed with a small hand-rolled format rather than a "
                        "library\n"
                        "- Mine to earn minerals across three rarity collections "
                        "(Earth, Imaginary, Air)\n"
                        "- Rare minerals trigger short, randomized flavor-text "
                        "events as you uncover them\n"
                        "- A limited-time \"event\" system temporarily shifts drop "
                        "odds toward a specific collection\n"
                        "- Inventory and account stats (blocks mined, rarest ore "
                        "found) round out the loop\n\n"
                        "*Shop is on the menu but not implemented yet — still just "
                        "prints \"Method not implemented\" if you pick it. Being "
                        "upfront about that rather than pretending it's finished.*"
                    )},
                ],
            },
            {
                "title": "The LCM-based drop table",
                "blocks": [
                    {"type": "markdown", "content": (
                        "Every mineral has a rarity ratio, not a fixed percentage. "
                        "To turn a set of ratios like `1 : 5 : 672` into a fair "
                        "weighted roll, the game computes the least common "
                        "multiple across all of them (via a small Euclidean-"
                        "algorithm GCD, then `lcm(a,b) = a/gcd(a,b) * b` chained "
                        "across the set), which gives a pool size every ratio "
                        "divides into evenly. Roll a random number in that range, "
                        "and whichever mineral's slice it lands in is what you "
                        "mined.\n\n"
                        "This is the same core idea — a weighted random pool — "
                        "that shows up again in Greed Island's `RarityPool` for "
                        "decision-making. Different implementation, same instinct: "
                        "don't hardcode probabilities, derive them from ratios so "
                        "new content always slots in correctly."
                    )},
                ],
            },
            {
                "title": "Full item index",
                "blocks": [
                    {"type": "text", "caption": "The full mineral index, viewable in-game via the \"Index\" menu option — all 35 minerals across Earth, Imaginary, and Air, with each rarity variant's actual odds.", "content": (
                        MINING_ITEM_INDEX
                    )},
                ],
            },
            {
                "title": "What's next",
                "blocks": [
                    {"type": "markdown", "content": (
                        "The current build ships one event pool shifting odds "
                        "across the three existing collections. More themed "
                        "events — Air, Void, Space among them — are planned, each "
                        "adding its own small pool of exclusive, tightly-limited "
                        "ores on top of the base drop table, plus the still-"
                        "unimplemented Shop."
                    )},
                ],
            },
        ],
    },
    {
        "slug": "greed-island",
        "pinned": True,
        "name": "Greed Island",
        "tagline": "An evolutionary simulation — 20 autonomous AI agents develop survival strategies through genetic inheritance over generations.",
        "created": "TBD",
        "updated": "TBD",
        "description": (
            "Twenty AI agents (\"Characters\"), each running as its own "
            "Java thread, are spawned into an environment with limited "
            "resources and left to fend for themselves — deciding when to "
            "sleep, travel, eat, craft, or attack, based on genetic traits "
            "and current state (hunger, energy, health). Agents that "
            "survive pass their traits to offspring with small mutations, "
            "so effective strategies evolve naturally over generations "
            "without ever being explicitly programmed.\n\n"
            "Built across Grade 11–12 (2023–2024), this was the project "
            "that took me from Java beginner to actually understanding "
            "multi-threading, functional programming, and genetic "
            "algorithms — nearly every advanced Java concept I know today "
            "traces back to a problem this simulation forced me to solve."
        ),
        "download_file": "greed-island.zip",
        "languages": ["Java"],
        "skills": ["Concurrency", "Genetic Algorithms", "OOP Design"],
        "runtime": "java-console",
        "preview_entry": "greed-island.jar",
        "sections": [
            {
                "title": "How it works",
                "blocks": [
                    {"type": "markdown", "content": (
                        "**Genetics**\n"
                        "- 6 traits per Character: Sleep, Travel, Eat, Give, Craft, "
                        "Attack, each ranging -294 to +294 and shaping decision odds\n"
                        "- Offspring inherit parent traits with small mutations "
                        "(±15 typically) — mutation shrinks near the boundaries so "
                        "traits fine-tune instead of blowing past their limits\n\n"
                        "**Decisions**\n"
                        "- No scripted behavior — every action is a weighted random "
                        "pick combining a base frequency, genetic traits, and "
                        "environmental influence (hunger raises Eat odds, tiredness "
                        "raises Sleep odds)\n"
                        "- Status effects (Diseased, Poisoned, Tired, Hungry, "
                        "Confused) further shift those odds in real time\n\n"
                        "**Environment**\n"
                        "- Multiple locations (Bay, Cave, Forest, Plains...), each "
                        "with its own resources that deplete and regenerate\n"
                        "- Crafting, an inventory system, and combat all sit on top "
                        "of the same decision loop\n\n"
                        "**Watching it play out**\n"
                        "- Each round is a 5-day trial — the environment is "
                        "unforgiving on purpose, with limited resources and 20 "
                        "Characters competing for them\n"
                        "- As the viewer, you don't control anyone directly: speed "
                        "up or slow down the simulation, or pause to inspect any "
                        "Character's stats, inventory, or live decision "
                        "probabilities\n"
                        "- Once a round ends, start the next one seeded with the "
                        "survivors' children — repeat it enough times and you're "
                        "watching evolution actually happen, one generation at a "
                        "time"
                    )},
                ],
            },
            {
                "title": "The RarityPool algorithm",
                "blocks": [
                    {"type": "markdown", "content": (
                        "The one idea from this project that shows up in nearly "
                        "everything I've built since: a weighted random selection "
                        "pool. Give it a set of outcomes with rarity weights, and it "
                        "picks a random point along the total weight, then walks the "
                        "outcomes until it finds which one that point landed on — the "
                        "same core idea behind Mining Simulator's mineral drop rates "
                        "and SkynetGrid's priority-based task selection.\n\n"
                        "It's also what makes a single decision explainable: eating, "
                        "for example, might start at a base weight of 300, get pulled "
                        "down 50 by a Character's own Eat-averse trait, then pulled "
                        "back up 100 by an active Hungry status — landing at 250, "
                        "still possibly losing out to Sleep sitting at 280 that turn."
                    )},
                ],
            },
            {
                "title": "Notable classes",
                "blocks": [
                    {"type": "markdown", "content": (
                        "**`Character`** — the agent itself. Health, "
                        "Hunger, and Energy are `AtomicInteger`, and Status "
                        "flags (Poisoned, Sleeping, Hungry...) live in a "
                        "`volatile HashMap` — the two techniques that let 20 "
                        "of these run as independent threads, each reading "
                        "and writing its own state, without a single "
                        "`synchronized` block anywhere in the class. "
                        "`Clone()` is where evolution actually happens: a "
                        "child copies the parent's `Traits` map with a "
                        "random mutation per trait, and that mutation's "
                        "range deliberately shrinks the closer a trait sits "
                        "to its cap — so traits converge instead of drifting "
                        "off to the extremes forever. Each `Character` also "
                        "owns a private `threadpool` of `Listener`s it "
                        "starts on `spawn()` — one draining Hunger every "
                        "simulated minute, one ticking Poison damage while "
                        "that status is active — and can `stop()` cleanly "
                        "when it dies.\n\n"
                        "**`Listener<T>`** (abstract, `implements Runnable`) "
                        "— a hand-rolled condition-driven scheduler, built "
                        "before I knew `java.util.concurrent` had "
                        "`ScheduledExecutorService` for exactly this. "
                        "It pairs a watched object with a small "
                        "hand-rolled `Comparison<T>` functional interface "
                        "(a predicate, basically — `Predicate<T>` already "
                        "existed in Java 8, I just didn't know about it "
                        "yet), spins on `Thread.sleep(0)` until that "
                        "condition is true, then fires `onCondition()`. "
                        "`TickListener<T>` extends it into a repeating "
                        "timer keyed off the simulation's own logical clock "
                        "(`Greed_Island.time`, not wall time) rather than "
                        "`Timer`/`schedule()` — and if the check loop falls "
                        "behind by more than one interval, it fires "
                        "`onCondition()` that many times in a row to catch "
                        "up, so a laggy tick never quietly loses simulated "
                        "time. `StateListener<T>` is the same idea without "
                        "the catch-up, for once-per-interval state checks "
                        "rather than accumulating ticks. If I rebuilt this "
                        "today I'd reach for the real "
                        "`ScheduledExecutorService` and skip the busy-wait "
                        "spin loops entirely — but at the time, building "
                        "the scheduler myself is what actually taught me "
                        "what one needs to do."
                    )},
                ],
            },
            {
                "title": "Evolution in action",
                "blocks": [
                    {"type": "markdown", "content": (
                        "This wasn't programmed — it emerged purely from selection "
                        "pressure across generations:\n\n"
                        "- **Early generations:** most Characters die of exhaustion\n"
                        "- **~5 generations in:** Characters with higher Sleep traits "
                        "start outliving the rest\n"
                        "- **~10 generations in:** a dominant strategy settles in — "
                        "sleep when tired, eat when hungry, travel rarely\n"
                        "- **~15 generations in:** a counter-strategy emerges — "
                        "aggressive, high-Attack Characters start hunting sleepers "
                        "for their resources"
                    )},
                ],
            },
            {
                "title": "What I learned",
                "blocks": [
                    {"type": "markdown", "content": (
                        "Twenty threads sharing state forced me to actually learn "
                        "thread safety rather than just knowing the term — "
                        "`AtomicInteger` for health/hunger/energy, `synchronized` "
                        "only where state changes were genuinely complex, and "
                        "immutable data everywhere else to avoid needing locks at "
                        "all.\n\n"
                        "Debugging it was its own lesson: 20 threads printing "
                        "at once is unreadable, so the fix was a message-interval "
                        "system, togglable message filtering, and a menu that could "
                        "pause the simulation to inspect state on demand rather than "
                        "trying to read a firehose of concurrent output."
                    )},
                ],
            },
            {
                "title": "Project status",
                "blocks": [
                    {"type": "markdown", "content": (
                        "Core simulation complete and functional across 6 versions "
                        "— from basic movement and scripted decisions in v1 to the "
                        "full genetic, multi-threaded, status-effect-driven system "
                        "in v6. 3,444 lines of original code.\n\n"
                        "**Next up:** tracking trait evolution over generations with "
                        "actual plotted graphs, sexual reproduction (two parents, "
                        "trait recombination), and cooperation mechanics — alliances, "
                        "betrayals, resource sharing."
                    )},
                ],
            },
        ],
    },
    {
        "slug": "skynetgrid",
        "pinned": True,
        "name": "SkynetGrid",
        "tagline": "A remote lab-administration suite — deployed with school approval to a computer lab for remote screen viewing, input control, and terminal access.",
        "created": "TBD",
        "updated": "TBD",
        "description": (
            "A distributed remote-administration system, version 44 as of "
            "the last iteration, built to test real Java networking in a "
            "real environment — deployed, with school approval, on a "
            "computer lab to let admins remotely view a connected "
            "machine's screen, take control of its mouse and keyboard, "
            "run terminal commands, and transfer files, mainly for "
            "keeping an eye on lab misuse. Each machine runs a **Node** "
            "that auto-discovers and connects to a central **Server**, "
            "which tracks connected clients and routes requests between "
            "them over TCP, alongside UDP for discovery and broadcast "
            "messages.\n\n"
            "It's managed through `systemd` so it starts automatically on "
            "boot and responds to standard service commands (`start`, "
            "`stop`, `restart`, `status`), and — since it's meant to run "
            "continuously as an always-on administrative service rather "
            "than something a lab user could casually switch off — it's "
            "hardened against being accidentally or informally removed, "
            "and can back itself up and relocate its own install path "
            "without manual reconfiguration. A Swing GUI, with its own "
            "file explorer, sits on top for interacting with connected "
            "nodes visually instead of through raw commands.\n\n"
            "It's held up through multiple rounds of improvement since "
            "first going live in the lab."
        ),
        "download_file": "skynetgrid.zip",
        "languages": ["Java"],
        "skills": ["Networking", "Systems & DevOps", "Swing GUI", "Concurrency"],
        "runtime": None,
        "sections": [
            {
                "title": "How it works",
                "blocks": [
                    {"type": "markdown", "content": (
                        "- A **Node** auto-discovers the server over the network "
                        "(TCP for the control connection, UDP for discovery and "
                        "broadcasts) and connects over a dedicated control socket "
                        "— file transfer runs on a separate port so large "
                        "transfers don't block regular commands\n"
                        "- Async request/response handling uses "
                        "`CompletableFuture`s keyed per request, so a node can "
                        "fire off a query and keep working while it waits on a "
                        "reply instead of blocking\n"
                        "- Remote input events (`MOUSE_DOWN`, `MOUSE_MOVE`, ...) "
                        "get relayed from a viewer node to the target node, which "
                        "replays them locally — real remote control, not just a "
                        "read-only screen view\n"
                        "- Nodes can back themselves up and relocate their own "
                        "install directory, and `systemd` handles the actual "
                        "process supervision (auto-restart, boot-start, logs via "
                        "`journalctl`)"
                    )},
                ],
            },
            {
                "title": "Why no live preview",
                "blocks": [
                    {"type": "markdown", "content": (
                        "This one's a background networking service with a GUI, "
                        "not a console app — it opens sockets between real "
                        "machines and manages a `systemd` service on the host "
                        "it's running on. That's not something that makes sense "
                        "to spin up automatically for site visitors, so there's "
                        "no in-browser preview here — download the source to try "
                        "it on your own machines instead."
                    )},
                ],
            },
        ],
    },
    {
        "slug": "chatroom",
        "pinned": False,  # smaller/support project — you mentioned this as the "not top-10" example
        "name": "Chatroom (v11)",
        "tagline": "A LAN chatroom with a Swing GUI client, multi-client server, file transfer, and emoji support — v11 of an iterated project.",
        "created": "TBD",
        "updated": "TBD",
        "description": (
            "A local-network chatroom: a multithreaded **ChatServer** "
            "accepts connections from multiple **ChatClient** instances, "
            "each running its own Swing GUI (message history, an emoji "
            "picker, file upload). The server tracks connected users, "
            "broadcasts the live user list to everyone, supports kicking "
            "users, and handles file transfers as base64-encoded chat "
            "commands over that same connection — no separate protocol "
            "needed for a file versus a message.\n\n"
            "This is version 11 of the project — the codebase carries the "
            "marks of iteration: a `codebin.txt` of snippets kept aside "
            "between versions, a dedicated `FileClient` split out from the "
            "main client, and a `Setup` class for first-run configuration. "
            "It also runs a small auto-update service on a separate port, "
            "serving a fresh `ChatClient.class` to anyone running an "
            "outdated client."
        ),
        "download_file": "chatroom.zip",
        "languages": ["Java"],
        "skills": ["Networking", "Swing GUI", "Client-Server Architecture"],
        "runtime": "network-sim",
        "preview_server_entry": "chatroom-server.jar",
        "sections": [
            {
                "title": "How it works",
                "blocks": [
                    {"type": "markdown", "content": (
                        "- One thread per connected client (`ClientHandler extends "
                        "Thread`), with the client set and message log kept as "
                        "synchronized collections so broadcasts stay consistent "
                        "across threads\n"
                        "- File uploads are just another chat command — "
                        "`/file <name> <base64>` over the same socket — no "
                        "separate transfer protocol needed\n"
                        "- A second listener thread accepts server-console "
                        "commands directly (kick a user, shut down cleanly) "
                        "without interrupting client handling\n"
                        "- On setup, the app can register itself as a desktop "
                        "shortcut with a custom icon — a small first-run "
                        "convenience most versions before v11 didn't have"
                    )},
                ],
            },
            {
                "title": "About the live preview",
                "blocks": [
                    {"type": "markdown", "content": (
                        "The real `ChatServer` is genuinely running in this "
                        "preview — but instead of the Swing `ChatClient` (which "
                        "can't render in a browser), the 5 clients you can "
                        "switch between are plain sockets speaking the server's "
                        "exact text protocol directly. It's one shared demo room "
                        "rather than a private one per visitor, since the real "
                        "server hardcodes its port — so whatever any client "
                        "says, everyone previewing at that moment sees it too. "
                        "File uploads work the same way real ones do: type "
                        "`/file name.txt <base64>` from the input box."
                    )},
                ],
            },
        ],
    },
    {
        "slug": "navigo",
        "pinned": True,
        "name": "Navigo",
        "tagline": "A Python-built desktop browser (PyQt5 + QtWebEngine) with tabs, bookmarks, incognito windows, and a full right-click menu.",
        "created": "TBD",
        "updated": "TBD",
        "description": (
            "A Python based browser, developed with the help of PyQt5 libs "
            "and documentation, added classic browser features such as "
            "search bar, undo/redo/reload, bookmarks, history, windows and "
            "private windows, right click menus, download options for "
            "different file formats, video CODEC support, and many other "
            "minor features.\n\n"
            "It's built on `QWebEngineView` — Qt's Chromium wrapper — so "
            "under the hood it's a real, modern rendering engine rather "
            "than a from-scratch one; the actual browser behavior (tabs, "
            "history, incognito, downloads, the context menu) is all "
            "hand-built on top of it in `Navigo.py`."
        ),
        "download_file": "navigo.zip",
        "languages": ["Python"],
        "skills": ["User Interface Design", "Event-Driven Programming", "Networking"],
        "runtime": None,
        "sections": [
            {
                "title": "How it works",
                "blocks": [
                    {"type": "markdown", "content": (
                        "**Tabs & windows**\n"
                        "- Each tab holds its own `CustomWebEngineView`; a `+` "
                        "tab button and `Ctrl+T`/`Ctrl+W` add and close tabs, "
                        "`Ctrl+Shift+T` reopens the last closed one\n"
                        "- `Ctrl+N`-style \"Open new window\" spins up a whole "
                        "second `MainWindow`; \"Open new incognito window\" "
                        "does the same but with its own dark theme (toolbar, "
                        "bookmark bar, and every popup menu re-colored so it's "
                        "visually unmistakable from a normal window) and no "
                        "shared history/bookmarks\n\n"
                        "**Address bar**\n"
                        "- `stripURL()` decides what you typed: a bare word "
                        "becomes a Google search, anything with a recognized "
                        "domain suffix (`.com`, `.io`, `.gov`, ...) becomes "
                        "`https://www.<that>`, and `file://` paths are handled "
                        "separately for local files\n"
                        "- The dropdown suggestion list is generated live from "
                        "matching entries in both bookmarks and browsing "
                        "history, grouped under their own headers\n\n"
                        "**Bookmarks & history**\n"
                        "- The star button adds the current page as a "
                        "toolbar bookmark button, each with its own right-click "
                        "menu (rename, edit URL, delete)\n"
                        "- `Ctrl+H` opens history; every visited URL is logged "
                        "and feeds the address-bar suggestions above\n\n"
                        "**Right-click menu & downloads**\n"
                        "- Context menu adapts to what you clicked: hovering a "
                        "link adds \"open in new tab/window/incognito window\", "
                        "\"save link\", \"copy link address\"; right-clicking an "
                        "image adds \"save image\", \"copy image\", \"copy image "
                        "address\"; selected text adds \"copy\"/\"translate\"; "
                        "there's also \"view page source\" always available\n"
                        "- Downloads go through a real `QNetworkAccessManager` "
                        "plus Qt's `downloadRequested` signal, prompting a "
                        "native save-file dialog pre-filled with the right "
                        "extension for whatever file type is being downloaded\n\n"
                        "**Everything else**\n"
                        "- Custom `AnimatedButton`/`AnimatedMenuButton` "
                        "classes drive the toolbar's hover/click color "
                        "transitions via `QPropertyAnimation`\n"
                        "- Keyboard shortcuts cover reload (`Ctrl+R`), "
                        "back/forward (`Alt+Left`/`Alt+Right`), zoom "
                        "(`Ctrl+Shift+`/`-`), view-source (`Ctrl+Shift+I`), "
                        "and jumping to the address bar (`Ctrl+E`)\n"
                        "- QtWebEngine (Chromium) handles video codec support "
                        "and playback natively — nothing bespoke needed there"
                    )},
                ],
            },
            {
                "title": "What's actually non-trivial here",
                "blocks": [
                    {"type": "markdown", "content": (
                        "It's easy to wrap `QWebEngineView` in a window and "
                        "call it a browser — the harder, less-obvious parts "
                        "of *this* one:\n\n"
                        "- **Incognito isn't a flag.** A lot of hobby "
                        "PyQt browsers implement \"private mode\" as a boolean "
                        "that just skips writing to history. Here it's a "
                        "genuinely separate visual identity — its own color "
                        "constants threaded through the toolbar, bookmark "
                        "bar, and every popup/context menu — plus a fully "
                        "separate `MainWindow` instance with no shared state, "
                        "so there's no path for a private tab's data to leak "
                        "into the normal one\n"
                        "- **The context menu is built per click, not once.** "
                        "`contextMenuEvent` inspects what's actually under "
                        "the cursor (`QWebEngineContextMenuData`) and "
                        "assembles a different `QMenu` for a link vs. an "
                        "image vs. selected text vs. plain page — closer to "
                        "how a real browser's menu behaves than a single "
                        "static right-click menu would be\n"
                        "- **It's one hand-written file, not a framework.** "
                        "~1,200 lines implementing tabs, history, bookmarks, "
                        "downloads, and a dynamic context menu directly on "
                        "top of Qt's primitives — Chromium supplies the "
                        "rendering engine, but none of the browser *chrome* "
                        "or behavior comes prebuilt"
                    )},
                ],
            },
            {
                "title": "Why no live preview",
                "blocks": [
                    {"type": "markdown", "content": (
                        "This is a full desktop GUI app — it opens native Qt "
                        "windows and embeds an actual Chromium instance — so "
                        "there's no sensible way to run it inside a browser "
                        "tab on this site. Download the source and run "
                        "`python Navigo.py` (with PyQt5 + PyQtWebEngine "
                        "installed) to try it for real."
                    )},
                ],
            },
        ],
    },
    {
        "slug": "exponential-spacebar",
        "pinned": False,
        "name": "Exponential Spacebar",
        "tagline": "A terminal incrementer/clicker game — press spacebar to score, with accounts, a world record, and exponentially-formatted numbers.",
        "created": "TBD",
        "updated": "TBD",
        "description": (
            "A Replit-hosted terminal clicker game: press spacebar to add "
            "to your score, with a boost that grows every 500 points, "
            "persistent username/password accounts, a personal best, a "
            "shared world record, and an experience/level system that "
            "climbs passively as you play.\n\n"
            "Scores grow large fast (the boost itself compounds), so it "
            "leans on a custom `translate_number()` formatter that turns "
            "raw numbers into readable exponent notation — 1,250,000 "
            "reads as `1.25 Million`, all the way up to Vigintillion — "
            "rather than ever printing a wall of digits."
        ),
        "download_file": "exponential-spacebar.zip",
        "languages": ["Python"],
        "skills": ["Game Design", "Algorithms", "Data Persistence", "Authentication"],
        "runtime": "python-console",
        "preview_entry": "main.py",
        "sections": [
            {
                "title": "How it works",
                "blocks": [
                    {"type": "markdown", "content": (
                        "- Accounts are stored in Replit's hosted key-value "
                        "store (`replit.db`) — username, password, highscore, "
                        "and experience per user, plus one shared `\"World "
                        "best\"` key everyone competes against\n"
                        "- Sign-up enforces basic rules (`verify_username`, "
                        "`verify_password`): 2-15 character usernames, and "
                        "passwords needing at least one lowercase, one "
                        "uppercase, and one digit\n"
                        "- Spacebar/`x` input is read through raw key events "
                        "via `sshkeyboard`'s `listen_keyboard`, not line-based "
                        "`input()` — the game reacts the instant a key is "
                        "pressed, no Enter needed\n"
                        "- Every press recalculates the boost "
                        "(`1 + score // 500`), updates experience by a fixed "
                        "amount, checks it against a precomputed table of 501 "
                        "exponentially-scaled level thresholds, and writes the "
                        "new highscore/world-record back to `replit.db` if "
                        "either was just beaten\n"
                        "- ANSI color codes (`colors.py`) and a loading-screen "
                        "animation (a random fake \"loading Assets... Enemies... "
                        "Multipliers...\" sequence) round out the terminal "
                        "presentation"
                    )},
                ],
            },
            {
                "title": "What's actually non-trivial here",
                "blocks": [
                    {"type": "markdown", "content": (
                        "- **The number formatter is a real algorithm, not a "
                        "lookup.** `translate_number()` splits a number's "
                        "digits into groups of 3 by position, figures out how "
                        "many full groups sit before the leading digits, and "
                        "maps that count to the right scale name — Thousand "
                        "up through Vigintillion (10^63) — while still "
                        "keeping up to 3 decimal digits of precision on the "
                        "leading group. It's the kind of formatting most "
                        "people would reach for a library to do\n"
                        "- **Input handling is genuinely event-driven, not "
                        "polled.** `sshkeyboard.listen_keyboard` hooks raw "
                        "key-down events rather than blocking on `input()`, "
                        "so the score updates the instant spacebar is "
                        "pressed — closer to how a real game reads input than "
                        "a typical terminal-menu script\n"
                        "- **Validation without regex.** Username/password "
                        "rules are checked by testing character-set "
                        "intersections (`any(... for word in set(alphabet))`) "
                        "rather than a regex — an unconventional but "
                        "deliberate choice that reads a bit differently from "
                        "the usual `re.match` approach\n"
                        "- One honest detail from the source: a `#hax` "
                        "comment sits next to `if random.randint(0, 00) == "
                        "0:` — a condition that's always true, used as a "
                        "shortcut to reload the stored highscore on start. "
                        "Left in on purpose below, not cleaned up for this "
                        "writeup."
                    )},
                ],
            },
            {
                "title": "About the live preview",
                "blocks": [
                    {"type": "markdown", "content": (
                        "The version above (and downloadable as the real "
                        "source) depends on two Replit-only things: "
                        "`replit.db` for storage and `sshkeyboard` for raw "
                        "spacebar detection — neither exists outside a Repl. "
                        "The **Preview** button here runs a lightly adapted "
                        "build instead: `replit.db` swapped for a local dict "
                        "behind the same interface, and spacebar detection "
                        "swapped for reading a line of input (press **Enter** "
                        "for a point, type **x** + Enter for the menu), since "
                        "a browser-piped terminal can't hook raw keystrokes. "
                        "The game logic itself — scoring, boosts, experience, "
                        "number formatting — is untouched."
                    )},
                ],
            },
        ],
    },
    {
        "slug": "visualcanvas",
        "pinned": False,
        "name": "VisualCanvas",
        "tagline": "A Linux app with interactive editors for learning data structures, physics, and chemistry — one infinite pan/zoom canvas, four subjects.",
        "created": "TBD",
        "updated": "TBD",
        "description": (
            "A linux based app that has interactive ui for learning data "
            "structures, physics, and chemistry.\n\n"
            "It has a CS canvas for loading linked lists, stacks, ques, "
            "heaps, trees, BSTs, arrays, graphs, with custom data values.\n\n"
            "It has a molecule loader with prebuilt molecules and editor "
            "tools.\n\n"
            "It has a high res optimized physics engine that has "
            "constraints, pulleys, springs, ropes, rods, and also supports "
            "a large number of objects and use of gravitation laws.\n\n"
            "It is an editor, and can save and load files of the format "
            "`.vcanvas` and cause edits or save screenshots.\n\n"
            "One single `CanvasPanel` (pan/zoom, dot-grid background) is "
            "shared by all four subjects — each one just plugs in its own "
            "renderer. Sessions are tabs, each with fully isolated state "
            "(every structure, the molecule canvas, the physics world) and "
            "its own undo/redo stack, so switching subjects or tabs never "
            "loses work."
        ),
        "download_file": "visualcanvas.zip",
        "languages": ["Java"],
        "skills": ["Linux Application Development", "Swing GUI", "2D Graphics & Rendering", "Physics Simulation", "OOP Design"],
        "runtime": None,
        "sections": [
            {
                "title": "What makes this one stand out",
                "blocks": [
                    {"type": "markdown", "content": (
                        "This is really four separate simulation engines — "
                        "graph traversal, chemical bonding, Verlet physics, "
                        "and probability/set math — sharing one architecture "
                        "instead of four separate apps glued together:\n\n"
                        "- **One interface, four domains.** Every renderer "
                        "(a linked list, a molecule, a physics world, a Venn "
                        "diagram) implements the same `DSRenderer` interface "
                        "(`draw`, `add`, `clear`, `saveTo`/`loadLine`, "
                        "animation hooks). The `CanvasPanel` that handles "
                        "pan/zoom/drag/mouse-wheel doesn't know or care which "
                        "kind of renderer is currently plugged in — that's "
                        "what lets one canvas serve chemistry, physics, CS, "
                        "and math without four separate canvases\n"
                        "- **Undo/redo is a first-class citizen everywhere, "
                        "not just for text.** Adding a heap node, drawing a "
                        "bond, and setting a spring constant all push the "
                        "same `UndoableAction` (closures for undo + redo) "
                        "onto a per-session stack. Most student projects that "
                        "implement undo do it for one thing, in one place — "
                        "here it's a general mechanism used identically "
                        "across four unrelated domains\n"
                        "- **The physics and chemistry aren't cosmetic.** "
                        "Bond order changes trigger real formal-charge "
                        "recalculation; the physics engine does actual "
                        "Verlet integration with break-thresholds on springs "
                        "and proper Atwood-style pulley constraints, not a "
                        "hand-waved animation loop. Both hold up under "
                        "actual sustained interaction, not just a single "
                        "static screenshot\n"
                        "- **~3,500 lines, one file, no external UI "
                        "framework** — pure `javax.swing`/`java.awt.Graphics2D`, "
                        "hand-drawn shapes and layout throughout, plus "
                        "reflection-gated Apache Batik integration for SVG "
                        "export that degrades gracefully when Batik isn't "
                        "on the classpath"
                    )},
                ],
            },
            {
                "title": "Computer Science canvas",
                "blocks": [
                    {"type": "markdown", "content": (
                        "11 structures, each its own renderer behind a shared "
                        "`DSRenderer` interface: singly/doubly linked list, "
                        "stack, queue, deque, circular queue, binary tree, "
                        "BST, max heap, min heap, and a directed/undirected, "
                        "weighted/unweighted graph.\n\n"
                        "- The graph renderer runs real **BFS/DFS**, stepped "
                        "one frame at a time by a shared `AnimEngine` — nodes "
                        "color-shift between *current* and *visited* as the "
                        "traversal plays, with play/step/reset transport "
                        "controls\n"
                        "- The heap renderer draws the tree **and** the "
                        "backing array side by side, so the `2i+1`/`2i+2` "
                        "child relationship is visible at the same time as "
                        "the tree shape\n"
                        "- Every add/remove/clear pushes an `UndoableAction` "
                        "(before/after snapshot + undo/redo closures) onto a "
                        "per-session undo stack — Ctrl+Z/Ctrl+Y work "
                        "everywhere, not just as an afterthought"
                    )},
                    {"type": "image", "src": "shot2.png", "caption": "Max heap rendered as a tree, with the backing array shown underneath"},
                ],
            },
            {
                "title": "Chemistry — molecule canvas",
                "blocks": [
                    {"type": "markdown", "content": (
                        "A real 2D molecule editor, not just a static "
                        "diagram viewer:\n\n"
                        "- Draw single/double/triple bonds, wedge/dash "
                        "(stereochemistry), and skeletal bond-line style by "
                        "picking a tool and dragging between atoms\n"
                        "- **Formal charge recalculates automatically** "
                        "whenever a bond is added, changed, or deleted "
                        "(`recalcCharges`), and lone pairs are drawn from "
                        "each atom's actual valence — this isn't decorative, "
                        "it tracks real bonding rules\n"
                        "- A prebuilt-molecule library (`H2O`, `NH3`, `CH4`, "
                        "`CO2`, benzene, phenol, aniline, and more) drops in "
                        "a fully-bonded structure in one click, ready to "
                        "extend or edit\n"
                        "- Reaction arrows and curved (mechanism) arrows are "
                        "drawn as a separate right-drag tool — enough to lay "
                        "out a full reaction mechanism with lone-pair-pushing "
                        "arrows, not just a single molecule"
                    )},
                    {"type": "image", "src": "shot1.png", "caption": "A curved-arrow reaction mechanism between water and ammonia, drawn on the molecule canvas"},
                ],
            },
            {
                "title": "Physics engine",
                "blocks": [
                    {"type": "markdown", "content": (
                        "A genuine constraint-based simulation, not a "
                        "particle-effect approximation:\n\n"
                        "- **Verlet integration** with sub-stepping for "
                        "stability, gravity, and per-surface friction/"
                        "restitution\n"
                        "- Objects: mass blocks, mass cylinders, pulleys, "
                        "wedges, and fixed wall anchors\n"
                        "- Connectors: springs (Hooke's law, configurable "
                        "`k`, break past 10× rest length), ropes/strings "
                        "(inextensible once taut, can carry distributed mass), "
                        "and rigid rods\n"
                        "- **Pulley systems** are modeled properly — an "
                        "Atwood-style rope over a pulley keeps "
                        "`lenA + lenB = totalLength` rather than treating "
                        "each side as an independent spring\n"
                        "- Every object/connector edit (add, delete, set "
                        "spring `k`, set rope mass, build a pulley system) is "
                        "undo-tracked the same way the CS structures are\n"
                        "- Handles many simultaneous interconnected objects "
                        "without the simulation falling apart — see the "
                        "stress-test screenshot below"
                    )},
                    {"type": "image", "src": "shot3.png", "caption": "Spring-mass systems with labeled spring constants and rest lengths, mid-simulation"},
                    {"type": "image", "src": "shot4.png", "caption": "A dense mesh of a dozen interconnected mass blocks and springs, stress-testing the physics engine"},
                ],
            },
            {
                "title": "Mathematics (found in code, not in the original notes)",
                "blocks": [
                    {"type": "markdown", "content": (
                        "A fourth folder beyond the three described above: "
                        "Venn diagrams (arbitrary set count, comma-separated "
                        "multi-set intersections), probability distribution "
                        "plotting (Normal/Binomial/Poisson), and binomial "
                        "expansion for several forms of `(a±b)^n`."
                    )},
                ],
            },
            {
                "title": "Everything else",
                "blocks": [
                    {"type": "markdown", "content": (
                        "- **Save/load**: the whole session — every CS "
                        "structure, the molecule canvas, all three math "
                        "tools, the physics world — serializes to a single "
                        "plain-text `.vcanvas` file and back\n"
                        "- **SVG export**: uses Apache Batik if it's on the "
                        "classpath for true vector SVG, and falls back to a "
                        "PNG embedded in an SVG wrapper if it isn't, via "
                        "reflection so the app doesn't hard-depend on Batik "
                        "being present\n"
                        "- **Linux integration**: on first run, registers "
                        "itself as a desktop app and as the default handler "
                        "for `.vcanvas` files (`.desktop` entry + MIME type "
                        "+ icon, via `xdg-mime`/`update-desktop-database`), "
                        "so double-clicking a `.vcanvas` file opens it "
                        "directly\n"
                        "- A collapsed-by-default sidebar that expands on "
                        "hover, and tabs with their own right-click "
                        "rename/save/close menu"
                    )},
                ],
            },
            {
                "title": "Why no live preview",
                "blocks": [
                    {"type": "markdown", "content": (
                        "This is a full desktop Swing app, the same reason "
                        "Navigo doesn't have one — there's no sensible way "
                        "to run a windowed GUI app inside a browser tab on "
                        "this site. Download the source and run "
                        "`javac VisualCanvas.java && java VisualCanvas` "
                        "(JDK 8+) to try it directly. The screenshots above "
                        "are real exports/captures from the app, not staged."
                    )},
                ],
            },
        ],
    },
]

DOWNLOAD_DIR = os.path.join(app.root_path, "static", "downloads")


# --- Homepage stats -------------------------------------------------------
# All four numbers on the homepage's stats strip are computed live, not
# hand-maintained — that's the "auto update" part. Three of them are free
# (just len() on data that already exists); only the view counter needs
# actual state.
#
# CODING_START_YEAR: best estimate, not exact — derived from the hero's
# "Coding since I was 10" plus About's timeline ("5th Grade: Scratch" as the
# starting point). Adjust this by a year or two if it's off; there's no way
# for the app to know your real start date on its own.
CODING_START_YEAR = 2018

# View counter: a small JSON file in Flask's instance folder (the
# conventional place for runtime-generated data that isn't part of the
# versioned source — see content/ vs instance/ for the distinction). Two
# honest caveats worth knowing before relying on this number:
#   1. Most PaaS containers (Render included) have an EPHEMERAL filesystem
#      — this file, and the count in it, resets to 0 on every redeploy
#      unless you attach a persistent disk. Fine for "roughly how much
#      traffic since the last deploy," not fine as a permanent lifetime
#      counter without extra infra.
#   2. It only counts real GET requests to "/" from something that doesn't
#      look like a bot/health-checker (see _looks_like_bot below) — that's
#      a best-effort heuristic based on the health-check/scanner traffic
#      we've actually observed hitting this site, not a robust anti-bot
#      system. Some automated traffic will still get counted; that's
#      normal for a simple counter like this.
STATS_FILE = os.path.join(app.instance_path, "site_stats.json")
STATS_LOCK = threading.Lock()

_BOT_UA_SUBSTRINGS = ("bot", "crawler", "spider", "curl", "wget", "python-requests",
                      "go-http-client", "monitor", "uptime", "render", "headlesschrome")


def _looks_like_bot(user_agent):
    ua = (user_agent or "").lower()
    return (not ua) or any(s in ua for s in _BOT_UA_SUBSTRINGS)


def _read_stats_file():
    try:
        with open(STATS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"views": 0}


def _record_view():
    with STATS_LOCK:
        data = _read_stats_file()
        data["views"] = data.get("views", 0) + 1
        try:
            os.makedirs(app.instance_path, exist_ok=True)
            with open(STATS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f)
        except OSError:
            pass  # read-only filesystem or similar — don't break the homepage over a counter
        return data["views"]


def get_homepage_stats(count_this_visit):
    if count_this_visit:
        views = _record_view()
    else:
        views = _read_stats_file().get("views", 0)
    return {
        "years_coding": max(1, datetime.now().year - CODING_START_YEAR),
        "num_projects": len(PROJECTS),
        "num_certifications": len(CERTIFICATIONS),
        "views": views,
        "lines_of_code": TOTAL_LOC,
        "github_stars": get_github_stars(),
    }


# --- Lines of code ---------------------------------------------------------
# Counted straight from the actual downloadable source archives in
# static/downloads/ — the exact same code a visitor would get from hitting
# Download — rather than a live GitHub API call, since there's no LOC
# endpoint in GitHub's API and cloning every repo on every homepage load
# would be both slow and needless. This runs once at process startup (small
# zips, negligible cost) and stays fixed until the next deploy/restart —
# genuinely "auto-updating" in the sense that it reflects whatever's
# actually in static/downloads/ right now, you just won't see it move
# within a single running instance.
_CODE_EXTENSIONS = {
    ".java", ".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".html",
    ".c", ".cpp", ".h", ".hpp", ".go", ".rb", ".php", ".kt", ".swift", ".rs", ".sql",
}


def _count_lines_of_code():
    total = 0
    per_project = {}
    if not os.path.isdir(DOWNLOAD_DIR):
        return total, per_project
    for fname in sorted(os.listdir(DOWNLOAD_DIR)):
        if not fname.endswith(".zip"):
            continue
        slug = fname[:-4]
        count = 0
        try:
            with zipfile.ZipFile(os.path.join(DOWNLOAD_DIR, fname)) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    ext = os.path.splitext(info.filename)[1].lower()
                    if ext not in _CODE_EXTENSIONS:
                        continue
                    try:
                        with zf.open(info) as f:
                            count += sum(1 for _ in f)
                    except (OSError, zipfile.BadZipFile):
                        continue
        except (zipfile.BadZipFile, FileNotFoundError):
            continue
        per_project[slug] = count
        total += count
    return total, per_project


TOTAL_LOC, LOC_BY_PROJECT = _count_lines_of_code()


# --- GitHub stars ------------------------------------------------------
# Live, unlike lines-of-code above — stars actually change over time and
# GitHub's API makes this cheap to ask for directly, so it's a real fetch
# with an in-memory cache (1 hour TTL) rather than a snapshot. Sums stars
# across every project with a "github" field set (currently just Grimoire:
# Legacy, but this scales automatically as you add more).
#
# Unauthenticated GitHub API calls are rate-limited to 60/hour per source
# IP — the cache is what keeps this well under that regardless of traffic.
# If a fetch fails (rate-limited, offline, GitHub down) this serves the
# last known-good value instead of erroring the homepage; if it's NEVER
# succeeded (e.g. right after a fresh deploy with no network yet), it
# returns None and the template shows "—" rather than a fabricated 0.
GITHUB_STARS_CACHE = {"total": None, "fetched_at": 0.0}
GITHUB_STARS_LOCK = threading.Lock()
GITHUB_STARS_TTL_SECONDS = 3600


def get_github_stars():
    now = time.time()
    with GITHUB_STARS_LOCK:
        cached, age_ok = GITHUB_STARS_CACHE["total"], (now - GITHUB_STARS_CACHE["fetched_at"] < GITHUB_STARS_TTL_SECONDS)
        if cached is not None and age_ok:
            return cached

    repos = [p["github"] for p in PROJECTS if p.get("github")]
    total = 0
    all_ok = True
    for repo in repos:
        try:
            resp = requests.get(
                f"https://api.github.com/repos/{repo}",
                headers={"Accept": "application/vnd.github+json"},
                timeout=4,
            )
            if resp.status_code == 200:
                total += resp.json().get("stargazers_count", 0)
            else:
                all_ok = False
        except requests.RequestException:
            all_ok = False

    with GITHUB_STARS_LOCK:
        if all_ok:
            GITHUB_STARS_CACHE["total"] = total
            GITHUB_STARS_CACHE["fetched_at"] = now
        # if a fetch failed, deliberately leave the cache alone — either it
        # already holds a real last-known-good value (serve that, stale is
        # fine), or it's still None (serve None, not a fabricated 0)
        return GITHUB_STARS_CACHE["total"]


# --- Certifications & Achievements -------------------------------------
# Two separate lists shown on one page (/certifications), divided by a
# visual separator — certifications first, achievements below.
#
# CERTIFICATIONS — formal, issuer-backed credentials.
#   "name"            -> certification title
#   "issuer"          -> who issued it (e.g. "Google", "IIT Madras")
#   "date"            -> whatever granularity you want: "March 2026", "2025"
#   "credential_url"  -> optional link to a verification page. Omit/None if
#                        there isn't a public verify link.
#   "credential_id"   -> optional, shown next to the link if set
#   "description"     -> optional 1-2 sentence blurb, plain text (not markdown)
#   "skills"          -> optional list of small tag labels (not linked to
#                        the Skills page — these are cert-specific, e.g.
#                        exam domains, not tied to a PROJECTS "skills" tag)
#   "image"           -> a badge or company logo. Either a filename in
#                        static/images/certifications/ (drop the file there),
#                        or a full http(s) URL if you'd rather link a logo
#                        hosted elsewhere (issuer's site, Credly, etc.) —
#                        both work interchangeably. Falls back to a plain
#                        initial-letter badge if omitted. Logos are shown at
#                        their natural aspect ratio on a light backdrop
#                        (most badge art assumes one), not cropped to a square.
#
# THE TWO ENTRIES BELOW ARE PLACEHOLDERS so the page has something to show
# and the layout is easy to sanity-check — replace them with your real
# certifications (delete these two once you do).
CERTIFICATIONS = [
    {
        "name": "Microsoft Office Specialist: PowerPoint 2016",
        "issuer": "Microsoft",
        "date": "Aug 2021",
        "credential_url": "https://www.credly.com/badges/a761f4a5-31ba-44c0-a363-4e26cab83047",
        "credential_id": "ykUm-DwBR",
        "description": "Certified for demonstrating proficiency in Microsoft PowerPoint 2016.",
        "skills": ["PowerPoint 2016"],
        "image": "ms-office-specialist-ppt-2016.png",
    },
]

# ACHIEVEMENTS — anything else worth highlighting that isn't a formal
# credential: hackathon placements, competition results, scholarships,
# published work, internships, notable recognitions, etc.
#   "title"       -> short name of the achievement
#   "category"    -> a short label shown as a tag next to the date. Common
#                    ones: "Hackathon", "Competition", "Publication",
#                    "Internship", "Scholarship", "Recognition" — but it's
#                    free text, use whatever fits. Categories are derived
#                    from whatever's actually in this list (no separate
#                    list to keep in sync), and double as filter buttons on
#                    the page.
#   "date"        -> same free-form granularity as certifications
#   "description" -> markdown, can be multiple paragraphs ("\n\n" between
#                    them) — this is meant for the "what I did, what I
#                    achieved, when it was" writeup, same authoring style
#                    as a PROJECTS "description"
ACHIEVEMENTS = [
    {
        "title": "NASA International Space Apps Challenge — Pala",
        "category": "Hackathon",
        "date": "Oct 2024",
        "image": "nasa-space-apps-2024.png",
        "description": (
            "Actively participated in the 2024 NASA Space Apps Challenge Pala "
            "and Project Expo, organised by ISRO at VISAT Engineering College, "
            "Ernakulam.\n\n"
            "Came on site to plan and build a project with a five-person team, "
            "working overnight over multiple days. Delivered a prototype "
            "application for evaluation, including a video demonstration, "
            "presentation, and live speech."
        ),
    },
    {
        "title": "Intel AI For Youth Participant",
        "category": "Bootcamp",
        "date": "May 2022",
        "image": "intel-ai-for-youth-2022.png",
        "description": (
            "Selected for the 12-day Intel AI Readiness Bootcamp, run in "
            "collaboration with CBSE.\n\n"
            "Completed intensive, hands-on training in foundational AI "
            "concepts and tools, and submitted a CV-powered text reader and "
            "summarizer project for evaluation, earning a Certificate of "
            "Completion."
        ),
    },
    {
        "title": "1st Runner Up — ICT Junior India Championship",
        "category": "Competition",
        "date": "Aug 2021",
        "image": "ict-junior-india-championship-2021.png",
        "description": (
            "Secured 1st Runner Up at the national level in the ICT Junior "
            "India Championship (PowerPoint 2016 category), part of the "
            "Sankalp 2021 World Championships."
        ),
    },
]


def build_index(projects, field):
    """Turn PROJECTS into {tag_name: [project, project, ...]}, alphabetically,
    reading from either the "languages" or "skills" field."""
    index = {}
    for project in projects:
        for tag in project.get(field, []):
            index.setdefault(tag, []).append(project)
    return dict(sorted(index.items(), key=lambda item: item[0].lower()))


LANGUAGES = build_index(PROJECTS, "languages")
SKILLS = build_index(PROJECTS, "skills")


# Small hand-drawn (not the official trademarked logos — simple generic
# glyphs in the same spirit) icon set for language tags. Add an entry here
# for any new language and it'll automatically show up next to that tag
# wherever languages are rendered. Anything without an entry falls back to
# a generic "</>" glyph, so new/unlisted languages never render as blank.
LANGUAGE_ICONS = {
    "java": (
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
        '<path d="M8.5 15.5c-1 .6-1 1.4 0 2 1.8 1.1 6.2 1.1 8 0 1-.6 1-1.4 0-2" '
        'stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
        '<path d="M10 3c-1.5 1.6-1.5 2.8 0 4.3-1.7 1.4-1.7 2.9 0 4.3" '
        'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>'
        '<path d="M7 12c-2.8.5-2.8 2.3 0 2.8 3 .6 7 .6 10 0 2.8-.5 2.8-2.3 0-2.8" '
        'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>'
        '<circle cx="9" cy="19" r=".8" fill="currentColor"/>'
        '<circle cx="12.5" cy="20" r=".8" fill="currentColor"/>'
        '<circle cx="16" cy="19" r=".8" fill="currentColor"/>'
        "</svg>"
    ),
    "python": (
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
        '<path d="M12 3c-3 0-3.2 1.3-3.2 1.3v2.6h3.3v.5H6.9S4.5 7.1 4.5 11s2 3.9 2 3.9h1.5v-2s-.1-2 2-2h3.4s1.9.1 1.9-1.8V5.2S15.6 3 12 3z" '
        'stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>'
        '<path d="M12 21c3 0 3.2-1.3 3.2-1.3v-2.6h-3.3v-.5h5.2s2.4.3 2.4-3.6-2-3.9-2-3.9h-1.5v2s.1 2-2 2H10.6s-1.9-.1-1.9 1.8v3.8S8.4 21 12 21z" '
        'stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>'
        '<circle cx="9.2" cy="5.3" r=".6" fill="currentColor"/>'
        '<circle cx="14.8" cy="18.7" r=".6" fill="currentColor"/>'
        "</svg>"
    ),
}
LANGUAGE_ICON_FALLBACK = (
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
    '<path d="M8 6 3 12l5 6M16 6l5 6-5 6" stroke="currentColor" stroke-width="1.5" '
    'stroke-linecap="round" stroke-linejoin="round"/></svg>'
)


@app.template_global("language_icon")
def language_icon(name):
    return LANGUAGE_ICONS.get(name.lower(), LANGUAGE_ICON_FALLBACK)


def get_project(slug):
    return next((p for p in PROJECTS if p["slug"] == slug), None)


_SHOT_PATTERN = re.compile(r"^shot(\d+)\.(png|jpe?g|webp)$", re.IGNORECASE)


def discover_gallery_images(slug):
    """Auto-discover gallery screenshots for a project: any file named
    shot1.png, shot2.png, ... in static/images/<slug>/, sorted numerically.
    Other filenames in that folder are ignored here (free to use for
    tutorial images, thumbnails, etc. via the "sections" content blocks)."""
    folder = os.path.join(app.root_path, "static", "images", slug)
    if not os.path.isdir(folder):
        return []
    matches = []
    for fname in os.listdir(folder):
        m = _SHOT_PATTERN.match(fname)
        if m:
            matches.append((int(m.group(1)), fname))
    matches.sort(key=lambda t: t[0])
    return [fname for _, fname in matches]


@app.template_global("project_images")
def project_images(project):
    return discover_gallery_images(project["slug"])


def get_default_branch(owner, repo):
    """Ask GitHub which branch is the default, falling back to 'main'."""
    try:
        r = requests.get(f"https://api.github.com/repos/{owner}/{repo}", timeout=5)
        r.raise_for_status()
        return r.json().get("default_branch", "main")
    except Exception:
        return "main"


# --- Page routes --------------------------------------------------------
@app.route("/")
def home():
    count_this_visit = request.method == "GET" and not _looks_like_bot(request.user_agent.string)
    stats = get_homepage_stats(count_this_visit)
    featured = [p for p in PROJECTS if p.get("pinned")]
    # Homepage doubles as a scannable overview of the whole site now (About,
    # Achievements, Certifications, Projects), each section a condensed
    # teaser linking through to its full page — so pass a small slice of
    # each rather than the full lists that their own dedicated pages use.
    return render_template(
        "index.html", active="home", stats=stats, featured_projects=featured,
        top_achievements=ACHIEVEMENTS[:3], top_certifications=CERTIFICATIONS[:3],
    )


@app.route("/projects")
def projects():
    pinned_only = request.args.get("filter") == "pinned"
    # Stable sort: pinned projects float to the top, everything else keeps
    # its original relative order underneath — nothing is ever hidden by
    # this sort, only reordered (use ?filter=pinned to actually hide the rest).
    sorted_projects = sorted(PROJECTS, key=lambda p: not p.get("pinned", False))
    shown = [p for p in sorted_projects if p.get("pinned")] if pinned_only else sorted_projects
    return render_template("projects.html", active="projects", projects=shown, pinned_only=pinned_only)


@app.route("/projects/<slug>")
def project_detail(slug):
    project = get_project(slug)
    if project is None:
        abort(404)
    return render_template("project_detail.html", active="projects", project=project)


@app.route("/about")
def about():
    return render_template("about.html", active="about")


@app.route("/skills")
def skills():
    return render_template("skills.html", active="skills", languages=LANGUAGES, skills=SKILLS)


@app.route("/certifications")
def certifications():
    categories = sorted({a["category"] for a in ACHIEVEMENTS if a.get("category")})
    active_category = request.args.get("category")
    shown_achievements = (
        [a for a in ACHIEVEMENTS if a.get("category") == active_category]
        if active_category else ACHIEVEMENTS
    )
    return render_template(
        "certifications.html", active="certifications",
        certifications=CERTIFICATIONS, achievements=shown_achievements,
        achievement_categories=categories, active_category=active_category,
    )


@app.route("/skills/<name>")
def skill_detail(name):
    lang_match = next((k for k in LANGUAGES if k.lower() == name.lower()), None)
    if lang_match:
        return render_template(
            "skill_detail.html", active="skills", skill=lang_match,
            projects=LANGUAGES[lang_match], is_language=True,
        )
    skill_match = next((k for k in SKILLS if k.lower() == name.lower()), None)
    if skill_match:
        return render_template(
            "skill_detail.html", active="skills", skill=skill_match,
            projects=SKILLS[skill_match], is_language=False,
        )
    abort(404)


# --- Download: GitHub repo zip, or a locally-hosted file as fallback ------
@app.route("/download/<slug>")
def download(slug):
    project = get_project(slug)
    if project is None:
        abort(404)
    if project.get("github"):
        owner, repo = project["github"].split("/", 1)
        branch = get_default_branch(owner, repo)
        return redirect(f"https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip")
    if project.get("download_file"):
        return send_from_directory(DOWNLOAD_DIR, project["download_file"], as_attachment=True)
    abort(404)


# --- Console preview (java-console / python-console): server-executed, ---
# --- streamed live to the browser ------------------------------------------
# NOTE: this spawns a real `java` or `python3` process per visitor session.
# Fine for local testing; before deploying publicly, add rate limiting, a
# hard cap on concurrent sessions, and a timeout that kills idle processes.
PREVIEW_SESSIONS = {}
SESSIONS_LOCK = threading.Lock()
MAX_SESSIONS = 5

# Reading and streaming one character per SSE message is what made the
# console feel laggy on big bursts of output (each char = its own network
# round trip + DOM update). Instead, a background flusher periodically drains
# whatever's accumulated into one chunk. A timer (not "flush on next char")
# is important here: if the last thing printed is a prompt like
# "Enter your choice: " and the process then blocks waiting on stdin, there
# is no "next character" to trigger a flush — without a timer that prompt
# would sit in the buffer forever and the user would never see it.
READER_FLUSH_INTERVAL = 0.05  # seconds
READER_FLUSH_SIZE = 400       # characters, safety valve for very fast bursts

# Some projects (e.g. Mining Simulator) print raw ANSI color/style codes
# meant for a real terminal. Our preview is a plain <pre> text box in the
# browser, which can't interpret those — left alone they'd show up as
# garbled control characters. Strip them at flush time instead.
_ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")


def _flush_chunk(q, buf):
    if buf:
        q.put(_ANSI_ESCAPE.sub("", "".join(buf)))
        buf.clear()


class BroadcastHub:
    """Fan-out point for output that more than one browser tab/visitor might
    watch at once (the chatroom's shared server log and 5 shared clients).

    Previously each channel was a single queue.Queue() that every SSE
    connection read from directly with .get() — but .get() *removes* the
    item, it doesn't copy it. Two simultaneous viewers on the same client
    tab were racing for the same messages, so each only ever saw about half
    the conversation. A hub gives every subscriber its own private queue and
    publish() fans each chunk out to all of them, so N viewers all see every
    message. It also keeps a short backlog so a (re)connecting viewer isn't
    dropped into a blank screen, and remembers if the channel already ended
    so a late subscriber gets that immediately instead of hanging."""

    def __init__(self, history_limit=4000):
        self._subscribers = set()
        self._lock = threading.Lock()
        self._history = []
        self._history_len = 0
        self._history_limit = history_limit
        self._ended = False

    def put(self, chunk):
        """Alias so this can drop into _reader_thread/_flusher_thread/
        _flush_chunk unchanged — they only ever call q.put(...)."""
        with self._lock:
            if chunk is None:
                self._ended = True
                subs = list(self._subscribers)
            else:
                self._history.append(chunk)
                self._history_len += len(chunk)
                while self._history_len > self._history_limit and len(self._history) > 1:
                    self._history_len -= len(self._history.pop(0))
                subs = list(self._subscribers)
        for sub_q in subs:
            sub_q.put(chunk)

    def subscribe(self):
        sub_q = queue.Queue()
        with self._lock:
            self._subscribers.add(sub_q)
            backlog = "".join(self._history)
            ended = self._ended
        if backlog:
            sub_q.put(backlog)
        if ended:
            sub_q.put(None)
        return sub_q

    def unsubscribe(self, sub_q):
        with self._lock:
            self._subscribers.discard(sub_q)


def _reader_thread(read_stream, q, buf, buf_lock):
    """Reads from any object exposing .read(1) — a subprocess's stdout, or a
    socket wrapped via sock.makefile() — one character at a time (Java only
    flushes prompts on newline OR explicit flush, so line-buffered reads
    would hide unterminated prompts) and appends into a shared buffer that
    _flusher_thread drains."""
    try:
        while True:
            ch = read_stream.read(1)
            if not ch:
                break
            with buf_lock:
                buf.append(ch)
                flush_now = len(buf) >= READER_FLUSH_SIZE
            if flush_now:
                with buf_lock:
                    _flush_chunk(q, buf)
    except Exception:
        pass
    finally:
        with buf_lock:
            _flush_chunk(q, buf)
        q.put(None)


def _flusher_thread(is_alive, q, buf, buf_lock):
    """Drains the buffer on a fixed interval so partial/unterminated output
    (prompts with no trailing newline) still reaches the browser promptly.
    is_alive is a zero-arg callable; the thread stops once it returns False."""
    while is_alive():
        time.sleep(READER_FLUSH_INTERVAL)
        with buf_lock:
            _flush_chunk(q, buf)


@app.route("/preview/<slug>/start", methods=["POST"])
def preview_start(slug):
    project = get_project(slug)
    runtime = project.get("runtime") if project else None
    if project is None or runtime not in ("java-console", "python-console"):
        abort(404)

    with SESSIONS_LOCK:
        # Drop any sessions whose process already exited before counting.
        for sid in list(PREVIEW_SESSIONS):
            if PREVIEW_SESSIONS[sid]["proc"].poll() is not None:
                del PREVIEW_SESSIONS[sid]
        if len(PREVIEW_SESSIONS) >= MAX_SESSIONS:
            return jsonify({"error": "Too many active previews right now — try again shortly."}), 503

    entry_path = os.path.join(app.root_path, "static", "previews", project["slug"], project["preview_entry"])
    if not os.path.isfile(entry_path):
        return jsonify({"error": f"Preview entry not found at static/previews/{project['slug']}/{project['preview_entry']}."}), 500

    if runtime == "java-console":
        if shutil.which("java") is None:
            return jsonify({
                "error": "Java isn't installed (or isn't on PATH) on this machine. "
                         "This preview runs the game server-side with `java -jar`, so "
                         "a JDK/JRE needs to be installed wherever Flask is running — "
                         "install one (e.g. from adoptium.net) and try again."
            }), 500
        cmd = ["java", "-jar", entry_path]
    else:  # python-console
        cmd = [sys.executable or "python3", "-u", entry_path]

    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=os.path.dirname(entry_path),
        )
    except Exception as e:
        kind = "Java" if runtime == "java-console" else "Python"
        return jsonify({"error": f"Couldn't start the {kind} process: {e}"}), 500

    q = queue.Queue()
    session_id = uuid.uuid4().hex
    with SESSIONS_LOCK:
        PREVIEW_SESSIONS[session_id] = {"proc": proc, "queue": q, "started": time.time()}
    buf = []
    buf_lock = threading.Lock()
    threading.Thread(target=_reader_thread, args=(proc.stdout, q, buf, buf_lock), daemon=True).start()
    threading.Thread(target=_flusher_thread, args=(lambda: proc.poll() is None, q, buf, buf_lock), daemon=True).start()
    return jsonify({"session_id": session_id})


@app.route("/preview/stream/<session_id>")
def preview_stream(session_id):
    session = PREVIEW_SESSIONS.get(session_id)
    if session is None:
        abort(404)
    q = session["queue"]

    def gen():
        print("SSE connected")

        yield ": connected\n\n"

        while True:
            try:
                chunk = q.get(timeout=25)
            except queue.Empty:
                print("keepalive")
                yield ": keepalive\n\n"
                continue

            if chunk is None:
                print("END")
                yield "event: end\ndata: {}\n\n"
                break

            print("SENDING:", repr(chunk[:40]))
            yield f"data: {json.dumps(chunk)}\n\n"

    return Response(
    gen(),
    mimetype="text/event-stream",
    headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    },
)


@app.route("/preview/input/<session_id>", methods=["POST"])
def preview_input(session_id):
    session = PREVIEW_SESSIONS.get(session_id)
    if session is None:
        abort(404)
    data = request.get_json(silent=True) or {}
    line = data.get("input", "")
    proc = session["proc"]
    try:
        proc.stdin.write(line + "\n")
        proc.stdin.flush()
    except Exception:
        abort(410)
    return jsonify({"ok": True})


@app.route("/preview/stop/<session_id>", methods=["POST"])
def preview_stop(session_id):
    with SESSIONS_LOCK:
        session = PREVIEW_SESSIONS.pop(session_id, None)
    if session is not None:
        try:
            session["proc"].kill()
        except Exception:
            pass
    return jsonify({"ok": True})


# --- Networked multi-client preview (Chatroom) ----------------------------
# Unlike java-console, this doesn't spin up one process per visitor. The real
# ChatServer hardcodes its port (12345) rather than accepting one as an
# argument, so running one server per session would collide on that port.
# Instead this is ONE shared, always-on demo: the real ChatServer runs once,
# and 5 simulated clients — plain Python sockets speaking the server's exact
# line-based protocol (send a username, then it's just readLine() in a loop)
# — connect to it and stay connected. Any visitor can watch or "drive" any of
# the 5 clients; switching which one you're looking at is just switching
# which client's message queue you're reading from, server-side state is
# unaffected by who's watching.
CHAT_CLIENT_LABELS = ["Client 1", "Client 2", "Client 3", "Client 4", "Client 5"]
CHAT_NETWORK_LOCK = threading.Lock()
CHAT_NETWORK_STATE = {"server_proc": None, "server_hub": None, "server_buf": None,
                       "server_buf_lock": None, "clients": {}}


def _spawn_chat_client(label):
    """Connect one simulated client socket to the (already-running) shared
    server and wire up its reader/flusher threads + hub. Returns the client
    dict for CHAT_NETWORK_STATE["clients"], or None if it couldn't connect.
    Factored out of _ensure_chatroom_network() so the same logic can both
    spin up the initial 5 clients and later revive any that have died —
    see the healing loop below."""
    sock = None
    # Small retry window: the startup line can print a moment before
    # the server's accept() loop is actually ready to take connections.
    for attempt in range(10):
        try:
            sock = socket.create_connection(("127.0.0.1", 12345), timeout=2)
            sock.sendall((label + "\n").encode("utf-8"))
            break
        except OSError:
            sock = None
            time.sleep(0.2)
    if sock is None:
        return None
    hub = BroadcastHub()
    buf, buf_lock = [], threading.Lock()
    read_stream = sock.makefile("r", encoding="utf-8", newline="")
    alive = {"v": True}
    threading.Thread(target=_reader_thread, args=(read_stream, hub, buf, buf_lock), daemon=True).start()
    threading.Thread(target=_flusher_thread, args=(lambda a=alive: a["v"], hub, buf, buf_lock), daemon=True).start()
    return {"sock": sock, "hub": hub, "buf": buf, "buf_lock": buf_lock, "label": label, "alive": alive}


def _ensure_chatroom_network():
    """Idempotent: starts the shared server + 5 clients on first call, and
    just returns the existing state on every call after that.

    "Existing state" used to mean *whatever's in CHAT_NETWORK_STATE*, even
    if one or more of the 5 simulated clients had quietly died — e.g. their
    socket got reset, or the server booted a client that then dropped. The
    server_proc itself was still running, so the early-return above always
    fired and nothing ever re-connected that one client: its BroadcastHub
    stays permanently "ended", and every subsequent SSE subscriber for it
    just gets the old backlog replayed followed by an immediate end (this is
    what shows up client-side as the demo being stuck on "[disconnected]").
    So on every call, also check for and revive any dead clients before
    returning — cheap when everything's healthy (one attribute check per
    client), and self-heals the common case without needing to restart the
    whole shared server (which would also kick every other visitor
    currently watching it)."""
    with CHAT_NETWORK_LOCK:
        if CHAT_NETWORK_STATE["server_proc"] is not None and CHAT_NETWORK_STATE["server_proc"].poll() is None:
            for client_id, client in list(CHAT_NETWORK_STATE["clients"].items()):
                if not client["hub"]._ended:
                    continue
                revived = _spawn_chat_client(client["label"])
                if revived is not None:
                    CHAT_NETWORK_STATE["clients"][client_id] = revived
                # If revival failed too, leave the dead entry in place rather
                # than dropping it — it'll just show as ended/disconnected
                # for that tab (same as before this fix) instead of
                # disappearing, and we'll retry again on the next call.
            return CHAT_NETWORK_STATE

        project = get_project("chatroom")
        jar_path = os.path.join(app.root_path, "static", "previews", "chatroom", "chatroom-server.jar")
        if not os.path.isfile(jar_path):
            raise RuntimeError("Chatroom server jar not found — run scripts/build_preview.py first.")
        if shutil.which("java") is None:
            raise RuntimeError("Java isn't installed (or isn't on PATH) on this machine.")

        # ChatServer.main() writes a .desktop shortcut file under this path;
        # pre-create it so that's a no-op instead of a startup stack trace.
        os.makedirs(os.path.expanduser("~/.local/share/applications"), exist_ok=True)

        # Also tell the jar to skip shortcut creation entirely — this is a
        # headless container with no desktop environment (no `gio`, often
        # no GUI at all), so there's nothing useful for a .desktop file to
        # do here. Real end users running the downloaded jar themselves
        # won't have this env var set, so they still get their shortcut.
        preview_env = dict(os.environ, CHATROOM_SKIP_SHORTCUT="1")

        proc = subprocess.Popen(
            ["java", "-jar", jar_path],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
            cwd=os.path.dirname(jar_path),
            env=preview_env,
        )

        # Read line-by-line ourselves until the startup message appears,
        # *before* handing the stream off to the regular char-based reader
        # thread — reading it two different ways at once would race. This
        # also means we don't lose those early lines; they get seeded into
        # the queue below so the "Server" tab still shows them.
        early_lines = []
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            line = proc.stdout.readline()
            if not line:
                break
            early_lines.append(line)
            if "started on port" in line:
                break

        server_hub = BroadcastHub()
        for line in early_lines:
            server_hub.put(_ANSI_ESCAPE.sub("", line))
        server_buf, server_buf_lock = [], threading.Lock()
        threading.Thread(target=_reader_thread, args=(proc.stdout, server_hub, server_buf, server_buf_lock), daemon=True).start()
        threading.Thread(target=_flusher_thread, args=(lambda: proc.poll() is None, server_hub, server_buf, server_buf_lock), daemon=True).start()

        clients = {}
        for i, label in enumerate(CHAT_CLIENT_LABELS, start=1):
            client = _spawn_chat_client(label)
            if client is not None:
                clients[f"client-{i}"] = client
            # else: this one client failed to connect; leave it out (the
            # healing check above will keep retrying it on later calls)

        CHAT_NETWORK_STATE.update({
            "server_proc": proc, "server_hub": server_hub, "server_buf": server_buf,
            "server_buf_lock": server_buf_lock, "clients": clients,
        })
        return CHAT_NETWORK_STATE


@app.route("/preview/chatroom-network/start", methods=["POST"])
def chatroom_network_start():
    try:
        state = _ensure_chatroom_network()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({
        "clients": [{"id": cid, "label": c["label"]} for cid, c in state["clients"].items()],
    })


@app.route("/preview/chatroom-network/gui-config")
def chatroom_network_gui_config():
    """Config for the optional 'real Swing GUI' preview (CheerpJ + Tailscale)
    — see loadCheerpJChatPreview() in main.js. Deliberately returns 503
    rather than a broken client-side load when the deployment hasn't been
    set up with a tailnet yet, since local dev / a fresh deploy won't have
    these env vars set and the sim-only preview should keep working fine.

    TAILSCALE_CLIENT_AUTHKEY is meant to be handed to every visitor's
    browser — that's expected, not a leak, *as long as* it's an ephemeral,
    reusable, tagged key whose ACL only permits reaching the chat server's
    own tagged node on the chat port. It is NOT the same key used to join
    the server container itself to the tailnet (TAILSCALE_SERVER_AUTHKEY,
    used only in the container's own startup script, never sent to a
    browser). See the deployment notes in README.md before setting these.
    """
    auth_key = os.environ.get("TAILSCALE_CLIENT_AUTHKEY")
    server_host = os.environ.get("TAILSCALE_CHATROOM_HOSTNAME", "chatroom-server")
    if not auth_key:
        return jsonify({"error": "GUI preview isn't configured on this deployment yet."}), 503
    return jsonify({"authKey": auth_key, "serverHost": server_host})


@app.route("/preview/chatroom-network/stream/<channel>")
def chatroom_network_stream(channel):
    state = CHAT_NETWORK_STATE
    if channel == "server":
        hub = state["server_hub"]
    else:
        client = state["clients"].get(channel)
        hub = client["hub"] if client else None
    if hub is None:
        abort(404)

    def gen():
        # Each connection gets its own subscriber queue so multiple viewers
        # (or the same viewer reconnecting) all see every message, instead
        # of racing to drain one shared queue between them.
        sub_q = hub.subscribe()
        try:
            while True:
                try:
                    chunk = sub_q.get(timeout=25)
                except queue.Empty:
                    yield ": keepalive\n\n"
                    continue
                if chunk is None:
                    yield "event: end\ndata: {}\n\n"
                    break
                yield f"data: {json.dumps(chunk)}\n\n"
        finally:
            hub.unsubscribe(sub_q)

    return Response(gen(), mimetype="text/event-stream")


@app.route("/preview/chatroom-network/input/<client_id>", methods=["POST"])
def chatroom_network_input(client_id):
    client = CHAT_NETWORK_STATE["clients"].get(client_id)
    if client is None:
        abort(404)
    data = request.get_json(silent=True) or {}
    line = data.get("input", "")
    try:
        client["sock"].sendall((line + "\n").encode("utf-8"))
    except Exception:
        abort(410)
    return jsonify({"ok": True})


# --- 404 page --------------------------------------------------------------
@app.errorhandler(404)
def not_found(e):
    return render_template("404.html"), 404


if __name__ == "__main__":
    # host="0.0.0.0" + $PORT matters for cloud deploys (e.g. Render): the
    # platform assigns a port via the PORT env var and expects the process
    # to bind ALL interfaces on it. Flask's default (127.0.0.1) only accepts
    # connections from inside this exact process's own network namespace —
    # not reachable from the platform's edge/proxy at all. Falls back to
    # 5000 for local dev, matching the README's instructions.
    #
    # use_reloader=False on purpose: the reloader restarts the whole worker
    # process on file changes, which kills any live java-console preview
    # subprocesses (their stdin pipe closes -> Scanner throws
    # NoSuchElementException). If you want template auto-reload back while
    # developing, re-enable it, but expect any open preview to die on save.
    # debug=True enables Werkzeug's interactive in-browser debugger on any
    # unhandled exception — great for local dev, but on a public deployment
    # it lets anyone who can trigger a 500 attempt to run arbitrary Python
    # on the server. Defaults OFF; opt in locally with FLASK_DEBUG=1.
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=debug, use_reloader=False, threaded=True)