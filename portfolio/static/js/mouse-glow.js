// Subtle glow that follows the cursor. Skipped on touch-only devices
// (no real "hover" pointer) since there's no cursor to follow there.
(function () {
  const glow = document.getElementById("mouse-glow");
  if (!glow) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    glow.style.display = "none";
    return;
  }

  // This is a true multi-page app — every link click is a full page load,
  // so JS state (including the glow's position) resets each time. Without
  // this, the glow would visibly snap back to the viewport center on every
  // navigation before easing back to the cursor. Persisting the last known
  // position across the tab's session fixes that.
  const STORAGE_KEY = "mouseGlowPos";
  let stored = null;
  try {
    stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
  } catch (e) {
    stored = null;
  }

  let targetX = stored && typeof stored.x === "number" ? stored.x : window.innerWidth / 2;
  let targetY = stored && typeof stored.y === "number" ? stored.y : window.innerHeight / 2;
  let x = targetX;
  let y = targetY;

  // Paint at the restored position immediately, before the first animation
  // frame, so there's no flash at the default center position either.
  glow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;

  document.addEventListener("mousemove", (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
  });

  function persist() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ x: targetX, y: targetY }));
    } catch (e) {
      // sessionStorage unavailable (private browsing, etc.) — degrade to
      // the center-start behavior, nothing else to do here.
    }
  }
  // pagehide fires reliably right before navigation (including back/forward
  // cache); beforeunload as a fallback for older browsers.
  window.addEventListener("pagehide", persist);
  window.addEventListener("beforeunload", persist);

  function frame() {
    x += (targetX - x) * 0.15;
    y += (targetY - y) * 0.15;
    glow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    requestAnimationFrame(frame);
  }
  frame();
})();
