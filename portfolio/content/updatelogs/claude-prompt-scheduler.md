# Claude Prompt Scheduler — Update Log

A Firefox extension that types and sends a prompt into claude.ai at a chosen time. There's no claude.ai API, so it works by finding the real page elements — message box, send button, rate-limit text — and driving them.

This project has no GitHub repository; versioning was done entirely through addons.mozilla.org. This log is reconstructed from the 20 signed build artifacts in `web-ext-artifacts/`, each dated by its build timestamp, and diffed against each other file by file.

**At a glance:** 20 releases in 7 days — 8 files / 1,686 lines on 8 Sep → 33 files / 7,288 lines on 14 Sep. Grew from a single-prompt timer into a multi-step sequencer with a synced prompt library and cross-profile workspaces.

---

## 1.0 — First Signed Build
**8 Sep 2026, 12:46 · 101 KB**

**Added**
- The three-part core: `background.js` (alarms, retry logic, history logging), `content.js` (DOM injection into claude.ai), `popup.js` (quick-add UI).
- Fixed-time and auto-detect scheduling. Auto-detect polls every minute and fires when the page stops looking rate-limited — it requires *both* a disabled send button and matching limit text, to cut false positives.
- Auto-retry: failed fixed-time jobs retry up to 3 times, 2 minutes apart.
- `dashboard.html` — the live queue with search, filter and inline editing.
- `history.html` — a log of every send attempt (sent / failed / retrying / missed).
- Bundled Space Grotesk and JetBrains Mono, so the UI never makes a network request for fonts.

---

## 1.2 – 1.2.2 — Listing Iterations
**8 Sep 2026, 18:06 – 18:16 · +3 lines total**

Three builds in ten minutes, all essentially identical. The AMO listing goes live at 18:08 between 1.2 and 1.2.1; these are metadata and signing corrections, not code changes.

---

## 1.2.3 — Packaging Cleanup
**8 Sep 2026, 19:02 · 111 KB**

Switches from signed `.xpi` output to `web-ext` source zips. Size drops 10 KB as build artifacts stop being bundled into themselves.

---

## 1.2.4 — Custom Date/Time Picker
**9 Sep 2026, 02:12 · +367 lines**

**Added**
- `datetime-picker.js` — a purpose-built picker replacing the native `<input type="datetime-local">`, which couldn't express "tonight when the limit resets" cleanly.

---

## 1.4.1 — Prompt Library and a Backend
**10 Sep 2026, 04:21 · +1,423 lines**

The first change of intent. Up to now everything lived in browser storage on one machine.

**Added**
- `supabase-client.js` / `supabase-config.js` — a Supabase (PostgreSQL) backend, with access governed entirely by Row Level Security so the shipped anon key is safe.
- `library.html` / `library.js` / `snippets.js` — a browsable catalogue of prompt templates.
- Heavy rework of `content.js` (190 changed lines) and `dashboard.js` (290) to support library-sourced prompts.

---

## 1.5.0 — Accounts and Multi-Step Sequences
**11 Sep 2026, 02:47 · +1,269 lines**

**Added**
- `account.html` / `account.js` — Google sign-in through `browser.identity`, so a saved library syncs across devices.
- `steps-editor.js` — **multi-step sequences**: chain several prompts into one job, optionally branching on keywords in Claude's reply. This is the feature that changes what the extension is for; it stops being a timer and becomes a small automation runner.
- `supabase-schema.sql`, `supabase-seed.sql`, `supabase-seed-batch2.sql` — the `snippets` and `user_library` tables plus their RLS policies and seed catalogue.
- `datetime-picker.js` largely rewritten (470 changed lines).

---

## 1.6.0 — Placeholders
**12 Sep 2026, 04:13 · +810 lines**

**Added**
- `placeholders.js` — templated prompts with fill-in slots, so one library entry covers many uses.
- `library.js` (417 changed lines) and `supabase-client.js` (263) reworked around rating and submitting catalogue prompts.

---

## 1.6.1 – 1.6.3 — Fixes
**12 Sep 2026, 05:15 – 10:58 · +19 lines total**

Small corrections; a `supabase-client.js` fix in 1.6.3.

---

## 1.7.0 — Privacy Policy
**12 Sep 2026, 14:03 · +99 lines**

**Added**
- `privacy-policy.html`, shipped inside the extension rather than only hosted on the listing — required once Google sign-in was in play.

---

## 1.7.1 — First Migration
**12 Sep 2026, 14:09**

**Added**
- `migration-05.sql` — schema changes now ship as ordered migrations instead of edits to the base schema.

---

## 1.7.2 — Workspaces
**13 Sep 2026, 08:35 · +143 lines**

**Added**
- `workspace.html` / `workspace.js` — link multiple Firefox profiles into a shared workspace, route jobs between them, and share templates.
- `nav.js` — shared navigation, now that there are six pages.
- `account.js` +152 lines for profile linking.

---

## 1.7.4 — Profile Linking Fixes
**13 Sep 2026, 08:47 · +96 lines**

**Added**
- `migration-07.sql`.

**Changed**
- `content.js` and `popup.js` corrections. (1.7.3 was never released.)

---

## 1.7.5 — Compose Page
**13 Sep 2026, 19:03 · +301 lines**

**Added**
- `compose.html` / `compose.js` — a full-page composer for long or multi-step prompts, since the popup is too small to edit a sequence in.

---

## 1.7.6 — Picker Fix
**13 Sep 2026, 19:09 · −29 lines**

**Changed**
- `datetime-picker.js` corrections (79 changed lines).

---

## 2.1.0 — Targets, Profiles, Reset Times
**14 Sep 2026, 07:06 · +835 lines**

A major version bump. (2.0.x was never published.)

**Added**
- `target-editor.js` — choose *where* a job sends: the current tab, a brand-new chat, or a specific existing conversation.
- `chat-picker.js` — pick that existing conversation by name.
- `profile-picker.js` — route a job to a particular linked profile.
- `reset-time.js` — model when the usage limit actually resets, rather than only reacting to the rate-limit banner.
- `migration-08.sql`.
- File attachments on scheduled prompts.

**Changed**
- `dashboard.js` (187), `popup.js` (144), `content.js` (126) — the queue and popup rebuilt around targets.

---

## 2.1.1 — Current Release
**14 Sep 2026, 17:16 · 207 KB · +265 lines**

**Changed**
- `datetime-picker.js` (141 changed lines), `chat-picker.js` (46), `content.js` (71), `popup.js` (71) — refinement of the 2.1.0 features. This is the version live on AMO.

---

## Summary of Feature Timeline

| Capability | Introduced | Notes |
|---|---|---|
| Fixed-time scheduling | 1.0 | |
| Auto-detect (waits for limit to clear) | 1.0 | two-signal heuristic |
| Auto-retry, queue dashboard, history log | 1.0 | |
| Custom date/time picker | 1.2.4 | |
| Supabase backend + prompt library | 1.4.1 | first cloud feature |
| Google sign-in, cross-device sync | 1.5.0 | |
| Multi-step branching sequences | 1.5.0 | |
| Templated placeholders | 1.6.0 | |
| SQL migrations | 1.7.1 | |
| Cross-profile workspaces | 1.7.2 | |
| Full-page composer | 1.7.5 | |
| Send targets (tab / new chat / named chat) | 2.1.0 | |
| File attachments | 2.1.0 | |
| Reset-time modelling | 2.1.0 | |

**Growth:** 1,686 → 7,288 lines · 8 → 33 files · 101 KB → 207 KB.

*Log generated from a file-by-file diff of the 20 signed build artifacts in `web-ext-artifacts/`, dated by build timestamp and cross-referenced against the AMO listing.*
