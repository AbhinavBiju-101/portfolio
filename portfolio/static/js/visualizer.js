// Background visualizer "watermark" — a smooth, flowing waveform line
// (classic oscilloscope/EQ style) stretching across the viewport, fixed in
// place (not scrolling with the page, unlike the ember particles in
// background.js), sitting behind all content. Reacts to the ambient music
// via SiteAudio.getSpectrum() when playing; otherwise idles with a slow
// rolling sine wave so the layer isn't just a flat line when audio is
// off/blocked. A second, dimmer mirrored wave underneath adds a bit of
// depth without adding visual noise.
(function () {
  const canvas = document.getElementById("bg-visualizer");
  if (!canvas) return;
  const ctx2d = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const POINTS = 64;
  let width, height, dpr;
  let smoothed = new Array(POINTS).fill(0);
  let idlePhase = 0;

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

  // Builds a smooth curve through `levels` (roughly -1..1 each) centered at
  // `baseY`, strokes it, and mirrors a dimmer copy below for depth.
  function drawWave(levels, baseY, amplitude, alpha, lineWidth) {
    const marginX = width * 0.06;
    const usableW = width - marginX * 2;
    const step = usableW / (levels.length - 1);

    function pathFor(sign) {
      ctx2d.beginPath();
      for (let i = 0; i < levels.length; i++) {
        const x = marginX + i * step;
        const y = baseY + sign * levels[i] * amplitude;
        if (i === 0) {
          ctx2d.moveTo(x, y);
        } else {
          // Smooth through midpoints rather than straight segments, so the
          // line reads as a continuous wave rather than a jagged EQ.
          const prevX = marginX + (i - 1) * step;
          const prevY = baseY + sign * levels[i - 1] * amplitude;
          const midX = (prevX + x) / 2;
          const midY = (prevY + y) / 2;
          ctx2d.quadraticCurveTo(prevX, prevY, midX, midY);
        }
      }
    }

    pathFor(1);
    ctx2d.strokeStyle = `rgba(255, 157, 61, ${alpha})`;
    ctx2d.lineWidth = lineWidth;
    ctx2d.lineJoin = "round";
    ctx2d.lineCap = "round";
    ctx2d.stroke();

    // Dimmer mirrored reflection below the main line.
    pathFor(-0.45);
    ctx2d.strokeStyle = `rgba(255, 157, 61, ${alpha * 0.45})`;
    ctx2d.lineWidth = lineWidth * 0.85;
    ctx2d.stroke();
  }

  function render(levels) {
    ctx2d.clearRect(0, 0, width, height);
    const baseY = height * 0.62;
    const amplitude = Math.min(height * 0.16, 130);
    // Less transparent than a pure texture layer — meant to actually read
    // as a wave, not disappear into the background.
    drawWave(levels, baseY, amplitude, 0.14, 2);
  }

  function idleLevels() {
    idlePhase += 0.012;
    const out = new Array(POINTS);
    for (let i = 0; i < POINTS; i++) {
      out[i] = Math.sin(idlePhase + i * 0.28) * 0.5 + Math.sin(idlePhase * 0.6 + i * 0.09) * 0.3;
    }
    return out;
  }

  function frame() {
    const audioOn = window.SiteAudio && window.SiteAudio.isEnabled() && window.SiteAudio.isRunning();
    let target;
    if (audioOn) {
      const spectrum = window.SiteAudio.getSpectrum(POINTS);
      // Center the wave on 0 (spectrum is 0..1, unsigned) so it swings both
      // above and below the baseline like a real waveform rather than only
      // bulging one direction.
      target = spectrum.map((v) => (v - 0.15) * 1.6);
    } else {
      target = idleLevels();
    }
    for (let i = 0; i < POINTS; i++) {
      smoothed[i] += (target[i] - smoothed[i]) * (audioOn ? 0.22 : 0.06);
    }
    render(smoothed);
    requestAnimationFrame(frame);
  }

  if (reduceMotion) {
    render(idleLevels());
  } else {
    frame();
  }
})();
