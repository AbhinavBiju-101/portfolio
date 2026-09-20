# FileDashboard — Update Log

A browser-accessible file manager written against the JDK's built-in `com.sun.net.httpserver` — no Spring, no servlet container, no build tool, no external dependencies. Every handler, the HTML, the CSS and the client-side JavaScript are generated from Java.

This log covers the three snapshots in the archive (`v1`, `v2`, and the final `FileDashboard` folder), from a line-by-line diff of all handler and utility classes.

**At a glance:** 35 classes / 3,757 lines → 75 classes / 13,939 lines. Grew from a local file browser into a dual-backend explorer that treats Google Drive as a second filesystem.

*Only three snapshots were kept, so each step here covers a lot of ground. `prompts (File dashboard).docx` in the archive preserves the running feature requests behind many of these changes.*

---

## v1 — The Dependency-Free Web File Browser
_Last modified: 31 Jul 2026, 02:55_

**Added** — 35 classes, already a complete architecture:

*Server core*
- `FileServer` (the `HttpServer` bootstrap), `AuthFilter`, `PathUtil`, `QueryUtil`, `MimeUtil`, `MiniJson` — a hand-rolled JSON writer, since there's no Jackson or Gson.

*Browsing*
- `BrowseHandler`, `FoldersHandler`, `HomeHandler`, `AppShellHandler`, `SidebarRenderer`, `GridRenderer`, `HiddenFileUtil`.

*Viewing*
- `FileViewHandler`, `ViewerHandler`, `ViewabilityUtil`, `ThumbnailHandler`, `MarkdownLite` — a small Markdown renderer written from scratch to preview `.md` files in-browser.

*Operations*
- `FileOpsHandler`, `UploadHandler`, `MultipartParser` (multipart form parsing, also hand-written), `ZipDownloadHandler`, `ZipSelectionHandler`.

*Recycle bin*
- `TrashHandler`, `TrashManager`, `TrashOpsHandler` — a real recycle bin with restore, not just delete.

*Search*
- `SearchHandler`, `SearchSuggester`, `SuggestHandler` — recursive search with live suggestions.

*Frontend*
- `Styles` and `PageScripts` — the entire CSS and JS payload emitted as Java string constants.

*Activity*
- `RecentActivity` — tracks what's been opened.

---

## v2 — Settings, Autostart, Quickstart
_Last modified: 02 Aug 2026, 01:20_

**Added**
- `Settings` + `SettingsHandler` — a real settings page: configurable root directory (`setRootDirOverride()`), dashboard item limits (`setDashboardMaxItems()`), and a live-refresh toggle.
- `AutostartManager` — `enable()` / `disable()` / `isEnabled()` plus `findJarPath()` and `findJavaw()`, backed by `install-autostart.bat` / `uninstall-autostart.bat` / `stop.bat` / `build-jar.bat`. The dashboard now starts with Windows.
- `QuickstartHandler` — a first-run help page, with its own `quickstartStyles()`.
- `TextSniffer` with `looksLikeText()` — content-based detection of whether an unknown file is safe to open in the text viewer, rather than trusting the extension.
- `setupLogging()` — file-based logging.

**Changed**
- `RecentActivity` (+58/−25) reworked from "recently viewed" to **frequently viewed**, with `loadCounts()` / `appendCounts()` persisting an access tally. Both the dashboard sections and the max-item cap come from this change.
- `ShellScript` +76, `PageScripts` +57, `PathUtil` +23/−16 — the root-directory override rippling through path resolution. Fixes the "Forbidden: Access outside the root directory" problem recorded in the notes.

**Note**
- Several files are duplicated as `Name(1).java` (Drive copy artifacts), cleaned up in the next version.

---

## Final build — Google Drive, Multi-User, Cross-Platform
_Last modified: 18 Aug 2026, 19:23_


This is the largest single expansion in any of my projects: **+40 classes, +8,353 lines**, and a change of intent. Up to v2 this was a local file browser. From here it is a file manager with two interchangeable backends, where your Drive is browsed with the same UI, search, viewer and operations as your disk.

**Added — Google Drive integration (18 new classes)**
- `GDriveAuth` — OAuth 2.0 with PKCE, written by hand: `codeChallenge()`, `beginAuth()`, `completeAuth()`, `cleanupPending()`, `PendingAuth` state tracking.
- `GDriveClient` + `DriveItem` — the Drive API wrapper.
- `GDriveBrowseHandler`, `GDriveSearchHandler`, `GDriveSuggestHandler`, `GDriveViewerHandler`, `GDriveDownloadHandler`, `GDriveOpsHandler` — full parity with the local handlers: browse, search, suggest, view, download, and file operations (`copyItem()`, `createFolder()`).
- `GDriveExportHandler` with `exportMimeFor()` / `bestMimeForName()` — converts Google-native formats (Docs, Sheets) into downloadable files.
- `GDriveOnboardingHandler`, `GDriveAccessRequestHandler`, `GDriveGateFilter`, `DriveOnboarding` — the connect-your-account flow and the gate that keeps Drive routes closed until it's done.
- `GDriveAccountsHandler`, `GoogleAuthHandler`, `Account`, `AccountInfo` — **multiple Google accounts**, with `findByEmail()`, `displayName()`, `disconnect()`, `clearAccount()` and `expiryBadge()` for token expiry.
- `DriveIcon`, `embeddablePreviewUrl()`, `gdriveStyles()`, `gdriveViewerStyles()`, `friendlyError()`.

**Added — local features**
- `ActivityLog` with `Event`, `DayStat`, `buildDayStats()`, `barHeightPx()`, `actionLabel()` — a full activity history with a per-day bar chart, replacing v2's simple counters.
- `SessionsHandler` — session management and listing.
- `UserDataStore` — per-user persisted state.
- `SaveTextHandler` — the text viewer becomes a text **editor**; files can be edited and saved in the browser.
- `CodeLanguageUtil` — language detection for syntax-aware code viewing.
- `AbsPathHandler` — the `/`-triggered absolute path bar from the notes.
- `RevealHandler` — reveal a file in the OS file manager.
- `SubfoldersHandler`, `DashboardEventsHandler`, `TrashBrowseHandler`, `TrashFileHandler`, `dashboardRefreshScript()`.
- `detectLanAddress()` — the dashboard is reachable from other devices on the network, not just `localhost`.

**Added — cross-platform support**
- `build-jar.sh`, `install-autostart.sh`, `uninstall-autostart.sh`, `start.sh`, `stop.sh`, plus `start.bat`.
- `AutostartManager` splits into `enableWindows()` / `disableWindows()` / `enableLinux()` / `disableLinux()`, with `findJavaLinux()`. **Linux support lands here** — until now it was Windows-only.

**Removed**
- `FoldersHandler`, folded into the browse handlers.
- All the `Name(1).java` duplicates from v2.

**Changed**
- `ShellScript` **+1,524/−37** — by far the biggest single-file change in the project; the client-side JavaScript roughly triples to drive the Drive UI, the editor and the activity chart.
- `PageScripts` +526/−70, `HomeHandler` +310, `Styles` +301, `SettingsHandler` +272, `ViewerHandler` +250, `AutostartManager` +209/−37, `TrashManager` +111/−19.

---

## Summary of Feature Timeline

| Capability | Introduced | Notes |
|---|---|---|
| Dependency-free HTTP server | v1 | JDK `HttpServer` only |
| Directory browsing, tabs, thumbnails | v1 | |
| Recursive search + live suggestions | v1 | |
| Markdown / text / PDF viewing | v1 | `MarkdownLite` written from scratch |
| Recycle bin with restore | v1 | |
| ZIP download (file + selection) | v1 | |
| Upload with hand-rolled multipart parsing | v1 | |
| Settings page, configurable root | v2 | |
| Windows autostart | v2 | Linux added in final |
| Frequently-viewed ranking | v2 | replaced "recently viewed" |
| Content-based text sniffing | v2 | |
| Google Drive as a second backend | final | 18 classes |
| OAuth 2.0 + PKCE, hand-written | final | |
| Multiple Google accounts | final | |
| Google-native format export | final | |
| In-browser text editing + save | final | |
| Activity log with daily chart | final | replaced simple counters |
| Syntax-aware code viewing | final | |
| LAN access from other devices | final | |
| Linux support | final | |

*Log generated from a diff of all `.java` handler and utility classes plus the `.bat`/`.sh` scripts across the three snapshots in the archive, cross-referenced against the feature requests recorded in `prompts (File dashboard).docx`.*
