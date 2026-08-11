// Procedural, generative background music + a click sound effect — no audio
// files anywhere, everything is synthesized live with the Web Audio API.
// Off by default (browsers block autoplay with sound anyway, and an
// unannounced music sting on a portfolio site would be rude); a small
// toggle button turns it on, and the choice is remembered across page loads
// via localStorage since every navigation here is a real page load, not a
// client-side route change — see mouse-glow.js for the same pattern.
//
// Each page gets its own small theme (scale, tempo, register) rather than
// one loop playing everywhere, so navigating the site actually feels like
// moving between different spaces. Themes share one synth engine — a slow
// detuned pad underneath, plus a sparse plucked arpeggio on top, both
// filtered — so it stays one coherent "sound", just retuned per page.
(function () {
  "use strict";

  const STORAGE_KEY = "site-audio-enabled";
  const VOLUME_KEY = "site-audio-volume";

  function isEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }
  function setEnabledStored(v) {
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch (e) {
      /* localStorage unavailable (private mode etc) — just won't persist */
    }
  }
  function getVolume() {
    try {
      const v = parseFloat(localStorage.getItem(VOLUME_KEY));
      return isFinite(v) && v >= 0 && v <= 1 ? v : 0.5;
    } catch (e) {
      return 0.5;
    }
  }
  function setVolumeStored(v) {
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch (e) {
      /* ignore */
    }
  }

  // --- Per-page themes -------------------------------------------------
  // `scale` is a set of semitone offsets from `root` (MIDI note number);
  // the arpeggiator walks it with a slight upward/downward bias rather than
  // pure random, so it reads as a wandering melody instead of noise.
  const THEMES = {
    home: {
      root: 57, // A3 — bright, welcoming
      scale: [0, 2, 4, 7, 9, 12, 14, 16], // major pentatonic + octave, extra color tones
      noteMs: 520,
      padMs: 6000,
      filterHz: 1800,
      wave: "triangle",
      padWave: "sine",
      gain: 0.5,
    },
    projects: {
      root: 55, // G3 — a bit more driven / purposeful
      scale: [0, 3, 5, 7, 10, 12, 15, 17], // minor pentatonic-ish, some tension
      noteMs: 360,
      padMs: 5200,
      filterHz: 2200,
      wave: "sawtooth",
      padWave: "triangle",
      gain: 0.4,
    },
    skills: {
      root: 60, // C4 — airy, spacious
      scale: [0, 2, 5, 7, 9, 14, 16, 19], // lydian-leaning, open
      noteMs: 700,
      padMs: 7500,
      filterHz: 1500,
      wave: "sine",
      padWave: "sine",
      gain: 0.45,
    },
    certifications: {
      root: 48, // C3 — low, stately, a bit formal
      scale: [0, 4, 7, 11, 12, 16, 19], // major 7th flavor, resolved
      noteMs: 900,
      padMs: 8000,
      filterHz: 1200,
      wave: "triangle",
      padWave: "sine",
      gain: 0.42,
    },
    about: {
      root: 52, // E3 — warm, reflective
      scale: [0, 2, 3, 7, 9, 10, 12, 15], // minor pentatonic + passing tones
      noteMs: 640,
      padMs: 6800,
      filterHz: 1400,
      wave: "sine",
      padWave: "triangle",
      gain: 0.45,
    },
    default: {
      root: 55,
      scale: [0, 2, 4, 7, 9, 12],
      noteMs: 560,
      padMs: 6200,
      filterHz: 1700,
      wave: "triangle",
      padWave: "sine",
      gain: 0.4,
    },
  };

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  let ctx = null;
  let masterGain = null;
  let clickGain = null;
  let musicGain = null;
  let running = false;
  let schedulerId = null;
  let padNodes = null;
  let walkPos = 0;

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = getVolume();
    masterGain.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = 1;
    musicGain.connect(masterGain);

    clickGain = ctx.createGain();
    clickGain.gain.value = 1;
    clickGain.connect(masterGain);
    return ctx;
  }

  function currentTheme() {
    const key = (document.body && document.body.dataset.page) || "default";
    return THEMES[key] || THEMES.default;
  }

  // A slow, softly detuned two-oscillator pad, run through a lowpass filter
  // with a very slow LFO on the cutoff so it breathes rather than sitting
  // static. Runs continuously while music is on; only its target frequency
  // changes when the underlying chord tone shifts.
  function startPad(theme) {
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = theme.padWave;
    osc2.type = theme.padWave;
    osc1.frequency.value = midiToFreq(theme.root - 12);
    osc2.frequency.value = midiToFreq(theme.root - 12);
    osc2.detune.value = 9; // slight beating between the two, for warmth

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = theme.filterHz * 0.5;
    filter.Q.value = 0.5;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / 14; // one slow sweep roughly every 14s
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = theme.filterHz * 0.25;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const padEnv = ctx.createGain();
    padEnv.gain.value = 0;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(padEnv);
    padEnv.connect(musicGain);

    osc1.start(now);
    osc2.start(now);
    lfo.start(now);

    // Fade the pad in gently rather than snapping to full volume.
    padEnv.gain.linearRampToValueAtTime(theme.gain * 0.22, now + 3);

    padNodes = { osc1, osc2, filter, lfo, lfoGain, padEnv };
  }

  function stopPad() {
    if (!padNodes) return;
    const now = ctx.currentTime;
    const { osc1, osc2, lfo, padEnv } = padNodes;
    padEnv.gain.cancelScheduledValues(now);
    padEnv.gain.linearRampToValueAtTime(0, now + 1.2);
    [osc1, osc2, lfo].forEach((n) => {
      try {
        n.stop(now + 1.3);
      } catch (e) {
        /* already stopped */
      }
    });
    padNodes = null;
  }

  // One plucked note: fast attack, exponential decay, through a lowpass so
  // it's soft rather than buzzy. theme.wave controls timbre per page.
  function pluck(theme, freq, time, velocity) {
    const osc = ctx.createOscillator();
    osc.type = theme.wave;
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = theme.filterHz;
    filter.Q.value = 0.7;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(theme.gain * velocity, time + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0008, time + theme.noteMs / 1000);

    osc.connect(filter);
    filter.connect(env);
    env.connect(musicGain);

    osc.start(time);
    osc.stop(time + theme.noteMs / 1000 + 0.05);
  }

  // Simple biased random walk across the theme's scale degrees, so the
  // melody wanders instead of jumping around or repeating a fixed loop.
  function nextScaleStep(theme) {
    const len = theme.scale.length;
    const step = Math.random();
    if (step < 0.45) walkPos += 1;
    else if (step < 0.75) walkPos -= 1;
    else if (step < 0.85) walkPos += 2;
    else if (step < 0.95) walkPos -= 2;
    // else: stay — a repeated note now and then reads as intentional
    if (walkPos < 0) walkPos = 0;
    if (walkPos >= len) walkPos = len - 1;
    return theme.scale[walkPos];
  }

  function scheduleLoop() {
    if (!running) return;
    const theme = currentTheme();
    const now = ctx.currentTime;

    // Not every tick plays a note — occasional rests keep it from feeling
    // like a busy, mechanical arpeggio.
    if (Math.random() > 0.18) {
      const degree = nextScaleStep(theme);
      const octaveUp = Math.random() < 0.15 ? 12 : 0;
      const freq = midiToFreq(theme.root + degree + octaveUp);
      const velocity = 0.7 + Math.random() * 0.3;
      pluck(theme, freq, now + 0.02, velocity);
    }

    const jitter = theme.noteMs * (0.85 + Math.random() * 0.3);
    schedulerId = setTimeout(scheduleLoop, jitter);
  }

  function startMusic() {
    if (!ensureContext()) return;
    if (ctx.state === "suspended") ctx.resume();
    if (running) return;
    running = true;
    walkPos = 0;
    startPad(currentTheme());
    scheduleLoop();
  }

  function stopMusic() {
    running = false;
    if (schedulerId) {
      clearTimeout(schedulerId);
      schedulerId = null;
    }
    if (ctx) stopPad();
  }

  // A short, quiet synthesized tick for interactive clicks — not a sample,
  // just a fast sine blip through a highpass so it reads as a soft "click"
  // rather than a tone.
  function playClick() {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1100, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.05);

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 300;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.16, now);
    env.gain.exponentialRampToValueAtTime(0.0008, now + 0.06);

    osc.connect(filter);
    filter.connect(env);
    env.connect(clickGain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  function setEnabled(on) {
    setEnabledStored(on);
    if (on) {
      startMusic();
    } else {
      stopMusic();
    }
    updateToggleUI(on);
  }

  // --- Toggle button UI --------------------------------------------------
  let toggleBtn = null;

  function updateToggleUI(on) {
    if (!toggleBtn) return;
    toggleBtn.setAttribute("aria-pressed", on ? "true" : "false");
    toggleBtn.classList.toggle("is-on", on);
    toggleBtn.innerHTML = on ? ICON_ON : ICON_OFF;
    toggleBtn.setAttribute("title", on ? "Mute sound" : "Play ambient sound");
  }

  const ICON_ON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 8 9 13 4 13 20 8 15 3 15 3 9"></polygon><path d="M16 8a5 5 0 0 1 0 8"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path></svg>';
  const ICON_OFF =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 8 9 13 4 13 20 8 15 3 15 3 9"></polygon><line x1="16.5" y1="7.5" x2="22.5" y2="16.5"></line><line x1="22.5" y1="7.5" x2="16.5" y2="16.5"></line></svg>';

  function buildToggle() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "audio-toggle";
    btn.setAttribute("aria-label", "Toggle ambient sound");
    btn.addEventListener("click", () => {
      const next = !isEnabled();
      setEnabled(next);
    });
    document.body.appendChild(btn);
    return btn;
  }

  document.addEventListener("DOMContentLoaded", () => {
    toggleBtn = buildToggle();
    const enabled = isEnabled();
    updateToggleUI(enabled);

    if (enabled) {
      // A fresh page load isn't itself a "user gesture" in every browser,
      // so autoplay may still be blocked even though the person opted in
      // last time they clicked the toggle. ensureContext()+resume() here
      // covers browsers that do allow it; the one-time listener below
      // catches the rest on the very next interaction, silently.
      ensureContext();
      startMusic();
      const resumeOnce = () => {
        if (ctx && ctx.state === "suspended") ctx.resume();
        if (!running) startMusic();
        document.removeEventListener("pointerdown", resumeOnce);
        document.removeEventListener("keydown", resumeOnce);
      };
      document.addEventListener("pointerdown", resumeOnce, { once: true });
      document.addEventListener("keydown", resumeOnce, { once: true });
    }

    // Click SFX on interactive elements only (links, buttons) — not every
    // stray click on the page, and only once audio is actually running.
    document.addEventListener(
      "click",
      (e) => {
        if (!isEnabled()) return;
        const target = e.target.closest("a, button");
        if (!target) return;
        if (!ctx || ctx.state !== "running") return;
        playClick();
      },
      true
    );
  });
})();
