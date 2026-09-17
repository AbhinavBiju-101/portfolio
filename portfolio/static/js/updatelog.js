/* Update-log panel.
 *
 * The rendered log is long (SkynetGrid's is 34 versions), so the panel ships
 * collapsed to a fixed height with a fade at the bottom, and expands on
 * demand. The "Jump to" select scrolls a version heading to the top of the
 * frame — scrolling the inner frame, not the page, so the toolbar stays put.
 *
 * Text zoom is handled by the shared [data-zoom] / .text-zoom-target wiring
 * in main.js; nothing here needs to know about it.
 */
(function () {
  "use strict";

  function initPanel(panel) {
    var frame = panel.querySelector("[data-updatelog-frame]");
    var body = panel.querySelector("[data-updatelog-body]");
    var expandBtn = panel.querySelector('[data-updatelog-action="expand"]');
    var jump = panel.querySelector("[data-updatelog-jump]");
    if (!frame || !body) return;

    // Give every version heading a stable id so the jump list can target it.
    // Ids are derived the same way the server derives its anchors, but we
    // recompute here rather than trusting them to match — markdown extensions
    // can slugify differently across versions.
    var headings = body.querySelectorAll("h2");
    Array.prototype.forEach.call(headings, function (h) {
      if (!h.id) {
        h.id = h.textContent
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
      }
    });

    // Only offer expand/collapse if there's actually something clipped.
    function overflows() {
      return body.scrollHeight > frame.clientHeight + 8;
    }

    if (expandBtn) {
      if (!overflows()) {
        expandBtn.hidden = true;
      }
      expandBtn.addEventListener("click", function () {
        var expanded = panel.classList.toggle("is-expanded");
        expandBtn.textContent = expanded ? "Collapse" : "Expand";
        expandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
        if (!expanded) {
          frame.scrollTop = 0;
          panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    }

    if (jump) {
      jump.addEventListener("change", function () {
        var id = jump.value;
        if (!id) return;
        var target = body.querySelector("#" + CSS.escape(id));
        if (!target) return;
        // Expand first — jumping inside a clipped frame lands nowhere useful.
        if (!panel.classList.contains("is-expanded") && expandBtn && !expandBtn.hidden) {
          panel.classList.add("is-expanded");
          expandBtn.textContent = "Collapse";
          expandBtn.setAttribute("aria-expanded", "true");
        }
        var offset = target.offsetTop - body.offsetTop;
        frame.scrollTo({ top: offset, behavior: "smooth" });
        target.classList.add("is-jump-target");
        window.setTimeout(function () {
          target.classList.remove("is-jump-target");
        }, 1200);
      });
    }
  }

  function init() {
    var panels = document.querySelectorAll("[data-updatelog]");
    Array.prototype.forEach.call(panels, initPanel);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
