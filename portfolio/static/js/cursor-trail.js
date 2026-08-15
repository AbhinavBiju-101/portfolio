// Cursor trail — a single flowing line tracing the pointer's path, visible
// only while a button/finger is held down and dragging (mousedown ->
// mouseup, or the touch equivalent). Unlike mouse-glow.js's always-on
// follow-glow, this exists purely as a "you're pressing and dragging"
// gesture trail, and disappears entirely once you're done with it.
//
// On release the line doesn't vanish immediately: it hangs around for an
// extra second, then "unwinds" — erasing from the starting point forward,
// like the trail catching up to where the draw began, rather than the
// whole line fading uniformly.
//
// Line thickness/glow scale with the ambient music's current level
// (SiteAudio.getLevel()) when it's playing — a louder moment in the music
// makes a visibly thicker/brighter line while dragging. With audio off or
// still blocked, the trail still draws at its baseline thickness.
(function () {
  const canvas = document.getElementById("cursor-trail-canvas");
  if (!canvas) return;
  const ctx2d = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return; // a flowing drag trail is pure motion — skip outright
  const isTouchPrimary = window.matchMedia("(pointer: coarse)").matches;
  if (isTouchPrimary) return; // finger-drag trails read as laggy/annoying on mobile — desktop-mouse only

  let width, height, dpr;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  const HOLD_AFTER_RELEASE_MS = 1000; // "lasts an extra second" before it starts disappearing
  const UNWIND_DURATION_MS = 550; // how long the start-to-end wipe itself takes
  const MAX_POINTS = 400; // safety cap for very long/slow drags

  let points = []; // {x, y}
  let isDown = false;
  let releasedAt = null; // ms timestamp, or null while still held/idle
  let unwindTotal = 0; // point count snapshotted at the moment release-wipe begins
  let rafId = null;

  function levelBoost() {
    const audioOn = window.SiteAudio && window.SiteAudio.isEnabled() && window.SiteAudio.isRunning();
    return audioOn ? window.SiteAudio.getLevel() : 0; // 0..1
  }

  function pointFromEvent(e) {
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function onDown(e) {
    // Starting a fresh drag always starts a fresh line — no carrying over
    // a previous trail that hasn't finished unwinding yet.
    points = [];
    releasedAt = null;
    isDown = true;
    const p = pointFromEvent(e);
    points.push(p);
    ensureLoop();
  }

  function onMove(e) {
    if (!isDown) return;
    const p = pointFromEvent(e);
    const last = points[points.length - 1];
    if (last) {
      const dist = Math.hypot(p.x - last.x, p.y - last.y);
      if (dist < 2) return; // skip near-duplicate points from fast-firing move events
      // Interpolate on big jumps so fast drags still get a continuous line
      // rather than visibly straight-line "teleports" between samples.
      const steps = Math.min(6, Math.max(1, Math.floor(dist / 14)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        points.push({ x: last.x + (p.x - last.x) * t, y: last.y + (p.y - last.y) * t });
      }
    } else {
      points.push(p);
    }
    if (points.length > MAX_POINTS) {
      points.splice(0, points.length - MAX_POINTS);
    }
  }

  function onUp() {
    if (!isDown) return;
    isDown = false;
    releasedAt = performance.now();
  }

  document.addEventListener("mousedown", onDown);
  document.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  document.addEventListener("touchstart", onDown, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("touchend", onUp);
  window.addEventListener("touchcancel", onUp);
  // Releasing outside the window (e.g. dragging off-screen) should still
  // count as "up" so the unwind timer starts.
  window.addEventListener("blur", onUp);

  function drawLine(pts, boost) {
    if (pts.length < 2) return;
    ctx2d.beginPath();
    ctx2d.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx2d.lineTo(pts[i].x, pts[i].y);
    }
    ctx2d.strokeStyle = boost > 0.5 ? "rgba(255, 200, 130, 0.55)" : "rgba(255, 157, 61, 0.5)";
    ctx2d.lineWidth = 2.5 + boost * 5;
    ctx2d.lineJoin = "round";
    ctx2d.lineCap = "round";
    ctx2d.shadowColor = "rgba(255, 157, 61, 0.5)";
    ctx2d.shadowBlur = 6 + boost * 10;
    ctx2d.stroke();
    ctx2d.shadowBlur = 0;
  }

  function frame() {
    ctx2d.clearRect(0, 0, width, height);
    const boost = levelBoost();

    if (isDown) {
      drawLine(points, boost);
    } else if (releasedAt !== null) {
      const now = performance.now();
      const sinceRelease = now - releasedAt;
      if (sinceRelease < HOLD_AFTER_RELEASE_MS) {
        // Hanging around unchanged for the extra second.
        drawLine(points, boost);
      } else {
        // Unwinding: erase from the start (index 0) forward, so the tail
        // end sticks around longest — the line vanishes from where it
        // began, not all at once.
        if (unwindTotal === 0) unwindTotal = points.length;
        const unwindElapsed = sinceRelease - HOLD_AFTER_RELEASE_MS;
        const progress = Math.min(1, unwindElapsed / UNWIND_DURATION_MS);
        const cutIndex = Math.floor(progress * unwindTotal);
        const visible = points.slice(cutIndex);
        drawLine(visible, boost);
        if (progress >= 1) {
          points = [];
          releasedAt = null;
          unwindTotal = 0;
        }
      }
    }

    if (isDown || points.length > 0) {
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = null; // nothing left to draw — stop the loop entirely
    }
  }

  function ensureLoop() {
    if (rafId === null) rafId = requestAnimationFrame(frame);
  }
})();
