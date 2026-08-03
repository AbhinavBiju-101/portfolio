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
import markdown as md
import requests

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
PROJECTS = [
    {
        "slug": "grimoire-legacy",
        "name": "Grimoire: Legacy",
        "tagline": "A turn-based spell combat simulator with 150+ unique spells and deep effect interactions.",
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
        "name": "Mining Simulator",
        "tagline": "A text-based mining game — 35 minerals across 4 rarity variants each, with LCM-based weighted drop rates and persistent player accounts.",
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
        "name": "Greed Island",
        "tagline": "An evolutionary simulation — 20 autonomous AI agents develop survival strategies through genetic inheritance over generations.",
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
        "name": "SkynetGrid",
        "tagline": "A remote lab-administration suite — deployed with school approval to a computer lab for remote screen viewing, input control, and terminal access.",
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
        "name": "Chatroom (v11)",
        "tagline": "A LAN chatroom with a Swing GUI client, multi-client server, file transfer, and emoji support — v11 of an iterated project.",
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
]

DOWNLOAD_DIR = os.path.join(app.root_path, "static", "downloads")


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
    return render_template("index.html", active="home")


@app.route("/projects")
def projects():
    return render_template("projects.html", active="projects", projects=PROJECTS)


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


# --- Java console preview: server-executed, streamed live to the browser ---
# NOTE: this spawns a real `java` process per visitor session. Fine for local
# testing; before deploying publicly, add rate limiting, a hard cap on
# concurrent sessions, and a timeout that kills idle processes.
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
    if project is None or project.get("runtime") != "java-console":
        abort(404)

    with SESSIONS_LOCK:
        # Drop any sessions whose process already exited before counting.
        for sid in list(PREVIEW_SESSIONS):
            if PREVIEW_SESSIONS[sid]["proc"].poll() is not None:
                del PREVIEW_SESSIONS[sid]
        if len(PREVIEW_SESSIONS) >= MAX_SESSIONS:
            return jsonify({"error": "Too many active previews right now — try again shortly."}), 503

    jar_path = os.path.join(app.root_path, "static", "previews", project["slug"], project["preview_entry"])
    if not os.path.isfile(jar_path):
        return jsonify({"error": f"Preview jar not found at static/previews/{project['slug']}/{project['preview_entry']}."}), 500

    if shutil.which("java") is None:
        return jsonify({
            "error": "Java isn't installed (or isn't on PATH) on this machine. "
                     "This preview runs the game server-side with `java -jar`, so "
                     "a JDK/JRE needs to be installed wherever Flask is running — "
                     "install one (e.g. from adoptium.net) and try again."
        }), 500

    try:
        proc = subprocess.Popen(
            ["java", "-jar", jar_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=os.path.dirname(jar_path),
        )
    except Exception as e:
        return jsonify({"error": f"Couldn't start the Java process: {e}"}), 500

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
CHAT_NETWORK_STATE = {"server_proc": None, "server_q": None, "server_buf": None,
                       "server_buf_lock": None, "clients": {}}


def _ensure_chatroom_network():
    """Idempotent: starts the shared server + 5 clients on first call, and
    just returns the existing state on every call after that."""
    with CHAT_NETWORK_LOCK:
        if CHAT_NETWORK_STATE["server_proc"] is not None and CHAT_NETWORK_STATE["server_proc"].poll() is None:
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

        proc = subprocess.Popen(
            ["java", "-jar", jar_path],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
            cwd=os.path.dirname(jar_path),
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

        server_q = queue.Queue()
        for line in early_lines:
            server_q.put(_ANSI_ESCAPE.sub("", line))
        server_buf, server_buf_lock = [], threading.Lock()
        threading.Thread(target=_reader_thread, args=(proc.stdout, server_q, server_buf, server_buf_lock), daemon=True).start()
        threading.Thread(target=_flusher_thread, args=(lambda: proc.poll() is None, server_q, server_buf, server_buf_lock), daemon=True).start()

        clients = {}
        for i, label in enumerate(CHAT_CLIENT_LABELS, start=1):
            client_id = f"client-{i}"
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
                continue  # this one client failed to connect; leave it out
            q = queue.Queue()
            buf, buf_lock = [], threading.Lock()
            read_stream = sock.makefile("r", encoding="utf-8", newline="")
            alive = {"v": True}
            threading.Thread(target=_reader_thread, args=(read_stream, q, buf, buf_lock), daemon=True).start()
            threading.Thread(target=_flusher_thread, args=(lambda a=alive: a["v"], q, buf, buf_lock), daemon=True).start()
            clients[client_id] = {"sock": sock, "queue": q, "buf": buf, "buf_lock": buf_lock,
                                   "label": label, "alive": alive}

        CHAT_NETWORK_STATE.update({
            "server_proc": proc, "server_q": server_q, "server_buf": server_buf,
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


@app.route("/preview/chatroom-network/stream/<channel>")
def chatroom_network_stream(channel):
    state = CHAT_NETWORK_STATE
    if channel == "server":
        q = state["server_q"]
    else:
        client = state["clients"].get(channel)
        q = client["queue"] if client else None
    if q is None:
        abort(404)

    def gen():
        while True:
            try:
                chunk = q.get(timeout=25)
            except queue.Empty:
                yield ": keepalive\n\n"
                continue
            if chunk is None:
                yield "event: end\ndata: {}\n\n"
                break
            yield f"data: {json.dumps(chunk)}\n\n"

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
    # use_reloader=False on purpose: the reloader restarts the whole worker
    # process on file changes, which kills any live java-console preview
    # subprocesses (their stdin pipe closes -> Scanner throws
    # NoSuchElementException). If you want template auto-reload back while
    # developing, re-enable it, but expect any open preview to die on save.
    app.run(debug=True, use_reloader=False, threaded=True)
    
