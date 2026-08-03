// Subtle ambient background — soft embers drifting upward, scrolling with
// the page (the canvas is sized to full document height and absolutely
// positioned, so it moves with content instead of staying pinned to the
// viewport). Respects prefers-reduced-motion by rendering statically.
(function () {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let width, height, particles;

  function docHeight() {
    return Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      window.innerHeight
    );
  }

  function resize() {
    width = window.innerWidth;
    height = docHeight();
    canvas.width = width;
    canvas.height = height;
    canvas.style.height = height + "px";
  }

  window.addEventListener("resize", resize);
  // Content height can change after images/preview panels load, so keep
  // checking rather than sizing once.
  new ResizeObserver(resize).observe(document.body);
  resize();

  function makeParticle(initial) {
    return {
      x: Math.random() * width,
      y: initial ? Math.random() * height : height + 10,
      r: Math.random() * 1.4 + 0.4,
      speedY: Math.random() * 0.18 + 0.04,
      speedX: (Math.random() - 0.5) * 0.08,
      alpha: Math.random() * 0.35 + 0.08,
      drift: Math.random() * Math.PI * 2,
    };
  }

  function seed() {
    const count = Math.min(120, Math.floor((width * height) / 30000));
    particles = Array.from({ length: count }, () => makeParticle(true));
  }
  seed();

  function frame() {
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 157, 61, ${p.alpha})`;
      ctx.fill();

      if (!reduceMotion) {
        p.drift += 0.01;
        p.y -= p.speedY;
        p.x += p.speedX + Math.sin(p.drift) * 0.05;
        if (p.y < -10) Object.assign(p, makeParticle(false));
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
      }
    }
    if (!reduceMotion) requestAnimationFrame(frame);
  }

  frame();
})();
