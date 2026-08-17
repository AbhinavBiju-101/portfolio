// --- Preview modal ------------------------------------------------------
// Opens a large popup for the "Preview" button. The actual runtime (Pyodide /
// java-console / CheerpJ) is only booted the first time the modal opens.

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("preview-btn");
  const modal = document.getElementById("preview-modal");
  if (!btn || !modal) return; // this project has no runtime configured

  const closeBtn = document.getElementById("preview-close");
  const container = document.getElementById("preview-container");
  const runtime = btn.dataset.runtime;
  const src = btn.dataset.previewSrc;
  const mainClass = btn.dataset.mainClass;
  const slug = btn.dataset.slug;

  let booted = false;
  let activeSession = null; // { sessionId, eventSource } for java-console cleanup
  let activeNetworkSource = null; // current EventSource for the network-sim tab UI

  function openModal() {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (!booted) {
      booted = true;
      switch (runtime) {
        case "pyodide":
          loadPyodidePreview(src, container);
          break;
        case "java-console":
          loadJavaConsolePreview(slug, container, (session) => { activeSession = session; }, "Java");
          break;
        case "python-console":
          loadJavaConsolePreview(slug, container, (session) => { activeSession = session; }, "Python");
          break;
        case "cheerpj":
          loadCheerpJPreview(src, container, mainClass);
          break;
        case "network-sim":
          loadNetworkSimPreview(slug, container, (source) => { activeNetworkSource = source; });
          break;
        default:
          showComingSoon(container, runtime);
      }
    }
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    if (activeSession) {
      stopJavaConsoleSession(activeSession);
      activeSession = null;
      booted = false; // allow a fresh session next time it's opened
      container.innerHTML = "";
    }
    if (activeNetworkSource) {
      // Nothing to tear down server-side — it's a shared demo other visitors
      // may still be watching. Just stop listening on our end.
      activeNetworkSource.close();
      activeNetworkSource = null;
      booted = false;
      container.innerHTML = "";
    }
  }

  btn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  modal.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });
  window.addEventListener("beforeunload", () => {
    if (activeSession) stopJavaConsoleSession(activeSession, true);
  });
});

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- ANSI -> HTML for the console previews --------------------------------
// The Java/Python console previews (mining-simulator, exponential-spacebar,
// etc.) are real processes streaming real stdout, which includes genuine
// ANSI color escape codes (confirmed: mining-simulator.jar emits standard
// SGR codes like \x1b[31m, \x1b[40m) and, for programs that clear/redraw
// their screen, real cursor-move and clear-screen codes too.
//
// This is a small terminal-grid emulator, not a naive append-only pass: it
// replays the *entire* accumulated buffer from scratch on every render
// (both call sites already keep the raw text around and re-render it whole,
// so this fits without changing their structure) into a 2D grid of styled
// cells, applying SGR color/style codes plus \r, \n, backspace, tab, and
// the cursor-move/clear-screen/clear-line CSI codes as it goes. That's what
// makes a program's own `clear()` or a `\r`-based progress bar actually
// look like a clear/overwrite instead of either scrolling garbage or
// (the previous behavior) being silently dropped.
const ANSI_STANDARD = ["#4d4d4d", "#e05561", "#3fb765", "#d7ae4e", "#5591e0", "#b56ce0", "#3fb0b0", "#d6d6d6"];
const ANSI_BRIGHT = ["#7a7a7a", "#ff7b86", "#6fdb8f", "#ffd873", "#82b1ff", "#d99bff", "#6fdede", "#ffffff"];

function ansi256ToColor(n) {
  if (n < 8) return ANSI_STANDARD[n];
  if (n < 16) return ANSI_BRIGHT[n - 8];
  if (n < 232) {
    const m = n - 16;
    const level = (v) => (v === 0 ? 0 : v * 40 + 55);
    return `rgb(${level(Math.floor(m / 36))},${level(Math.floor((m % 36) / 6))},${level(m % 6)})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray},${gray},${gray})`;
}

function ansiSpanStyle(state) {
  let fg = state.fg;
  let bg = state.bg;
  if (state.reverse) {
    const t = fg;
    fg = bg || "#0c0d10";
    bg = t || "#e7e8ea";
  }
  const styles = [];
  if (fg) styles.push("color:" + fg);
  if (bg) styles.push("background:" + bg);
  if (state.bold) styles.push("font-weight:700");
  if (state.dim) styles.push("opacity:.65");
  if (state.italic) styles.push("font-style:italic");
  if (state.underline) styles.push("text-decoration:underline");
  if (state.hidden) styles.push("visibility:hidden");
  return styles.join(";");
}

function freshAnsiState() {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, reverse: false, hidden: false };
}

// eslint-disable-next-line no-control-regex
function ansiToHtml(str) {
  const TAB_STOP = 8;
  let lines = [[]]; // lines[row] = array of {ch, style}
  let row = 0;
  let col = 0;
  let state = freshAnsiState();

  function ensureRow(r) {
    while (lines.length <= r) lines.push([]);
  }
  function putChar(ch) {
    ensureRow(row);
    const line = lines[row];
    while (line.length < col) line.push({ ch: " ", style: "" });
    line[col] = { ch, style: ansiSpanStyle(state) };
    col++;
  }

  function applySGR(codes) {
    if (!codes.length) codes = [0];
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) state = freshAnsiState();
      else if (c === 1) state.bold = true;
      else if (c === 2) state.dim = true;
      else if (c === 3) state.italic = true;
      else if (c === 4) state.underline = true;
      else if (c === 7) state.reverse = true;
      else if (c === 8) state.hidden = true;
      else if (c === 22) { state.bold = false; state.dim = false; }
      else if (c === 23) state.italic = false;
      else if (c === 24) state.underline = false;
      else if (c === 27) state.reverse = false;
      else if (c === 28) state.hidden = false;
      else if (c >= 30 && c <= 37) state.fg = ANSI_STANDARD[c - 30];
      else if (c === 38 && codes[i + 1] === 5) { state.fg = ansi256ToColor(codes[i + 2]); i += 2; }
      else if (c === 38 && codes[i + 1] === 2) { state.fg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4; }
      else if (c === 39) state.fg = null;
      else if (c >= 40 && c <= 47) state.bg = ANSI_STANDARD[c - 40];
      else if (c === 48 && codes[i + 1] === 5) { state.bg = ansi256ToColor(codes[i + 2]); i += 2; }
      else if (c === 48 && codes[i + 1] === 2) { state.bg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4; }
      else if (c === 49) state.bg = null;
      else if (c >= 90 && c <= 97) state.fg = ANSI_BRIGHT[c - 90];
      else if (c >= 100 && c <= 107) state.bg = ANSI_BRIGHT[c - 100];
    }
  }

  // Cursor-move / clear-screen / clear-line CSI codes — the part that used
  // to be dropped outright. Implemented against a plain array-of-rows grid
  // rather than a fixed-width buffer, since these previews don't know (or
  // need) a real terminal column count.
  function handleCSI(codes, final) {
    if (final === "m") { applySGR(codes); return; }
    if (final === "J") {
      // Erase in display: 0 = cursor->end, 1 = start->cursor, 2/3 = everything
      const n = codes[0] || 0;
      if (n === 2 || n === 3) {
        lines = [[]];
        row = 0;
        col = 0;
      } else if (n === 0) {
        ensureRow(row);
        lines[row] = lines[row].slice(0, col);
        lines = lines.slice(0, row + 1);
      } else if (n === 1) {
        for (let r = 0; r < row; r++) lines[r] = [];
        ensureRow(row);
        for (let c = 0; c <= col; c++) lines[row][c] = { ch: " ", style: "" };
      }
      return;
    }
    if (final === "K") {
      // Erase in line: 0 = cursor->end, 1 = start->cursor, 2 = whole line
      const n = codes[0] || 0;
      ensureRow(row);
      if (n === 0) lines[row] = lines[row].slice(0, col);
      else if (n === 1) { for (let c = 0; c < col; c++) lines[row][c] = { ch: " ", style: "" }; }
      else lines[row] = [];
      return;
    }
    if (final === "H" || final === "f") {
      row = Math.max(0, (codes[0] || 1) - 1);
      col = Math.max(0, (codes[1] || 1) - 1);
      ensureRow(row);
      return;
    }
    if (final === "A") { row = Math.max(0, row - (codes[0] || 1)); return; }
    if (final === "B") { row += codes[0] || 1; ensureRow(row); return; }
    if (final === "C") { col += codes[0] || 1; return; }
    if (final === "D") { col = Math.max(0, col - (codes[0] || 1)); return; }
    // Other finals (save/restore cursor, mode toggles, etc.) intentionally
    // ignored — not meaningful for this rendering, and safe to no-op.
  }

  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === "\x1b" && str[i + 1] === "[") {
      let j = i + 2;
      while (j < str.length && !/[A-Za-z]/.test(str[j])) j++;
      if (j < str.length) {
        const params = str.slice(i + 2, j);
        const final = str[j];
        const codes = params.length ? params.split(";").filter((s) => s !== "").map(Number) : [];
        handleCSI(codes, final);
        i = j + 1;
        continue;
      }
      break; // unterminated escape at the tail of a still-streaming buffer
    }
    if (ch === "\n") { row++; col = 0; ensureRow(row); i++; continue; }
    if (ch === "\r") { col = 0; i++; continue; }
    if (ch === "\b") { if (col > 0) col--; i++; continue; }
    if (ch === "\x07") { i++; continue; } // bell — nothing to render
    if (ch === "\t") { col = Math.ceil((col + 1) / TAB_STOP) * TAB_STOP; i++; continue; }
    putChar(ch);
    i++;
  }

  // Render the grid: consecutive same-style cells on a row collapse into a
  // single <span>; rows join on real newlines since the container is a
  // white-space:pre <pre> element.
  const rowsHtml = lines.map((line) => {
    if (!line.length) return "";
    let out = "";
    let runStyle = null;
    let run = "";
    const flushRun = () => {
      if (!run) return;
      out += runStyle ? `<span style="${runStyle}">${escapeHtml(run)}</span>` : escapeHtml(run);
      run = "";
    };
    for (const cell of line) {
      const cellStyle = cell.style || null;
      if (cellStyle !== runStyle) {
        flushRun();
        runStyle = cellStyle;
      }
      run += cell.ch;
    }
    flushRun();
    return out;
  });
  return rowsHtml.join("\n");
}

// --- Python projects, via Pyodide (fully client-side) --------------------
async function loadPyodidePreview(src, container) {
  container.innerHTML = '<p class="preview-status">Loading Python runtime…</p>';

  try {
    if (!window.loadPyodide) {
      await loadScript("https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js");
    }
    const pyodide = await loadPyodide();
    const code = await (await fetch(src)).text();

    container.innerHTML = `
      <div class="preview-editor">
        <textarea id="preview-code" spellcheck="false">${escapeHtml(code)}</textarea>
        <button id="preview-run" class="btn btn-primary">Run</button>
      </div>
      <pre id="preview-output" class="preview-output" aria-live="polite"></pre>
    `;

    const runBtn = document.getElementById("preview-run");
    const codeBox = document.getElementById("preview-code");
    const output = document.getElementById("preview-output");

    pyodide.setStdout({ batched: (s) => { output.textContent += s + "\n"; } });
    pyodide.setStderr({ batched: (s) => { output.textContent += s + "\n"; } });

    runBtn.addEventListener("click", async () => {
      output.textContent = "";
      try {
        await pyodide.runPythonAsync(codeBox.value);
      } catch (err) {
        output.textContent += String(err);
      }
    });
  } catch (err) {
    container.innerHTML = `<p class="preview-status preview-error">Couldn't load the Python preview: ${escapeHtml(String(err))}</p>`;
  }
}

// --- Console apps (Java or Python), executed server-side, streamed live --
// The server spawns a real `java -jar` (or `python3 -u`) process per session
// and streams its stdout over Server-Sent Events; keystrokes/lines go back
// over a small POST endpoint. See the /preview/<slug>/start,
// /preview/stream/<id>, and /preview/input/<id> routes in app.py. Shared by
// both java-console and python-console — only the process command differs,
// server-side.

// Shared by loadJavaConsolePreview and loadNetworkSimPreview below: the
// A-/A+ font-size toolbar (see the "Text zoom controls" module further
// down) plus the actual scrolling console box and its loading hint.
function consoleOutputMarkup() {
  return `
    <div class="text-block-toolbar">
      <button type="button" class="text-zoom-btn" data-zoom="out" aria-label="Decrease text size">A&minus;</button>
      <span class="text-zoom-readout" aria-live="polite"></span>
      <button type="button" class="text-zoom-btn" data-zoom="in" aria-label="Increase text size">A+</button>
    </div>
    <div class="console-output-wrap">
      <pre id="console-output" class="console-output text-zoom-target" aria-live="polite"></pre>
      ${previewLoadingHintMarkup()}
    </div>
  `;
}

async function loadJavaConsolePreview(slug, container, onSession, langLabel = "Java") {
  container.innerHTML = `<p class="preview-status">Starting the ${langLabel} process…</p>`;

  try {
    const startRes = await fetch(`/preview/${slug}/start`, { method: "POST" });
    if (!startRes.ok) {
      const body = await startRes.json().catch(() => ({}));
      throw new Error(body.error || `Server returned ${startRes.status}`);
    }
    const { session_id } = await startRes.json();

    container.innerHTML = `
      ${consoleOutputMarkup()}
      <form id="console-form" class="console-input-row">
        <input id="console-input" type="text" autocomplete="off" placeholder="Type input and press Enter…">
        <button class="btn btn-primary" type="submit">Send</button>
      </form>
    `;
    const output = document.getElementById("console-output");
    const outputWrap = output.parentElement; // .console-output-wrap — the actual scrolling element
    const form = document.getElementById("console-form");
    const input = document.getElementById("console-input");

    // Buffer output in a plain string and only touch the DOM once per
    // animation frame, even if several SSE messages arrive in that window.
    // Also cap the buffer so a long session doesn't slowly grow an
    // ever-larger text node (which is what made things feel sluggish
    // after a lot of output had accumulated).
    const MAX_OUTPUT_CHARS = 20000;
    let buffer = "";
    let renderScheduled = false;
    let hintDismissed = false;

    function appendOutput(text) {
      if (!hintDismissed) {
        hintDismissed = true;
        hidePreviewLoadingHint(container);
      }
      buffer += text;
      if (buffer.length > MAX_OUTPUT_CHARS) {
        buffer = buffer.slice(buffer.length - MAX_OUTPUT_CHARS);
      }
      if (!renderScheduled) {
        renderScheduled = true;
        requestAnimationFrame(() => {
          output.innerHTML = ansiToHtml(buffer);
          outputWrap.scrollTop = outputWrap.scrollHeight;
          renderScheduled = false;
        });
      }
    }

    const source = new EventSource(`/preview/stream/${session_id}`);
    source.onmessage = (event) => {
      appendOutput(JSON.parse(event.data));
    };
    source.addEventListener("end", () => {
      appendOutput("\n\n[process ended]\n");
      source.close();
      input.disabled = true;
      form.querySelector("button").disabled = true;
      onSession(null); // this session is over; don't try to stop it again on close
      showRestartPrompt(slug, container, onSession);
    });
    source.onerror = () => {
      // EventSource auto-retries; if the session is genuinely gone the next
      // fetch to /preview/input will fail and surface an error there instead.
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const line = input.value;
      input.value = "";
      appendOutput(`\n> ${line}\n`);
      try {
        await fetch(`/preview/input/${session_id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: line }),
        });
      } catch (err) {
        appendOutput(`[couldn't send input: ${err}]\n`);
      }
    });

    input.focus();
    onSession({ sessionId: session_id, eventSource: source });
  } catch (err) {
    container.innerHTML = `<p class="preview-status preview-error">Couldn't start the ${langLabel} preview: ${escapeHtml(String(err))}</p>`;
    showRestartPrompt(slug, container, onSession, "Try again");
  }
}

function showRestartPrompt(slug, container, onSession, label) {
  const wrap = document.createElement("div");
  wrap.className = "preview-restart";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.type = "button";
  btn.textContent = label || "Restart";
  btn.addEventListener("click", () => {
    loadJavaConsolePreview(slug, container, onSession);
  });
  wrap.appendChild(btn);
  container.appendChild(wrap);
}

function stopJavaConsoleSession(session, useBeacon) {
  if (session.eventSource) session.eventSource.close();
  const url = `/preview/stop/${session.sessionId}`;
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(url);
  } else {
    fetch(url, { method: "POST" }).catch(() => {});
  }
}

// --- Java GUI (Swing/AWT) projects, via CheerpJ ---------------------------
// Best-effort scaffold for future GUI-based Java projects. Untested against
// a real CheerpJ session (this environment has no internet access to verify
// against the current CheerpJ docs) — check https://cheerpj.com/docs before
// relying on it.

// CheerpJ 4.3 supports Java 8, 11 or 17 runtimes, and *defaults to 8* if
// cheerpjInit() isn't told otherwise. build_preview.py compiles every
// preview jar with `--release 17` (see its --release help text) — the
// newest bytecode level CheerpJ 4.3 can load — so the runtime needs to be
// told to match, or it'll try to run Java-17-targeted class files under a
// Java 8 runtime.
const CHEERPJ_VERSION = 17;

// Shared "this is loading, not broken" hint — used by both the CheerpJ
// display and the console previews below, since both can take a real
// moment (Greed Island in particular: ~10s to boot, and laggy once it's
// up) with nothing visible in the meantime otherwise. The parent it's
// inserted into must be position:relative (.cheerpj-wrap / .console-output-wrap).
const PREVIEW_LOADING_HINT_TEXT = "Preview might take a minute to load — hang tight, it isn't broken.";
function previewLoadingHintMarkup() {
  return `<p class="preview-status preview-loading-hint">${escapeHtml(PREVIEW_LOADING_HINT_TEXT)}</p>`;
}
function hidePreviewLoadingHint(container) {
  const hint = container.querySelector(".preview-loading-hint");
  if (hint) hint.classList.add("is-hidden");
}

// Markup shared by both CheerpJ display modes: the actual display div CheerpJ
// paints into, plus the loading hint layered on top of it. CheerpJ has no
// documented "first frame painted" callback, so the hint is dismissed by
// watching the display div for its first child element instead (see
// watchCheerpjDisplay below) rather than on any promise resolving.
function cheerpjDisplayMarkup() {
  return `
    <div class="cheerpj-wrap">
      <div id="cheerpj-display" class="cheerpj-display"></div>
      ${previewLoadingHintMarkup()}
    </div>
  `;
}

function watchCheerpjDisplay(container) {
  const display = container.querySelector("#cheerpj-display");
  if (!display) return display;
  const observer = new MutationObserver(() => {
    if (display.childElementCount > 0) {
      hidePreviewLoadingHint(container);
      observer.disconnect();
    }
  });
  observer.observe(display, { childList: true });
  return display;
}

async function loadCheerpJPreview(src, container, mainClass) {
  container.innerHTML = '<p class="preview-status">Loading Java runtime…</p>';

  try {
    if (!window.cheerpjInit) {
      await loadScript("https://cjrtnc.leaningtech.com/4.3/loader.js");
    }
    await cheerpjInit({ version: CHEERPJ_VERSION });

    container.innerHTML = cheerpjDisplayMarkup();
    const display = watchCheerpjDisplay(container);

    cheerpjCreateDisplay(-1, -1, display);
    // classPath must be the full "/app/..." path to the jar, matching the
    // web server's own URL path (the "/app/" prefix is CheerpJ's virtual
    // filesystem mount point for this origin's document root).
    await cheerpjRunMain(mainClass || "Main", "/app" + src);
  } catch (err) {
    container.innerHTML = `<p class="preview-status preview-error">Couldn't load the Java preview: ${escapeHtml(String(err))}</p>`;
  }
}

// --- Chatroom's real Swing GUI client, via CheerpJ + Tailscale -----------
// Unlike loadCheerpJPreview() above (a plain single-player Swing app with no
// networking), this runs the actual ChatClient.java unmodified — real
// Socket() calls and all — against the SAME shared server the simulated
// text clients talk to. Browsers can't open raw TCP sockets at all, so
// CheerpJ bridges java.net.Socket over Tailscale's WebSocket-based relay;
// see /preview/chatroom-network/gui-config in app.py for how the
// short-lived, ACL-restricted auth key it uses gets minted.
// Reference: https://cheerpj.com/docs/guides/Networking
async function loadCheerpJChatPreview(container, onBack) {
  container.innerHTML = '<p class="preview-status">Checking GUI preview availability…</p>';

  try {
    const configRes = await fetch("/preview/chatroom-network/gui-config");
    if (!configRes.ok) {
      const body = await configRes.json().catch(() => ({}));
      container.innerHTML = `
        <p class="preview-status">${escapeHtml(body.error || "GUI preview isn't available on this deployment.")}</p>
        <button id="gui-back-btn" type="button" class="btn btn-secondary">Back to the text preview</button>
      `;
      document.getElementById("gui-back-btn").addEventListener("click", onBack);
      return;
    }
    const { authKey, serverHost } = await configRes.json();

    container.innerHTML = '<p class="preview-status">Loading Java runtime…</p>';
    if (!window.cheerpjInit) {
      await loadScript("https://cjrtnc.leaningtech.com/4.3/loader.js");
    }
    // Free/non-commercial CheerpJ shows a small runtime watermark unless a
    // licenseKey is configured — expected and fine for a portfolio demo.
    // version: see CHEERPJ_VERSION's comment above loadCheerpJPreview — same
    // Java-8-by-default gotcha applies here, and it's worth ruling out first
    // if the real socket connection below misbehaves, since a runtime/
    // bytecode mismatch can surface as class-loading or networking-shim
    // weirdness rather than a clean error.
    await cheerpjInit({ tailscaleAuthKey: authKey, version: CHEERPJ_VERSION });

    container.innerHTML = cheerpjDisplayMarkup();
    const display = watchCheerpjDisplay(container);
    container.insertAdjacentHTML("beforeend", `
      <p class="preview-hint">
        Real Swing client, real socket, connected to the same shared server.
        <button id="gui-back-btn" type="button" class="btn btn-secondary btn-small">Back to the text preview</button>
      </p>
    `);
    document.getElementById("gui-back-btn").addEventListener("click", () => {
      // CheerpJ doesn't expose a documented way to tear down a running
      // session cleanly — going "back" here swaps the DOM but the CheerpJ
      // runtime and its Tailscale connection stay alive in the background
      // until the whole modal/page is closed. Known rough edge, not a
      // silent failure: worth revisiting if that turns out to matter.
      onBack();
    });
    cheerpjCreateDisplay(-1, -1, display);
    await cheerpjRunMain("ChatClient", "/app/static/previews/chatroom/chatroom-client-gui.jar", serverHost);
  } catch (err) {
    container.innerHTML = `
      <p class="preview-status preview-error">Couldn't load the real GUI client: ${escapeHtml(String(err))}</p>
      <button id="gui-back-btn" type="button" class="btn btn-secondary">Back to the text preview</button>
    `;
    document.getElementById("gui-back-btn").addEventListener("click", onBack);
  }
}

// --- Networked multi-client preview (Chatroom) ---------------------------
// Connects to a shared, always-on demo (real ChatServer + 5 simulated
// clients, server-side). Lets you switch which client's perspective you're
// viewing/typing as, plus a read-only Server tab for the server's own log.
async function loadNetworkSimPreview(slug, container, onSource) {
  container.innerHTML = '<p class="preview-status">Connecting to the shared demo…</p>';

  try {
    const startRes = await fetch(`/preview/${slug}-network/start`, { method: "POST" });
    if (!startRes.ok) {
      const body = await startRes.json().catch(() => ({}));
      throw new Error(body.error || `Server returned ${startRes.status}`);
    }
    const { clients } = await startRes.json();
    const channels = [{ id: "server", label: "Server", readOnly: true }, ...clients];

    container.innerHTML = `
      <div class="network-tabs" role="tablist"></div>
      ${consoleOutputMarkup()}
      <form id="console-form" class="console-input-row">
        <input id="console-input" type="text" autocomplete="off" placeholder="Type input and press Enter…">
        <button class="btn btn-primary" type="submit">Send</button>
      </form>
      <p class="preview-hint">
        Shared demo — everyone previewing this project right now sees the same room.
        <button id="try-real-gui-btn" type="button" class="btn btn-secondary btn-small">Try the real GUI client</button>
      </p>
    `;
    const tabsEl = container.querySelector(".network-tabs");
    const guiBtn = document.getElementById("try-real-gui-btn");
    guiBtn.addEventListener("click", () => {
      if (currentSource) currentSource.close();
      onSource(null);
      loadCheerpJChatPreview(container, () => loadNetworkSimPreview(slug, container, onSource));
    });
    const output = document.getElementById("console-output");
    const outputWrap = output.parentElement; // .console-output-wrap — the actual scrolling element
    const form = document.getElementById("console-form");
    const input = document.getElementById("console-input");

    channels.forEach((ch) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "network-tab";
      tab.textContent = ch.label;
      tab.dataset.channel = ch.id;
      tabsEl.appendChild(tab);
    });

    const MAX_OUTPUT_CHARS = 20000;
    const buffers = {}; // channel id -> accumulated text, so switching tabs keeps history
    let currentSource = null;
    let activeChannel = null;
    let renderScheduled = false;
    let hintDismissed = false;

    function scheduleRender() {
      if (renderScheduled) return;
      renderScheduled = true;
      requestAnimationFrame(() => {
        output.innerHTML = ansiToHtml(buffers[activeChannel] || "");
        outputWrap.scrollTop = outputWrap.scrollHeight;
        renderScheduled = false;
      });
    }

    function appendTo(channelId, text) {
      if (!hintDismissed) {
        hintDismissed = true;
        hidePreviewLoadingHint(container);
      }
      const existing = buffers[channelId] || "";
      let next = existing + text;
      if (next.length > MAX_OUTPUT_CHARS) next = next.slice(next.length - MAX_OUTPUT_CHARS);
      buffers[channelId] = next;
      if (channelId === activeChannel) scheduleRender();
    }

    function switchTo(channelId, readOnly) {
      if (currentSource) currentSource.close();
      activeChannel = channelId;
      tabsEl.querySelectorAll(".network-tab").forEach((t) => {
        t.classList.toggle("is-active", t.dataset.channel === channelId);
      });
      form.style.display = readOnly ? "none" : "";
      scheduleRender();

      currentSource = new EventSource(`/preview/${slug}-network/stream/${channelId}`);
      currentSource.onmessage = (event) => appendTo(channelId, JSON.parse(event.data));
      currentSource.addEventListener("end", () => {
        appendTo(channelId, "\n\n[disconnected]\n");
        // The server-side hub for this channel has ended for good (its
        // client's socket closed) and will keep re-sending its *entire*
        // backlog + another "end" to every new subscriber from here on
        // (see BroadcastHub.subscribe() in app.py) — so if we leave this
        // EventSource open, the browser's built-in auto-reconnect just
        // replays the whole join history over and over, which is exactly
        // the repeating "[disconnected]" loop this used to produce.
        // Closing it here stops that; explicitly .close() rather than
        // relying on onerror, since a clean server-sent "end" isn't a
        // connection error EventSource would otherwise treat as retryable.
        currentSource.close();
      });
      onSource(currentSource);
    }

    tabsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".network-tab");
      if (!btn) return;
      const ch = channels.find((c) => c.id === btn.dataset.channel);
      switchTo(ch.id, !!ch.readOnly);
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!activeChannel || activeChannel === "server") return;
      const line = input.value;
      input.value = "";
      appendTo(activeChannel, `\n> ${line}\n`);
      try {
        await fetch(`/preview/${slug}-network/input/${activeChannel}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: line }),
        });
      } catch (err) {
        appendTo(activeChannel, `[couldn't send input: ${err}]\n`);
      }
    });

    // Default to the first real client, not the read-only server log.
    switchTo(clients[0] ? clients[0].id : "server", !clients[0]);
    input.focus();
  } catch (err) {
    container.innerHTML = `<p class="preview-status preview-error">Couldn't connect to the shared demo: ${escapeHtml(String(err))}</p>`;
  }
}

// --- Anything without a runtime yet (e.g. Gradle builds) -----------------
function showComingSoon(container, runtime) {
  container.innerHTML = `<p class="preview-status">In-browser preview for "${escapeHtml(runtime || "this project type")}" is coming soon.</p>`;
}

// --- Screenshot gallery ------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const mainImg = document.getElementById("gallery-main-img");
  const mainBtn = document.getElementById("gallery-main-btn");
  const thumbs = Array.from(document.querySelectorAll(".gallery-thumb"));
  if (!mainImg || !mainBtn) return;

  // Full list of { src, alt } for every screenshot, in order, so the
  // lightbox can step through them even for a project that only has one
  // image (no thumbs) or several.
  const images = thumbs.length
    ? thumbs.map((t) => ({ src: t.dataset.full, alt: t.querySelector("img").alt }))
    : [{ src: mainImg.src, alt: mainImg.alt }];

  let activeIndex = 0;

  function setActive(index) {
    activeIndex = index;
    mainImg.src = images[index].src;
    mainImg.alt = images[index].alt;
    thumbs.forEach((t) => t.classList.toggle("is-active", Number(t.dataset.index) === index));
  }

  thumbs.forEach((thumb) => {
    thumb.addEventListener("click", () => setActive(Number(thumb.dataset.index)));
  });

  // --- Lightbox: bigger popup, arrow-key/arrow-button navigation ---------
  const lightbox = document.getElementById("lightbox");
  if (!lightbox) return;

  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxCount = document.getElementById("lightbox-count");
  const closeBtn = document.getElementById("lightbox-close");
  const prevBtn = document.getElementById("lightbox-prev");
  const nextBtn = document.getElementById("lightbox-next");

  function showInLightbox(index) {
    activeIndex = (index + images.length) % images.length;
    lightboxImg.src = images[activeIndex].src;
    lightboxImg.alt = images[activeIndex].alt;
    if (lightboxCount) lightboxCount.textContent = `${activeIndex + 1} / ${images.length}`;
    setActive(activeIndex);
  }

  function openLightbox(index) {
    showInLightbox(index);
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.hidden = true;
    document.body.style.overflow = "";
  }

  mainBtn.addEventListener("click", () => openLightbox(activeIndex));
  thumbs.forEach((thumb) => {
    thumb.addEventListener("dblclick", () => openLightbox(Number(thumb.dataset.index)));
  });
  closeBtn.addEventListener("click", closeLightbox);
  lightbox.querySelectorAll("[data-close-lightbox]").forEach((el) => el.addEventListener("click", closeLightbox));
  if (prevBtn) prevBtn.addEventListener("click", () => showInLightbox(activeIndex - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => showInLightbox(activeIndex + 1));

  document.addEventListener("keydown", (e) => {
    if (lightbox.hidden) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") showInLightbox(activeIndex - 1);
    else if (e.key === "ArrowRight") showInLightbox(activeIndex + 1);
  });

  // Basic swipe support so the lightbox is usable on mobile too.
  let touchStartX = null;
  lightbox.addEventListener("touchstart", (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
  lightbox.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) showInLightbox(activeIndex + (dx < 0 ? 1 : -1));
    touchStartX = null;
  }, { passive: true });
});

// --- Generic zoomable images (certifications & achievements) -----------
document.addEventListener("DOMContentLoaded", () => {
  const triggers = Array.from(document.querySelectorAll(".zoomable-trigger"));
  const lightbox = document.getElementById("lightbox");
  if (!triggers.length || !lightbox || document.getElementById("gallery-main-img")) return;

  const items = triggers.map((el) => ({ src: el.dataset.full, alt: el.querySelector("img").alt }));
  const img = document.getElementById("lightbox-img");
  const countEl = document.getElementById("lightbox-count");
  const closeBtn = document.getElementById("lightbox-close");
  const prevBtn = document.getElementById("lightbox-prev");
  const nextBtn = document.getElementById("lightbox-next");
  let activeIndex = 0;

  function show(index) {
    activeIndex = (index + items.length) % items.length;
    img.src = items[activeIndex].src;
    img.alt = items[activeIndex].alt;
    if (countEl) countEl.textContent = `${activeIndex + 1} / ${items.length}`;
  }
  function open(index) { show(index); lightbox.hidden = false; document.body.style.overflow = "hidden"; }
  function close() { lightbox.hidden = true; document.body.style.overflow = ""; }

  triggers.forEach((el, i) => el.addEventListener("click", () => open(i)));
  closeBtn.addEventListener("click", close);
  lightbox.querySelectorAll("[data-close-lightbox]").forEach((el) => el.addEventListener("click", close));
  if (prevBtn) prevBtn.addEventListener("click", () => show(activeIndex - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => show(activeIndex + 1));

  document.addEventListener("keydown", (e) => {
    if (lightbox.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") show(activeIndex - 1);
    else if (e.key === "ArrowRight") show(activeIndex + 1);
  });

  let touchStartX = null;
  lightbox.addEventListener("touchstart", (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
  lightbox.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) show(activeIndex + (dx < 0 ? 1 : -1));
    touchStartX = null;
  }, { passive: true });
});

// --- Generic search-filter for lists of cards/rows -----------------------
// Works for both the Projects grid and the Skills lists: any element with
// data-search-name gets shown/hidden based on the query, entire groups
// (data-search-group) hide themselves if nothing inside matches, and an
// empty-state message is toggled when there are zero matches overall.
function initSearchFilter({ inputId, clearId, emptyId, emptyTermId }) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const clearBtn = document.getElementById(clearId);
  const emptyEl = document.getElementById(emptyId);
  const emptyTermEl = emptyTermId ? document.getElementById(emptyTermId) : null;
  const items = Array.from(document.querySelectorAll("[data-search-name]"));
  const groups = Array.from(document.querySelectorAll("[data-search-group]"));

  function applyFilter() {
    const query = input.value.trim().toLowerCase();
    if (clearBtn) clearBtn.hidden = query.length === 0;

    let totalVisible = 0;
    items.forEach((el) => {
      const match = !query || el.dataset.searchName.includes(query);
      el.hidden = !match;
      if (match) totalVisible += 1;
    });

    // Hide a whole group (e.g. the "Languages" section) if every item in
    // it got filtered out, so we don't leave a dangling empty heading.
    groups.forEach((group) => {
      const groupItems = group.querySelectorAll("[data-search-name]");
      if (!groupItems.length) return; // group has no searchable items (e.g. the "no X yet" fallback)
      const anyVisible = Array.from(groupItems).some((el) => !el.hidden);
      group.hidden = !anyVisible;
    });

    if (emptyEl) {
      const show = query.length > 0 && totalVisible === 0;
      emptyEl.hidden = !show;
      if (show && emptyTermEl) emptyTermEl.textContent = input.value.trim();
    }
  }

  input.addEventListener("input", applyFilter);
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      applyFilter();
      input.focus();
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initSearchFilter({
    inputId: "skills-search",
    clearId: "skills-search-clear",
    emptyId: "skills-search-empty",
    emptyTermId: "skills-search-empty-term",
  });
  initSearchFilter({
    inputId: "projects-search",
    clearId: "projects-search-clear",
    emptyId: "projects-search-empty",
    emptyTermId: "projects-search-empty-term",
  });
});

// --- Text zoom controls: font-size A-/A+ ---------------------------------
// Used by both the static in-game text dumps (.scrollable-text, present at
// page load) and the console previews (.console-output, built well after
// DOMContentLoaded — a project's preview modal only exists once opened).
// Both carry a shared .text-zoom-target class. Rather than a single
// querySelectorAll cached at DOMContentLoaded (which would miss toolbars
// that don't exist yet), button clicks are handled via delegation on
// `document`, and targets/readouts are re-queried live on every use — cheap,
// and correct regardless of what's been dynamically added since. The chosen
// size is shared across every target on the page and remembered between
// visits (handy since the default is intentionally small on mobile).
const TEXT_ZOOM_STORAGE_KEY = "scrollableTextFontRem";
const TEXT_ZOOM_MIN_REM = 0.55;
const TEXT_ZOOM_MAX_REM = 1.1;
const TEXT_ZOOM_STEP_REM = 0.08;
const TEXT_ZOOM_BASE_REM = 0.82; // matches the CSS desktop default, used for the % readout

function textZoomCurrentRem(el) {
  const px = parseFloat(window.getComputedStyle(el).fontSize);
  const rootPx = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  return px / rootPx;
}

function applyTextZoom(rem) {
  document.querySelectorAll(".text-zoom-target").forEach((el) => { el.style.fontSize = rem + "rem"; });
  const pct = Math.round((rem / TEXT_ZOOM_BASE_REM) * 100);
  document.querySelectorAll(".text-zoom-readout").forEach((el) => { el.textContent = pct + "%"; });
}

// Re-applies whatever size is currently in effect (stored, or each target's
// own CSS default if the user hasn't picked one yet) to every
// .text-zoom-target in the DOM right now. Safe to call repeatedly — once at
// page load, and again right after building any new toolbar (e.g. a console
// preview's), so its readout starts correct and its target picks up
// whatever size was already chosen elsewhere on the page.
function refreshTextZoomTargets() {
  const targets = document.querySelectorAll(".text-zoom-target");
  if (!targets.length) return;
  const stored = parseFloat(localStorage.getItem(TEXT_ZOOM_STORAGE_KEY));
  if (!Number.isNaN(stored)) {
    applyTextZoom(stored);
  } else {
    const pct = Math.round((textZoomCurrentRem(targets[0]) / TEXT_ZOOM_BASE_REM) * 100);
    document.querySelectorAll(".text-zoom-readout").forEach((el) => { el.textContent = pct + "%"; });
  }
}

document.addEventListener("DOMContentLoaded", refreshTextZoomTargets);

document.addEventListener("click", (event) => {
  const btn = event.target.closest(".text-zoom-btn");
  if (!btn) return;
  const targets = document.querySelectorAll(".text-zoom-target");
  if (!targets.length) return;
  // getComputedStyle reflects the current inline size if one was set,
  // otherwise whatever the CSS (incl. mobile media query) resolves to.
  const base = textZoomCurrentRem(targets[0]);
  const delta = btn.dataset.zoom === "in" ? TEXT_ZOOM_STEP_REM : -TEXT_ZOOM_STEP_REM;
  const next = Math.min(TEXT_ZOOM_MAX_REM, Math.max(TEXT_ZOOM_MIN_REM, +(base + delta).toFixed(2)));
  applyTextZoom(next);
  localStorage.setItem(TEXT_ZOOM_STORAGE_KEY, next);
});

// --- Homepage scroll-reveal ------------------------------------------------
// Fades + slides each .reveal section in as it's scrolled into view.
// base.html adds .has-js to <html> synchronously (before body paints), which
// is what the CSS keys off to hide .reveal elements pre-emptively — so if JS
// never runs at all, content was never hidden in the first place. Here, if
// the browser lacks IntersectionObserver or the person prefers reduced
// motion, everything's just made visible immediately instead of observed.
document.addEventListener("DOMContentLoaded", () => {
  const targets = Array.from(document.querySelectorAll(".reveal"));
  if (!targets.length) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  targets.forEach((el) => observer.observe(el));
});

// --- Hero animated phrase cycle ---------------------------------------------
// Typewriter effect on the homepage hero: types each phrase, holds, deletes,
// moves to the next. The element already contains the first phrase as plain
// text (see index.html), so no-JS and prefers-reduced-motion visitors just
// see that one phrase, static — this only kicks in as an enhancement.
document.addEventListener("DOMContentLoaded", () => {
  const el = document.querySelector(".hero-cycle");
  if (!el) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  let phrases;
  try {
    phrases = JSON.parse(el.dataset.phrases || "[]");
  } catch (err) {
    return;
  }
  if (phrases.length < 2) return;

  const TYPE_MS = 45;
  const DELETE_MS = 28;
  const HOLD_MS = 1800;
  const GAP_MS = 350;

  let phraseIndex = 0;
  let charIndex = phrases[0].length; // starts already fully "typed"

  function step() {
    const current = phrases[phraseIndex];

    if (charIndex < current.length) {
      // Typing forward
      charIndex++;
      el.textContent = current.slice(0, charIndex);
      setTimeout(step, TYPE_MS);
      return;
    }

    // Fully typed — hold, then start deleting
    setTimeout(() => {
      deleteStep();
    }, HOLD_MS);
  }

  function deleteStep() {
    const current = phrases[phraseIndex];
    if (charIndex > 0) {
      charIndex--;
      el.textContent = current.slice(0, charIndex);
      setTimeout(deleteStep, DELETE_MS);
      return;
    }
    phraseIndex = (phraseIndex + 1) % phrases.length;
    setTimeout(step, GAP_MS);
  }

  setTimeout(() => deleteStep(), HOLD_MS);
});

// --- About page profile photo: occasional halo pulse --------------------
// The breathing scale animation is pure CSS (see .about-photo in style.css).
// This just spawns the expanding "halo ring" elements every so often — on a
// randomized interval rather than a fixed metronome, so it reads as an
// occasional occurrence rather than a steady beat. Skips entirely under
// prefers-reduced-motion, matching how the rest of the site's motion is
// gated.
document.addEventListener("DOMContentLoaded", () => {
  const wrap = document.getElementById("about-photo-wrap");
  if (!wrap) return; // not on the About page

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  function spawnHalo() {
    const ring = document.createElement("div");
    ring.className = "about-photo-halo is-pulsing";
    ring.addEventListener("animationend", () => ring.remove());
    wrap.appendChild(ring);
  }

  function scheduleNext() {
    // Roughly every 3.5–7s, occasionally a touch sooner — "occasionally",
    // not a fixed heartbeat.
    const delay = 3500 + Math.random() * 3500;
    setTimeout(() => {
      spawnHalo();
      // Rare double-pulse for a touch of variation.
      if (Math.random() < 0.2) {
        setTimeout(spawnHalo, 260);
      }
      scheduleNext();
    }, delay);
  }

  // First pulse comes a little sooner so the effect is noticed on arrival.
  setTimeout(spawnHalo, 900);
  scheduleNext();
});

// --- Hover-reveal header arming -------------------------------------------
// The translucent .hover-header (see style.css) is fixed at the top of the
// viewport and, on desktop, slides down whenever the mouse touches the very
// top edge — but the plain, non-sticky .site-header already sits right
// there until you scroll past it, so revealing the translucent copy on top
// of it is redundant. This "arms" the hover-reveal only once the real
// header has scrolled fully out of view, by toggling a class on <body>;
// the actual slide-down behavior stays defined in CSS (see the
// `body.header-armed` rule), this just decides when that CSS is allowed to
// trigger. Scrolling back up past the real header disarms it again
// immediately, even mid-hover, since the CSS selector simply stops
// matching once the class is removed.
document.addEventListener("DOMContentLoaded", () => {
  const realHeader = document.querySelector(".site-header");
  if (!realHeader || !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    ([entry]) => {
      document.body.classList.toggle("header-armed", !entry.isIntersecting);
    },
    { threshold: 0 }
  );
  observer.observe(realHeader);
});
