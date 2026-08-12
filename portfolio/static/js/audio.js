// --- Procedural, generative background music + a click sound effect -------
// No audio files anywhere — everything is synthesized live with the Web
// Audio API. On by default — a small toggle button mutes it, and the choice
// is remembered across page loads via localStorage since every navigation
// here is a real page load, not a client-side route change.
//
// Each page gets its own theme (scale, tempo, register, chord progression)
// so navigating the site feels like moving between different spaces. Every
// theme is built from the same layered engine — a detuned pad, a sub-bass
// voice, a lead arpeggio, a sparser high counter-melody, a soft echo bus,
// a rhythmic pulse layer, and an occasional shimmer — just retuned per
// page, so it stays one coherent "sound" throughout the site.
//
// "Continuous across pages": since navigation here is a real page load, the
// AudioContext itself can't literally survive it — but the *music* isn't
// meant to restart from bar one every time you click a link. A single song
// clock (`songStartedAt`, sessionStorage-backed so it survives reloads but
// resets when the tab/session ends) keeps advancing across every page in
// this tab. Chord progression, melodic wander position, and the "section"
// (see currentSection() below — the calm/build/peak/release cycle that
// drives mood and pacing, not just tone) are all derived from that shared
// clock rather than reset per page, so leaving Home for Projects mid-phrase
// and coming back later resumes roughly where the piece "would" be.
//
// On top of that, the pad doesn't fade in from silence on every page like
// it used to — it remembers the last chord it was voicing (LAST_VOICE_KEY,
// sessionStorage) and glides from there into the new page's theme over a
// couple of seconds, so navigating genuinely sounds like one continuous
// piece drifting into a new melody/mood rather than one loop stopping and
// a different one starting cold.
//
// Autoplay: browsers block audio-with-sound before any user gesture on an
// origin, and that's not something a site can (or should try to) bypass.
// What we *can* do: try to start immediately on load (many browsers allow
// this once you've interacted with the site once before, since that
// permission is remembered per-origin, not per-page) and, failing that,
// treat the very first interaction of *any* kind anywhere on the page —
// not just a click on the toggle — as the cue to start, so in practice one
// click anywhere is enough to have music running from then on, including
// across future navigations.
(function () {
  "use strict";

  const STORAGE_KEY = "site-audio-enabled";
  const VOLUME_KEY = "site-audio-volume";
  const SONG_START_KEY = "site-audio-song-start"; // sessionStorage: ms epoch
  const WALK_KEY = "site-audio-walk-state"; // sessionStorage: JSON {lead, counter}
  const LAST_VOICE_KEY = "site-audio-last-voice"; // sessionStorage: JSON {theme, atMs}

  function isEnabled() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === null) return true; // on by default
      return v === "1";
    } catch (e) {
      return true;
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

  // What the pad/bass were last voicing (which theme, and at what point on
  // the shared song clock) — read by the *next* page so its pad can glide
  // in from that chord instead of fading up from silence. Written every
  // time the pad (re)starts, so it always reflects "the last page that had
  // music running," even across several navigations.
  function loadLastVoice() {
    try {
      const raw = sessionStorage.getItem(LAST_VOICE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.theme !== "string" || !THEMES[parsed.theme]) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }
  function saveLastVoice(themeKey) {
    try {
      sessionStorage.setItem(LAST_VOICE_KEY, JSON.stringify({ theme: themeKey, atMs: songTimeMs() }));
    } catch (e) {
      /* ignore */
    }
  }

  // --- Mood/pacing sections ---------------------------------------------
  // A slow four-phase cycle (calm -> building -> peak -> release) driven by
  // the same shared song clock as everything else, so it advances across
  // page loads instead of resetting. This is what varies mood and pacing
  // rather than just tone: it scales note density, tempo, overall energy,
  // and how often the counter-melody/shimmer/pulse layers get to speak.
  const SECTION_CYCLE_MS = 96000; // one full calm->peak->release lap
  const SECTIONS = [
    // [fraction of cycle where this section ends, definition]
    { end: 0.28, name: "calm", density: 0.72, tempo: 1.18, gain: 0.82, pulse: 0.5 },
    { end: 0.55, name: "building", density: 0.92, tempo: 1.04, gain: 0.94, pulse: 0.85 },
    { end: 0.8, name: "peak", density: 1.15, tempo: 0.88, gain: 1.12, pulse: 1.15 },
    { end: 1.0, name: "release", density: 0.85, tempo: 1.1, gain: 0.9, pulse: 0.7 },
  ];
  function currentSection() {
    const frac = (songTimeMs() % SECTION_CYCLE_MS) / SECTION_CYCLE_MS;
    for (const s of SECTIONS) {
      if (frac <= s.end) return s;
    }
    return SECTIONS[SECTIONS.length - 1];
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
  let pulseTimerId = null;
  let pulseGain = null;

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
  function startPad(theme, themeKey) {
    const now = ctx.currentTime;
    const chord = chordOffset(theme, songTimeMs());
    const targetPadFreq = midiToFreq(theme.root + chord - 12);
    const targetBassFreq = midiToFreq(theme.root + chord - 24);

    // If another page in this tab was already voicing a chord, start there
    // and glide into this page's theme instead of fading up from silence —
    // this is the "flows into a different tune" transition rather than a
    // hard cut between unrelated loops.
    const lastVoice = loadLastVoice();
    let startPadFreq = targetPadFreq;
    let startBassFreq = targetBassFreq;
    let glide = false;
    if (lastVoice && lastVoice.theme !== themeKey) {
      const prevTheme = THEMES[lastVoice.theme];
      const prevChord = chordOffset(prevTheme, lastVoice.atMs);
      startPadFreq = midiToFreq(prevTheme.root + prevChord - 12);
      startBassFreq = midiToFreq(prevTheme.root + prevChord - 24);
      glide = true;
    }

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = theme.padWave;
    osc2.type = theme.padWave;
    osc1.frequency.value = startPadFreq;
    osc2.frequency.value = startPadFreq;
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

    if (glide) {
      // Continuing a piece already in progress: glide from the previous
      // page's chord into this one, and only need a short volume lift
      // since the pad isn't starting from true silence conceptually.
      osc1.frequency.setTargetAtTime(targetPadFreq, now, 1.1);
      osc2.frequency.setTargetAtTime(targetPadFreq, now, 1.1);
      padEnv.gain.linearRampToValueAtTime(theme.gain * 0.22, now + 0.6);
    } else {
      // First music of the session (or resuming after being muted) — fade
      // up from silence like before.
      padEnv.gain.linearRampToValueAtTime(theme.gain * 0.22, now + 1.4);
    }

    padNodes = { osc1, osc2, filter, lfo, lfoGain, padEnv };

    // Sub-bass voice: one octave further down, sine only (keeps it clean,
    // felt more than heard), gives the pad an actual low end.
    const bassOsc = ctx.createOscillator();
    bassOsc.type = "sine";
    bassOsc.frequency.value = startBassFreq;

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = "lowpass";
    bassFilter.frequency.value = 400;

    const bassEnv = ctx.createGain();
    bassEnv.gain.value = 0;

    bassOsc.connect(bassFilter);
    bassFilter.connect(bassEnv);
    bassEnv.connect(musicGain);

    bassOsc.start(now);
    if (glide) {
      bassOsc.frequency.setTargetAtTime(targetBassFreq, now, 1.1);
      bassEnv.gain.linearRampToValueAtTime(theme.gain * 0.3, now + 0.6);
    } else {
      bassEnv.gain.linearRampToValueAtTime(theme.gain * 0.3, now + 1.6);
    }

    bassNodes = { bassOsc, bassFilter, bassEnv };

    saveLastVoice(themeKey);

    startPulse(theme);
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
    if (pulseGain) {
      try {
        pulseGain.disconnect();
      } catch (e) {
        /* already gone */
      }
      pulseGain = null;
    }
  }

  // --- Rhythmic pulse layer ----------------------------------------------
  // A soft, low, heartbeat-like thump under everything else — this is a lot
  // of what makes the loop read as "a piece of music with a pulse" rather
  // than an ambient drone with notes sprinkled on top. Tempo and intensity
  // both track the current mood section (see currentSection() above), so
  // pacing genuinely shifts over time instead of just tone.
  function pulseBeat(theme) {
    if (!running || !ctx) return;
    const section = currentSection();
    const now = ctx.currentTime;
    const chord = chordOffset(theme, songTimeMs());
    const freq = midiToFreq(theme.root + chord - 24);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 2, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.09);

    const env = ctx.createGain();
    const peak = theme.gain * 0.16 * section.pulse;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0006, now + 0.32);

    osc.connect(env);
    env.connect(musicGain);
    osc.start(now);
    osc.stop(now + 0.34);

    // Occasional soft off-beat ghost note — pacing detail rather than a
    // mechanical metronome.
    if (Math.random() < 0.3 * section.pulse) {
      const ghost = ctx.createOscillator();
      ghost.type = "sine";
      ghost.frequency.value = freq * 1.5;
      const gEnv = ctx.createGain();
      gEnv.gain.setValueAtTime(0, now + 0.16);
      gEnv.gain.linearRampToValueAtTime(peak * 0.4, now + 0.17);
      gEnv.gain.exponentialRampToValueAtTime(0.0005, now + 0.4);
      ghost.connect(gEnv);
      gEnv.connect(musicGain);
      ghost.start(now + 0.16);
      ghost.stop(now + 0.42);
    }
  }

  function startPulse(theme) {
    if (pulseTimerId) clearTimeout(pulseTimerId);
    function loop() {
      if (!running) return;
      const section = currentSection();
      pulseBeat(currentTheme());
      const base = theme.chordMs / 4; // roughly one thump per quarter-chord
      const interval = base / section.tempo;
      pulseTimerId = setTimeout(loop, interval);
    }
    loop();
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
    const section = currentSection();
    const now = ctx.currentTime;
    const chord = chordOffset(theme, songTimeMs());

    // Lead voice — not every tick plays a note; occasional rests keep it
    // from feeling like a busy, mechanical arpeggio. Rest probability and
    // velocity both track the current mood section, so a "calm" stretch
    // genuinely plays sparser/softer than a "peak" one, not just quieter.
    const leadPlayChance = 1 - 0.18 / section.density;
    if (Math.random() < leadPlayChance) {
      walk.lead = stepWalk(theme, walk.lead);
      const degree = theme.scale[walk.lead];
      const octaveUp = Math.random() < 0.15 ? 12 : 0;
      const freq = midiToFreq(theme.root + chord + degree + octaveUp);
      const velocity = (0.7 + Math.random() * 0.3) * section.gain;
      pluck(theme, freq, now + 0.02, velocity, 1, 0.28);
    }

    // Sparser high counter-melody, roughly a third of the density of the
    // lead, an octave+ up and quieter — this is what gives the loop its
    // "more than one thing happening" complexity without crowding the mix.
    const counterPlayChance = 0.28 * section.density;
    if (Math.random() < counterPlayChance) {
      walk.counter = stepWalk(theme, walk.counter);
      const degree = theme.scale[walk.counter];
      const freq = midiToFreq(theme.root + chord + degree + 19);
      pluck(theme, freq, now + 0.05, (0.55 + Math.random() * 0.25) * section.gain, 0.55, 0.4);
    }

    // Rare shimmer on top — more likely to show up once things are
    // building toward a peak than during a calm stretch.
    if (Math.random() < 0.06 * section.density) {
      shimmer(theme, now + 0.08);
    }

    saveWalkState(walk);

    const jitter = (theme.noteMs / section.tempo) * (0.85 + Math.random() * 0.3);
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
    const themeKey = (document.body && document.body.dataset.page) || "default";
    startPad(currentTheme(), THEMES[themeKey] ? themeKey : "default");
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
    if (pulseTimerId) {
      clearTimeout(pulseTimerId);
      pulseTimerId = null;
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

  // Downsampled frequency spectrum for the background visualizer — buckets
  // the analyser's frequency bins into `bars` averaged values (0-1 each).
  //
  // Mapped on a log/octave frequency scale rather than linear bins: this
  // synth's music lives almost entirely below ~2-3kHz (bass/pad/lead), so
  // a linear split (each bar = an equal slice of 0Hz-Nyquist) dumps nearly
  // all of the audible content into the first handful of bars and leaves
  // the rest of the bar array reading silence — a visibly flat line on one
  // side. Spacing bars by equal frequency *ratio* instead (equal-width
  // octaves, same idea real audio visualizers use) spreads that same
  // content across the whole width, and caps out at a frequency ceiling
  // this music actually reaches rather than the full Nyquist range.
  function getSpectrum(bars) {
    const n = bars || 32;
    if (!analyser || !running || !ctx || ctx.state !== "running") return new Array(n).fill(0);
    if (!freqData.arr) freqData.arr = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData.arr);

    const totalBins = freqData.arr.length;
    const sampleRate = ctx.sampleRate || 44100;
    const nyquist = sampleRate / 2;
    const minFreq = 40;
    const maxFreq = Math.min(nyquist, 6000); // this music has ~nothing above here
    const binHz = nyquist / totalBins;
    const freqToBin = (f) => Math.min(totalBins - 1, Math.max(0, Math.round(f / binHz)));

    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      // Equal-ratio (log) spacing: bar i's frequency = minFreq * (maxFreq/minFreq)^(i/n)
      const f0 = minFreq * Math.pow(maxFreq / minFreq, i / n);
      const f1 = minFreq * Math.pow(maxFreq / minFreq, (i + 1) / n);
      const start = freqToBin(f0);
      const end = Math.max(start + 1, freqToBin(f1));
      let sum = 0;
      for (let j = start; j < end; j++) sum += freqData.arr[j];
      out[i] = sum / ((end - start) * 255);
    }
    return out;
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
      attemptAutoStart();
    }

    // Click SFX itself is triggered from mouse-glow.js's single site-wide
    // click listener (via window.SiteAudio.playClick()), so the sound and
    // the on-screen click disturbance always fire together instead of from
    // two separate listeners that could drift out of sync.
  });

  // Browsers refuse to let a page start audible sound before the person has
  // interacted with the *browser tab* in some way — that's a deliberate,
  // universal anti-annoyance rule (Chrome, Firefox, and Safari all enforce
  // it) and no page-side trick actually bypasses it, so "truly zero
  // interaction, ever" isn't achievable here. What this does do:
  //   - tries to start immediately on every page, which succeeds outright
  //     in the (common, after the very first visit) case where the browser
  //     has already granted this origin audio permission — Chrome and
  //     Firefox both remember "this site has been interacted with" for the
  //     rest of the browsing session, not just for the current page, so in
  //     practice one click anywhere on the very first page is enough for
  //     every later page/navigation to just start playing with no click at
  //     all.
  //   - if still blocked, arms a one-time listener on pointerdown/keydown/
  //     touchstart/wheel — not just a click on the toggle button — so any
  //     interaction anywhere unlocks it.
  //   - shows a small, honest "tap to start music" pill (see below) only
  //     while genuinely blocked, so the requirement is visible/explained
  //     instead of silently doing nothing.
  function attemptAutoStart() {
    ensureContext();
    startMusic();
    if (ctx && ctx.state === "running") return; // unblocked already — done

    showUnlockHint();
    const resumeOnce = () => {
      if (ctx && ctx.state === "suspended") ctx.resume();
      if (!running) startMusic();
      hideUnlockHint();
      events.forEach((ev) => document.removeEventListener(ev, resumeOnce));
    };
    const events = ["pointerdown", "keydown", "touchstart", "wheel"];
    events.forEach((ev) => document.addEventListener(ev, resumeOnce, { once: true, passive: true }));
  }

  // Pages restored from the browser's back/forward cache (bfcache) don't
  // re-fire DOMContentLoaded, and a backgrounded AudioContext is sometimes
  // auto-suspended by the browser on the way in/out — this catches both by
  // re-checking on pageshow.
  window.addEventListener("pageshow", (e) => {
    if (!isEnabled()) return;
    if (e.persisted && (!ctx || ctx.state !== "running")) {
      attemptAutoStart();
    }
  });

  let unlockHintEl = null;
  function showUnlockHint() {
    if (unlockHintEl || !document.body) return;
    const el = document.createElement("div");
    el.id = "audio-unlock-hint";
    el.textContent = "Tap anywhere for music";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
    unlockHintEl = el;
    // Don't nag forever if it's genuinely never going to be tapped.
    setTimeout(hideUnlockHint, 8000);
  }
  function hideUnlockHint() {
    if (!unlockHintEl) return;
    unlockHintEl.classList.add("is-leaving");
    const el = unlockHintEl;
    unlockHintEl = null;
    setTimeout(() => el.remove(), 400);
  }

  // Exposed for other widgets (the mouse glow, for instance) to sync to the
  // music without re-implementing any Web Audio plumbing themselves.
  window.SiteAudio = {
    isEnabled,
    isRunning: () => running && !!ctx && ctx.state === "running",
    getLevel,
    getBandLevels,
    getSpectrum,
    playClick,
  };
})();
