# Chatroom — Update Log

A Java LAN chat system — a Swing client, a multithreaded server, and a separate file-transfer channel — built to learn sockets by running an actual chatroom on a school network.

This log covers the 13 folders in the archive (`Chatroom v1`–`v11`, the `chatroom_server v4` server-side split, and the final standalone `chatroom_server` distribution), from a line-by-line diff of `ChatClient.java`, `ChatServer.java`, `FileClient.java`, `FileServer.java` and `Setup.java` between consecutive versions.

**At a glance:** 277 lines and a hardcoded IP → 1,567 lines with self-updating clients, rich-text markup, file sharing, desktop shortcut installation and automatic server discovery.

*(`v4` is stored as `chatroom_server v4` — the folder was renamed when the server was split out, not skipped.)*

---

## v1 — Client Prototype
**Added**
- `ChatClient` — Swing window with a `JTextPane` chat area, input field, per-user colour assignment, a typing indicator (`"Bob is typing…"`), and a slash-command map.
- `FileClient` — a separate socket for file transfer, kept off the chat connection from the very start.
- Server IP hardcoded to `192.168.100.60`.

---

## v2 — No Change
Identical to v1. A snapshot taken before the next round of work.

---

## v3 — Minor Fixes
**Changed**
- Small `FileClient` correction (−6 lines).

---

## v4 — The Server (folder: `chatroom_server v4`)
**Added**
- `ChatServer` with a per-client `ClientHandler` thread, `broadcast()`, `sendUserList()`, `getUniqueUsername()` (auto-suffixes duplicate names) and `kickUser()` / `shutdownServer()` moderation.
- `FileServer` with `handleFileUpload()`, `handleFileDownload()`, `broadcastFile()`, `sanitizeFilename()` and `uniqueFile()` — filename sanitising is in from the first version, since clients name their own uploads.
- **Rich text:** `insertStyledText()`, `getStyledTextAsMarkup()`, `normalizeMarkup()`, `applyGlobalParsing()`, `toggleStyle()` and `replaceEmojis()` — bold/italic markup and emoji substitution in the chat pane.
- `attachFile()` in the client; `broadcastTyping()` for the typing indicator.
- `Mixer` — an audio experiment for notification sounds.

**Changed**
- `ChatClient` +212/−54 as it learns to talk to a real server. +895 lines net, the single largest jump in the project.

*This is the version where it stops being a client looking for a server and becomes a system.*

---

## v5 — Self-Updating Clients
**Added**
- `CLIENT_VERSION` constant, `checkForUpdate()`, `compareVersion()` on the client, and `getLatestClientVersion()` / `handleUpdateRequest()` on the server. The server reads the version string straight out of its own copy of `ChatClient.java` and pushes a newer client to anyone running an older one on connect.

**Removed**
- `FileServer.java` and the `aaaa.java` scratch file — file handling is folded into `ChatServer` for now.

*Intent expansion: this stops being a program you hand to people and becomes something that maintains itself across a lab of machines.*

---

## v6 — Live User List
**Added**
- `broadcastUserList()` / `updateUserList()` — a live roster that updates as people join and leave.

**Removed**
- `Mixer` — the audio experiment is abandoned.

---

## v7 — Self-Deleting Installer
**Added**
- `Setup.java` — a first-run installer that compiles what it needs and then deletes the source files (`ChatServer.java`, `ChatClient.java`, and itself) from the client machine, leaving only the runnable classes.

**Removed**
- `codebin.java` scratch file; `FileClient` / `FileServer` / `sendFile()` / `broadcastFile()` are stripped out entirely in this version.

---

## v8 — File Transfer, Rebuilt
**Added**
- `requestFileFromServer()` and `handleFileServerRequest()` — file transfer returns, this time as a request/response protocol through the server rather than a direct client-to-client socket.
- `deleteDirectory()` for cleanup.

**Removed**
- `handleUpdateRequest()` in its v5 form, reworked into the new request protocol.

**Changed**
- `ChatServer` +114/−52.

---

## v9 — File Browsing
**Added**
- `FileClient` returns as its own class, with `requestFileListFromServer()` — clients can now browse what's on the server rather than only receiving pushed files.

**Changed**
- `ChatServer` −100 lines as the old download path is removed in favour of the listing-based one.

---

## v10 — Desktop Integration
**Added**
- `createShortcut()` — generates a real desktop shortcut with an icon (`icon.png`) on install, so the chatroom launches like an application instead of from a terminal.

---

## v11 — Automatic Server Discovery (Latest)
**Added**
- `getIP()` — the client determines the LAN address itself and sets `SERVER_IP` at startup. The hardcoded `192.168.100.60` from v1 is finally gone, so the same build runs on any network without editing source.

---

## `chatroom_server` — Standalone Server Distribution
Not a version — this is the trimmed server-only package meant to sit on the host machine.

**Contains**
- `ChatServer`, `FileServer` and a minimal `ChatClient`.

**Stripped**
- All client-side UI (`insertStyledText`, `toggleStyle`, `attachFile`, `updateUserList`), the updater, the installer and the shortcut logic — −1,000 lines against v11.

---

## Planned but not built
`Ideas.docx` in the archive lists the next round that was never implemented:

- Drop the socket timeout from 5000 ms to 500 ms.
- Diagnose why the update server is unreachable from other machines.
- Accounts with email/username/password, join date and message counts.
- Persisted login with logout.
- A background listener started at boot, so the server can force the chatroom open on every machine — and auto-fill the logged-in username when it does.

*The last two overlap heavily with what SkynetGrid ended up doing instead; it looks like that line of thinking moved there rather than being finished here.*

---

## Summary of Feature Timeline

| Capability | Introduced | Notes |
|---|---|---|
| Swing client, typing indicator, user colours | v1 | |
| Separate file-transfer socket | v1 | removed v7, rebuilt v8 |
| Multithreaded server, moderation | v4 | |
| Rich-text markup + emoji | v4 | |
| Notification audio | v4 | dropped v6 |
| Self-updating clients | v5 | |
| Live user list | v6 | |
| Self-deleting installer | v7 | |
| Request/response file protocol | v8 | |
| Server file browsing | v9 | |
| Desktop shortcut install | v10 | |
| Automatic LAN discovery | v11 | replaces hardcoded IP |

*Log generated from a diff of `ChatClient.java`, `ChatServer.java`, `FileClient.java`, `FileServer.java`, `Setup.java` and `Mixer.java` across all 13 folders in the archive.*
