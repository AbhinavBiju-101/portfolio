/* Timeline page.
 *
 * Almost everything here is server-computed absolute positioning (see
 * build_timeline() in app.py) — this script only handles the one thing
 * that needs real rendered sizes to get right: certification/achievement
 * cards on the center spine can land close enough in time that their
 * cards would overlap. Their `top` is fixed by date, so collisions are
 * resolved by nudging later cards *down* just enough to clear the one
 * above, using actual measured heights rather than a guessed constant.
 */
(function () {
  "use strict";

  var MIN_GAP = 6; // px between stacked event cards

  function resolveEventOverlap(frame) {
    var events = Array.prototype.slice.call(
      frame.querySelectorAll(".tl-event")
    );
    if (events.length < 2) return;

    // Already in document order == date order (server sorts point_events),
    // so a single top-to-bottom pass is enough.
    var prevBottom = -Infinity;
    events.forEach(function (el) {
      var top = parseFloat(el.style.top) || 0;
      if (top < prevBottom + MIN_GAP) {
        top = prevBottom + MIN_GAP;
        el.style.top = top + "px";
      }
      var card = el.querySelector(".tl-event-card");
      var h = card ? card.offsetHeight : el.offsetHeight;
      prevBottom = top + h;
    });
  }

  function init() {
    var frame = document.querySelector("[data-tl-frame]");
    if (!frame) return;
    // Run after layout settles (fonts, etc.) rather than on first paint.
    window.requestAnimationFrame(function () {
      resolveEventOverlap(frame);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
