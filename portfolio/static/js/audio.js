// --- Procedural, generative background music + a click sound effect -------
// No audio files anywhere — everything is synthesized live with the Web
// Audio API. Off by default (browsers block autoplay-with-sound anyway, and
// an unannounced music sting on a portfolio site would be rude); a small
// toggle button turns it on, and the choice is remembered across page loads
// via localStorage since every navigation here is a real page load, not a
// client-side route change.
//
// Each page gets its own theme (scale, tempo, register, chord progression)
// so navigating the site feels like moving between different spaces. Every
// theme is built from the same layered engine — a detuned pad, a sub-bass
// voice, a lead arpeggio, a sparser high counter-melody, a soft echo bus,
// and an occasional shimmer — just retuned per page, so it stays one
// coherent "sound" throughout the site.
//
// "Continuous across pages": since navigation here is a real page load, the
// AudioContext itself can't literally survive it — but the *music* isn't
// meant to restart from bar one every time you click a link. A single song
// clock (`songStartedAt`, sessionStorage-backed so it survives reloads but
// resets when the tab/session ends) keeps advancing across every page in
// this tab. Chord progression and melodic wander position are both derived
// from that shared clock rather than reset per page, so leaving Home for
// Projects mid-phrase and coming back later resumes roughly where the piece
// "would" be — different theme, same underlying pulse — instead of every
// page feeling like pressing play on an unrelated loop.
(function () {
  "use strict";

  const STORAGE_KEY = "site-audio-enabled";
  const VOLUME_KEY = "site-audio-volume";
  const SONG_START_KEY = "site-audio-song-start"; // sessionStorage: ms epoch
  const WALK_KEY = "site-audio-walk-state"; // sessionStorage: JSON {lead, counter}

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

  // The shared song clock: first page in this tab session to start music
  // stamps "now" as bar zero; every later page (reload or navigation) reads
  // the same stamp back, so elapsed song time only ever moves forward.
  function getSongStartedAt() {
    try {
      let v = parseInt(sessionStorage.getItem(SONG_START_KEY), 10);
      if (!isFinite(v)) {
        v = Date.now();
        sessionStorage.setItem(SONG_START_KEY, String(v));
      }
      return v;
    } catch (e) {
      return Date.now();
    }
  }
  function songTimeMs() {
    return Date.now() - getSongStartedAt();
  }

  function loadWalkState() {
    try {
      const raw = sessionStorage.getItem(WALK_KEY);
      if (!raw) return { lead: 0, counter: 0 };
      const parsed = JSON.parse(raw);
      return {
        lead: Number.isFinite(parsed.lead) ? parsed.lead : 0,
        counter: Number.isFinite(parsed.counter) ? parsed.counter : 0,
      };
    } catch (e) {
      return { lead: 0, counter: 0 };
    }
  }
  function saveWalkState(state) {
    try {
      sessionStorage.setItem(WALK_KEY, JSON.stringify(state));
    } catch (e) {
      /* ignore */
    }
  }

  // --- Per-page themes -------------------------------------------------
  // `scale` is a set of semitone offsets from `root` (MIDI note number); the
  // arpeggiator walks it with a slight bias rather than pure random, so it
  // reads as a wandering melody instead of noise. `progression` is a list of
  // chord-root offsets (also semitones from `root`) that the pad/bass cycle
  // through over `chordMs` each, so the harmony actually moves instead of
  // droning on one note.
  const THEMES = {
    home: {
      root: 57, // A3 — bright, welcoming
      scale: [0, 2, 4, 7, 9, 12, 14, 16], // major pentatonic + octave, extra color tones
      progression: [0, 5, 9, 7], // I - IV - vi - V, in semitone offsets
      chordMs: 9000,
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
      progression: [0, -2, 3, -5],
      chordMs: 7000,
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
      progression: [0, 7, 4, 9],
      chordMs: 10000,
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
      progression: [0, 5, -3, 7],
      chordMs: 11000,
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
      progression: [0, 3, -2, 5],
      chordMs: 9500,
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
      progression: [0, 5, 7],
      chordMs: 8000,
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
  let analyser = null;
  let analyserData = null;
  let running = false;
  let schedulerId = null;
  let chordTimerId = null;
  let padNodes = null;
  let bassNodes = null;
  let delayBus = null;
  let walk = { lead: 0, counter: 0 };

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

    // Soft feedback delay all the melodic voices can send into, so notes
    // trail off into short echoes rather than cutting dead — this is most
    // of what makes the loop read as "continuous" rather than a dry blip
    // every noteMs. Kept subtle (low feedback, modest wet mix).
    const delayNode = ctx.createDelay(2.0);
    delayNode.delayTime.value = 0.34;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = "lowpass";
    delayFilter.frequency.value = 2600;

    delayNode.connect(delayFilter);
    delayFilter.connect(feedback);
    feedback.connect(delayNode);
    delayFilter.connect(wet);
    wet.connect(musicGain);
    delayBus = delayNode;

    // Analyser on the music bus, exposed via window.SiteAudio so other
    // widgets (e.g. the mouse glow) can sync visuals to what's playing
    // without needing their own Web Audio plumbing.
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    analyserData = new Uint8Array(analyser.frequencyBinCount);
    musicGain.connect(analyser);

    return ctx;
  }

  function currentTheme() {
    const key = (document.body && document.body.dataset.page) || "default";
    return THEMES[key] || THEMES.default;
  }

  function chordOffset(theme, atMs) {
    const prog = theme.progression && theme.progression.length ? theme.progression : [0];
    const idx = Math.floor(atMs / theme.chordMs) % prog.length;
    return prog[(idx + prog.length) % prog.length];
  }

  // --- Pad: two detuned oscillators + a sub-bass voice, both through slow
  // filter LFOs, both retargeted (glided, not re-triggered) whenever the
  // chord progression moves to its next chord. Runs continuously while
  // music is on.
  function startPad(theme) {
    const now = ctx.currentTime;
    const chord = chordOffset(theme, songTimeMs());

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = theme.padWave;
    osc2.type = theme.padWave;
    osc1.frequency.value = midiToFreq(theme.root + chord - 12);
    osc2.frequency.value = midiToFreq(theme.root + chord - 12);
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
    padEnv.connect(delayBus);

    osc1.start(now);
    osc2.start(now);
    lfo.start(now);

    // Fade the pad in — short enough that re-entering on a fresh page feels
    // like the piece picking back up, not restarting from silence.
    padEnv.gain.linearRampToValueAtTime(theme.gain * 0.22, now + 1.4);

    padNodes = { osc1, osc2, filter, lfo, lfoGain, padEnv };

    // Sub-bass voice: one octave further down, sine only (keeps it clean,
    // felt more than heard), gives the pad an actual low end.
    const bassOsc = ctx.createOscillator();
    bassOsc.type = "sine";
    bassOsc.frequency.value = midiToFreq(theme.root + chord - 24);

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = "lowpass";
    bassFilter.frequency.value = 400;

    const bassEnv = ctx.createGain();
    bassEnv.gain.value = 0;

    bassOsc.connect(bassFilter);
    bassFilter.connect(bassEnv);
    bassEnv.connect(musicGain);

    bassOsc.start(now);
    bassEnv.gain.linearRampToValueAtTime(theme.gain * 0.3, now + 1.6);

    bassNodes = { bassOsc, bassFilter, bassEnv };
  }

  function stopPad() {
    if (padNodes) {
      const now = ctx.currentTime;
      const { osc1, osc2, lfo, padEnv } = padNodes;
      padEnv.gain.cancelScheduledValues(now);
      padEnv.gain.linearRampToValueAtTime(0, now + 1.0);
      [osc1, osc2, lfo].forEach((n) => {
        try {
          n.stop(now + 1.1);
        } catch (e) {
          /* already stopped */
        }
      });
      padNodes = null;
    }
    if (bassNodes) {
      const now = ctx.currentTime;
      const { bassOsc, bassEnv } = bassNodes;
      bassEnv.gain.cancelScheduledValues(now);
      bassEnv.gain.linearRampToValueAtTime(0, now + 1.0);
      try {
        bassOsc.stop(now + 1.1);
      } catch (e) {
        /* already stopped */
      }
      bassNodes = null;
    }
  }

  // Glides the pad + bass to the current chord's root rather than
  // re-triggering them, so chord changes feel like the harmony shifting
  // underfoot instead of a new note starting.
  function retargetPadToChord(theme) {
    if (!padNodes || !bassNodes) return;
    const now = ctx.currentTime;
    const chord = chordOffset(theme, songTimeMs());
    const padFreq = midiToFreq(theme.root + chord - 12);
    const bassFreq = midiToFreq(theme.root + chord - 24);
    [padNodes.osc1, padNodes.osc2].forEach((osc) => {
      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setTargetAtTime(padFreq, now, 2.2);
    });
    bassNodes.bassOsc.frequency.cancelScheduledValues(now);
    bassNodes.bassOsc.frequency.setTargetAtTime(bassFreq, now, 2.2);
  }

  // One plucked note: fast attack, exponential decay, through a lowpass so
  // it's soft rather than buzzy. Sends part of its signal into the shared
  // echo bus. `sendToDelay` controls how much (lead melody sends more than
  // the sparser counter-melody, which is already quieter/higher).
  function pluck(theme, freq, time, velocity, gainMul, sendToDelay) {
    const osc = ctx.createOscillator();
    osc.type = theme.wave;
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = theme.filterHz;
    filter.Q.value = 0.7;

    const env = ctx.createGain();
    const peak = theme.gain * velocity * gainMul;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0008, time + theme.noteMs / 1000);

    const sendGain = ctx.createGain();
    sendGain.gain.value = sendToDelay;

    osc.connect(filter);
    filter.connect(env);
    env.connect(musicGain);
    env.connect(sendGain);
    sendGain.connect(delayBus);

    osc.start(time);
    osc.stop(time + theme.noteMs / 1000 + 0.05);
  }

  // Rare high, soft "shimmer" — a single quiet bell-like tone with a long
  // release, well above the lead melody's register. Adds air/complexity
  // without adding busyness, since it fires only occasionally.
  function shimmer(theme, time) {
    const degree = theme.scale[Math.floor(Math.random() * theme.scale.length)];
    const freq = midiToFreq(theme.root + degree + 24);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = theme.filterHz * 1.4;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(theme.gain * 0.16, time + 0.05);
    env.gain.exponentialRampToValueAtTime(0.0006, time + theme.noteMs / 1000 + 1.6);

    const sendGain = ctx.createGain();
    sendGain.gain.value = 0.35;

    osc.connect(filter);
    filter.connect(env);
    env.connect(musicGain);
    env.connect(sendGain);
    sendGain.connect(delayBus);

    osc.start(time);
    osc.stop(time + theme.noteMs / 1000 + 1.8);
  }

  // Biased random walk across the theme's scale degrees, so each melodic
  // voice wanders instead of jumping around or repeating a fixed loop.
  // Position persists across page loads (see WALK_KEY) so the contour
  // continues rather than restarting from degree zero every navigation.
  function stepWalk(theme, pos) {
    const len = theme.scale.length;
    const r = Math.random();
    if (r < 0.45) pos += 1;
    else if (r < 0.75) pos -= 1;
    else if (r < 0.85) pos += 2;
    else if (r < 0.95) pos -= 2;
    // else: stay — a repeated note now and then reads as intentional
    if (pos < 0) pos = 0;
    if (pos >= len) pos = len - 1;
    return pos;
  }

  function scheduleLoop() {
    if (!running) return;
    const theme = currentTheme();
    const now = ctx.currentTime;
    const chord = chordOffset(theme, songTimeMs());

    // Lead voice — not every tick plays a note; occasional rests keep it
    // from feeling like a busy, mechanical arpeggio.
    if (Math.random() > 0.18) {
      walk.lead = stepWalk(theme, walk.lead);
      const degree = theme.scale[walk.lead];
      const octaveUp = Math.random() < 0.15 ? 12 : 0;
      const freq = midiToFreq(theme.root + chord + degree + octaveUp);
      const velocity = 0.7 + Math.random() * 0.3;
      pluck(theme, freq, now + 0.02, velocity, 1, 0.28);
    }

    // Sparser high counter-melody, roughly a third of the density of the
    // lead, an octave+ up and quieter — this is what gives the loop its
    // "more than one thing happening" complexity without crowding the mix.
    if (Math.random() > 0.72) {
      walk.counter = stepWalk(theme, walk.counter);
      const degree = theme.scale[walk.counter];
      const freq = midiToFreq(theme.root + chord + degree + 19);
      pluck(theme, freq, now + 0.05, 0.55 + Math.random() * 0.25, 0.55, 0.4);
    }

    // Very rare shimmer on top.
    if (Math.random() > 0.94) {
      shimmer(theme, now + 0.08);
    }

    saveWalkState(walk);

    const jitter = theme.noteMs * (0.85 + Math.random() * 0.3);
    schedulerId = setTimeout(scheduleLoop, jitter);
  }

  // Watches the shared song clock and glides the pad/bass to a new chord
  // whenever the progression advances, independent of the note scheduler's
  // own (unrelated) timing jitter.
  function scheduleChordWatch() {
    if (!running) return;
    retargetPadToChord(currentTheme());
    chordTimerId = setTimeout(scheduleChordWatch, 1000);
  }

  function startMusic() {
    if (!ensureContext()) return;
    if (ctx.state === "suspended") ctx.resume();
    if (running) return;
    running = true;
    walk = loadWalkState();
    startPad(currentTheme());
    scheduleLoop();
    scheduleChordWatch();
  }

  function stopMusic() {
    running = false;
    if (schedulerId) {
      clearTimeout(schedulerId);
      schedulerId = null;
    }
    if (chordTimerId) {
      clearTimeout(chordTimerId);
      chordTimerId = null;
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

  // --- Analyser access, for other widgets (mouse glow) --------------------
  // Returns a single 0..1 level for the whole music bus (RMS-ish over the
  // current time-domain buffer). Cheap enough to poll every animation
  // frame. Returns 0 if music isn't currently playing.
  function getLevel() {
    if (!analyser || !running || !ctx || ctx.state !== "running") return 0;
    analyser.getByteTimeDomainData(analyserData);
    let sumSquares = 0;
    for (let i = 0; i < analyserData.length; i++) {
      const v = (analyserData[i] - 128) / 128;
      sumSquares += v * v;
    }
    return Math.min(1, Math.sqrt(sumSquares / analyserData.length) * 3.2);
  }

  // Coarse low/high split of the same buffer via frequency data — used to
  // give the glow a bit more character than a single flat pulse (e.g. bass
  // driving size, treble driving hue drift).
  const freqData = { arr: null };
  function getBandLevels() {
    if (!analyser || !running || !ctx || ctx.state !== "running") return { low: 0, high: 0 };
    if (!freqData.arr) freqData.arr = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData.arr);
    const n = freqData.arr.length;
    const split = Math.floor(n * 0.25);
    let low = 0;
    let high = 0;
    for (let i = 0; i < split; i++) low += freqData.arr[i];
    for (let i = split; i < n; i++) high += freqData.arr[i];
    low = low / (split * 255);
    high = high / ((n - split) * 255);
    return { low, high };
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

    // Click SFX itself is triggered from mouse-glow.js's single site-wide
    // click listener (via window.SiteAudio.playClick()), so the sound and
    // the on-screen click disturbance always fire together instead of from
    // two separate listeners that could drift out of sync.
  });

  // Exposed for other widgets (the mouse glow, for instance) to sync to the
  // music without re-implementing any Web Audio plumbing themselves.
  window.SiteAudio = {
    isEnabled,
    isRunning: () => running && !!ctx && ctx.state === "running",
    getLevel,
    getBandLevels,
    playClick,
  };
})();
