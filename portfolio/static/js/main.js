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
          loadJavaConsolePreview(slug, container, (session) => { activeSession = session; });
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

// --- Java console apps, executed server-side (java -jar), streamed live --
// The server spawns a real `java -jar` process per session and streams its
// stdout over Server-Sent Events; keystrokes go back over a small POST
// endpoint. See the /preview/<slug>/start, /preview/stream/<id>, and
// /preview/input/<id> routes in app.py.
async function loadJavaConsolePreview(slug, container, onSession) {
  container.innerHTML = '<p class="preview-status">Starting the Java process…</p>';

  try {
    const startRes = await fetch(`/preview/${slug}/start`, { method: "POST" });
    if (!startRes.ok) {
      const body = await startRes.json().catch(() => ({}));
      throw new Error(body.error || `Server returned ${startRes.status}`);
    }
    const { session_id } = await startRes.json();

    container.innerHTML = `
      <pre id="console-output" class="console-output" aria-live="polite"></pre>
      <form id="console-form" class="console-input-row">
        <input id="console-input" type="text" autocomplete="off" placeholder="Type input and press Enter…">
        <button class="btn btn-primary" type="submit">Send</button>
      </form>
    `;
    const output = document.getElementById("console-output");
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

    function appendOutput(text) {
      buffer += text;
      if (buffer.length > MAX_OUTPUT_CHARS) {
        buffer = buffer.slice(buffer.length - MAX_OUTPUT_CHARS);
      }
      if (!renderScheduled) {
        renderScheduled = true;
        requestAnimationFrame(() => {
          output.textContent = buffer;
          output.scrollTop = output.scrollHeight;
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
    container.innerHTML = `<p class="preview-status preview-error">Couldn't start the Java preview: ${escapeHtml(String(err))}</p>`;
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
async function loadCheerpJPreview(src, container, mainClass) {
  container.innerHTML = '<p class="preview-status">Loading Java runtime…</p>';

  try {
    if (!window.cheerpjInit) {
      await loadScript("https://cjrtnc.leaningtech.com/4.3/loader.js");
    }
    await cheerpjInit();

    container.innerHTML = '<div id="cheerpj-display" class="cheerpj-display"></div>';

    cheerpjCreateDisplay(-1, -1, document.getElementById("cheerpj-display"));
    // classPath must be the full "/app/..." path to the jar, matching the
    // web server's own URL path (the "/app/" prefix is CheerpJ's virtual
    // filesystem mount point for this origin's document root).
    await cheerpjRunMain(mainClass || "Main", "/app" + src);
  } catch (err) {
    container.innerHTML = `<p class="preview-status preview-error">Couldn't load the Java preview: ${escapeHtml(String(err))}</p>`;
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
      <pre id="console-output" class="console-output" aria-live="polite"></pre>
      <form id="console-form" class="console-input-row">
        <input id="console-input" type="text" autocomplete="off" placeholder="Type input and press Enter…">
        <button class="btn btn-primary" type="submit">Send</button>
      </form>
      <p class="preview-hint">Shared demo — everyone previewing this project right now sees the same room.</p>
    `;
    const tabsEl = container.querySelector(".network-tabs");
    const output = document.getElementById("console-output");
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

    function scheduleRender() {
      if (renderScheduled) return;
      renderScheduled = true;
      requestAnimationFrame(() => {
        output.textContent = buffers[activeChannel] || "";
        output.scrollTop = output.scrollHeight;
        renderScheduled = false;
      });
    }

    function appendTo(channelId, text) {
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
      currentSource.addEventListener("end", () => appendTo(channelId, "\n\n[disconnected]\n"));
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
  const thumbs = document.querySelectorAll(".gallery-thumb");
  if (!mainImg || !thumbs.length) return;

  thumbs.forEach((thumb) => {
    thumb.addEventListener("click", () => {
      mainImg.src = thumb.dataset.full;
      thumbs.forEach((t) => t.classList.remove("is-active"));
      thumb.classList.add("is-active");
    });
  });
});
