// --- Interactive project file explorer ------------------------------------
// Renders the JSON tree embedded in [data-explorer]'s data-tree attribute as
// a clickable directory tree (folders open/close, nothing else happens).
// Clicking a file fetches its source from /projects/<slug>/source?path=...
// and swaps the tree pane out for a source-code pane, with a "back to tree"
// button that swaps it back. Only one explorer per page is expected (the
// project detail page's "Files" section) but this is written to support
// several without them stepping on each other, keyed off the container.

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-explorer]").forEach(initExplorer);
});

function initExplorer(root) {
  let data;
  try {
    data = JSON.parse(root.dataset.tree);
  } catch (err) {
    return;
  }

  const slug = root.dataset.slug;
  const treePane = root.querySelector("[data-explorer-tree-pane]");
  const treeEl = root.querySelector("[data-explorer-tree]");
  const sourcePane = root.querySelector("[data-explorer-source-pane]");
  const sourceStatusEl = root.querySelector("[data-explorer-source-status]");
  const sourceCodeEl = root.querySelector("[data-explorer-source-code]");
  const toolbarTree = root.querySelector("[data-explorer-toolbar-tree]");
  const toolbarSource = root.querySelector("[data-explorer-toolbar-source]");
  const filePathEl = root.querySelector("[data-explorer-file-path]");

  // Simple in-memory cache so re-clicking a file already viewed this page
  // load doesn't re-fetch it.
  const sourceCache = new Map();
  let currentFetchToken = 0;

  function buildTree(nodes, depth) {
    const ul = document.createElement("ul");
    ul.className = "explorer-list";
    if (depth === 0) ul.setAttribute("role", "group");
    nodes.forEach((node) => ul.appendChild(buildNode(node, depth)));
    return ul;
  }

  function buildNode(node, depth) {
    const li = document.createElement("li");
    li.className = "explorer-item";

    if (node.type === "dir") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "explorer-row explorer-row--dir";
      btn.setAttribute("aria-expanded", "false");
      btn.style.setProperty("--explorer-depth", depth);
      btn.innerHTML =
        '<span class="explorer-caret" aria-hidden="true">&#9656;</span>' +
        '<span class="explorer-icon" aria-hidden="true">&#128193;</span>' +
        '<span class="explorer-name"></span>';
      btn.querySelector(".explorer-name").textContent = node.name;

      const childWrap = buildTree(node.children || [], depth + 1);
      childWrap.hidden = true;

      btn.addEventListener("click", () => {
        const isOpen = btn.getAttribute("aria-expanded") === "true";
        setDirOpen(btn, childWrap, !isOpen);
      });

      li.appendChild(btn);
      li.appendChild(childWrap);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "explorer-row explorer-row--file";
      btn.style.setProperty("--explorer-depth", depth);
      btn.dataset.path = node.path;
      btn.innerHTML =
        '<span class="explorer-caret explorer-caret--spacer" aria-hidden="true"></span>' +
        '<span class="explorer-icon" aria-hidden="true">&#128196;</span>' +
        '<span class="explorer-name"></span>';
      btn.querySelector(".explorer-name").textContent = node.name;
      btn.addEventListener("click", () => openFile(node.path, btn));
      li.appendChild(btn);
    }

    return li;
  }

  function setDirOpen(btn, childWrap, open) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    childWrap.hidden = !open;
    const icon = btn.querySelector(".explorer-icon");
    const caret = btn.querySelector(".explorer-caret");
    if (icon) icon.innerHTML = open ? "&#128194;" : "&#128193;";
    if (caret) caret.innerHTML = open ? "&#9662;" : "&#9656;";
  }

  function setAllDirs(open) {
    treeEl.querySelectorAll(".explorer-row--dir").forEach((btn) => {
      const childWrap = btn.nextElementSibling;
      if (childWrap) setDirOpen(btn, childWrap, open);
    });
  }

  async function openFile(path, btn) {
    treeEl.querySelectorAll(".explorer-row--file.is-active").forEach((el) => el.classList.remove("is-active"));
    if (btn) btn.classList.add("is-active");

    treePane.hidden = true;
    sourcePane.hidden = false;
    toolbarTree.hidden = true;
    toolbarSource.hidden = false;
    filePathEl.textContent = path;

    sourceCodeEl.hidden = true;
    sourceStatusEl.hidden = false;
    sourceStatusEl.textContent = "Loading…";

    const token = ++currentFetchToken;

    if (sourceCache.has(path)) {
      renderSource(sourceCache.get(path));
      return;
    }

    try {
      const res = await fetch(`/projects/${encodeURIComponent(slug)}/source?path=${encodeURIComponent(path)}`);
      const payload = await res.json();
      if (token !== currentFetchToken) return; // a newer click superseded this one
      sourceCache.set(path, payload);
      renderSource(payload);
    } catch (err) {
      if (token !== currentFetchToken) return;
      renderSource({ error: "Couldn't load that file — check your connection and try again." });
    }
  }

  function renderSource(payload) {
    if (payload.error) {
      sourceStatusEl.hidden = false;
      sourceStatusEl.textContent = payload.error;
      sourceCodeEl.hidden = true;
      return;
    }
    sourceStatusEl.hidden = true;
    sourceCodeEl.hidden = false;
    sourceCodeEl.textContent = payload.content + (payload.truncated ? "\n\n… (truncated, file is larger than shown)" : "");
  }

  function backToTree() {
    sourcePane.hidden = true;
    treePane.hidden = false;
    toolbarSource.hidden = true;
    toolbarTree.hidden = false;
  }

  root.addEventListener("click", (event) => {
    const actionBtn = event.target.closest("[data-explorer-action]");
    if (!actionBtn || !root.contains(actionBtn)) return;
    const action = actionBtn.dataset.explorerAction;
    if (action === "expand-all") setAllDirs(true);
    else if (action === "collapse-all") setAllDirs(false);
    else if (action === "back") backToTree();
  });

  treeEl.appendChild(buildTree(data.tree || [], 0));
}
