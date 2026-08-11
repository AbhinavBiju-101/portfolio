// Subtle glow that follows the cursor — and, when ambient music is playing,
// pulses and tints itself to the music's level/timbre so it reads as
// "vibing" along with the tune rather than sitting static. Also owns the
// site-wide click feedback: a small expanding ring at the click point plus
// (if audio is on) the synthesized click blip, both from one listener so
// they're always in sync.
(function () {
  const glow = document.getElementById("mouse-glow");
  const hasFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- Cursor-follow + audio-reactive glow --------------------------------
  // Skipped on touch-only devices (no real "hover" pointer, nothing to
  // follow) — but click feedback further down still applies everywhere.
  if (glow && hasFinePointer) {
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

    // Smoothed audio values (so the glow eases into changes rather than
    // jittering frame to frame with the raw analyser signal) plus a
    // decaying "kick" added on each click for a quick, snappy pop distinct
    // from the slower musical pulse.
    let levelSmoothed = 0;
    let clickKick = 0;

    const DEFAULT_BG = "radial-gradient(circle, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0) 70%)";

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

    window.addEventListener("mouseglow:click-kick", () => {
      clickKick = 1;
    });

    function frame() {
      x += (targetX - x) * 0.15;
      y += (targetY - y) * 0.15;

      let scale = 1;
      let background = DEFAULT_BG;

      const audioOn = !reduceMotion && window.SiteAudio && window.SiteAudio.isEnabled() && window.SiteAudio.isRunning();
      if (audioOn) {
        const rawLevel = window.SiteAudio.getLevel();
        levelSmoothed += (rawLevel - levelSmoothed) * 0.18;

        // Size "breathes" with overall loudness, plus a quick pop from any
        // recent click. Stays white (matching the default, non-music look)
        // — only opacity/size pulse with the music, not hue.
        scale = 1 + levelSmoothed * 0.45 + clickKick * 0.5;
        const alpha = 0.14 + levelSmoothed * 0.22 + clickKick * 0.1;
        background = `radial-gradient(circle, rgba(255, 255, 255, ${alpha.toFixed(3)}) 0%, rgba(255, 255, 255, 0) 70%)`;
      } else if (clickKick > 0.01) {
        // Music off/unavailable, but still honor a click kick with the
        // default coloring so clicks always feel responsive.
        scale = 1 + clickKick * 0.5;
        const alpha = 0.14 + clickKick * 0.1;
        background = `radial-gradient(circle, rgba(255, 255, 255, ${alpha.toFixed(3)}) 0%, rgba(255, 255, 255, 0) 70%)`;
      }

      clickKick *= 0.88;
      if (clickKick < 0.01) clickKick = 0;

      glow.style.background = background;
      glow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      requestAnimationFrame(frame);
    }
    frame();
  }

  // --- Click disturbance + click sound -------------------------------------
  // One listener, site-wide: every click gets a small expanding ring at the
  // click point, and (only if ambient audio is on) the same synthesized
  // blip audio.js already uses for interactive-element clicks — kept here
  // so the visual and the sound are always triggered together rather than
  // by two separate listeners that could drift out of sync.
  function spawnClickRipple(clientX, clientY) {
    const ring = document.createElement("div");
    ring.className = "click-disturbance";
    ring.style.left = clientX + "px";
    ring.style.top = clientY + "px";
    document.body.appendChild(ring);
    ring.addEventListener("animationend", () => ring.remove(), { once: true });
    // Safety net in case animationend doesn't fire for some reason (e.g.
    // element removed mid-navigation) — don't leak nodes.
    setTimeout(() => ring.remove(), 700);
  }

  document.addEventListener("click", (e) => {
    if (!reduceMotion) {
      spawnClickRipple(e.clientX, e.clientY);
      window.dispatchEvent(new CustomEvent("mouseglow:click-kick"));
    }
    if (window.SiteAudio && window.SiteAudio.isEnabled()) {
      window.SiteAudio.playClick();
    }
  });
})();
