// --- Procedural, generative background music + a click sound effect -------
// No audio files anywhere — everything is synthesized live with the Web
// Audio API. On by default — a small toggle button mutes it, and the choice
// is remembered across page loads via localStorage since every navigation
// here is a real page load, not a client-side route change.
//
// Each page gets its own theme (scale, tempo, register, chord progression,
// rhythmic feel) so navigating the site feels like moving between distinct
// spaces, not just a retuned copy of the same loop. Every theme is built
// from the same layered engine, covering the four things real music is
// usually layered from — rhythm (pulse + hi-hat), bass (a sustained sub
// plus a walking bass pluck), harmony (a pad plus a patterned arpeggio),
// and melody (a wandering lead plus a sparser counter-melody, with an
// occasional shimmer on top) — just voiced, timed, and patterned
// differently per page.
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

  // --- Emergent motif memory ----------------------------------------------
  // This is the actual "recognizable, structured, but never hand-authored"
  // system: rather than one fixed hardcoded phrase per page, each theme
  // grows its own bank of short motifs (arrays of scale-degree indices)
  // captured live from whatever the lead voice actually happened to play
  // whenever it resolves onto a chord tone — nothing here is composed in
  // advance. Once a phrase is captured it can resurface again later at a
  // future chord change, so over a session you genuinely start recognizing
  // "oh, that little run again" — except it's not a loop, it's the piece
  // remembering itself. Persisted per theme in sessionStorage so the bank
  // (aiming for 5+ distinct entries per page) keeps growing the longer
  // someone browses, rather than resetting on every navigation.
  const MOTIF_BANK_KEY = "site-audio-motif-bank";
  const MOTIF_BANK_MAX = 8;
  const MOTIF_MIN_LEN = 3;
  const MOTIF_MAX_LEN = 5;

  let motifBanksCache = null;
  function loadMotifBanks() {
    if (motifBanksCache) return motifBanksCache;
    try {
      const raw = sessionStorage.getItem(MOTIF_BANK_KEY);
      motifBanksCache = raw ? JSON.parse(raw) : {};
    } catch (e) {
      motifBanksCache = {};
    }
    return motifBanksCache;
  }
  function saveMotifBanks() {
    try {
      sessionStorage.setItem(MOTIF_BANK_KEY, JSON.stringify(motifBanksCache || {}));
    } catch (e) {
      /* ignore */
    }
  }
  // Every theme starts with its small hardcoded `motif` as a single seed
  // entry (so there's *some* structure in the first few seconds of a
  // session) — everything added after that is captured live from the
  // theme's own generated material.
  function getMotifBank(themeKey) {
    const banks = loadMotifBanks();
    if (!banks[themeKey]) {
      const seed = THEMES[themeKey] && THEMES[themeKey].motif;
      banks[themeKey] = seed ? [seed.slice()] : [];
    }
    return banks[themeKey];
  }
  function captureMotif(themeKey, phrase) {
    if (!phrase || phrase.length < MOTIF_MIN_LEN) return;
    const distinct = new Set(phrase).size;
    if (distinct < 2) return; // a run of one repeated note isn't a motif
    const bank = getMotifBank(themeKey);
    const key = phrase.join(",");
    if (bank.some((m) => m.join(",") === key)) return; // no exact dupes
    bank.push(phrase.slice());
    if (bank.length > MOTIF_BANK_MAX) bank.shift();
    saveMotifBanks();
  }
  function pickMotif(themeKey) {
    const bank = getMotifBank(themeKey);
    if (!bank.length) return null;
    return bank[Math.floor(Math.random() * bank.length)].slice();
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
  // `scale` is a set of semitone offsets from `root` (MIDI note number) —
  // this is the theme's fixed key, and it never moves. `progression` used
  // to be raw semitone offsets applied on top of the melody, which meant
  // every chord change silently transposed the whole scale to a new,
  // unrelated pitch center — the actual bug behind the dissonance. Now
  // `progression` is a list of INDICES INTO `scale`: each entry names
  // which scale degree is the current chord's root, which guarantees the
  // chord (and everything built on it — pad, bass, pulse) is always a
  // note that already belongs to the key. The melody itself is read
  // straight off `scale` too (see scheduleLoop), so voice and harmony can
  // never drift out of tune with each other — only *which* scale degree
  // is the tonal center of gravity changes.
  //
  // `motif` is a short SEED phrase only — just enough structure to sound
  // intentional in the first few seconds of a session. It is not the real
  // "recognizable pattern" system: see the motif bank below, which grows
  // its own patterns from what the lead voice actually plays (nothing
  // else here is hand-authored beyond this bootstrap seed).
  //
  //   `swing`      — 0 = dead straight, higher = notes lean off the grid
  //                  (a groove/shuffle feel), applied uniformly across
  //                  every layer's off-grid positions so nothing drifts
  //                  out of phase with anything else.
  //   `arpPattern` — how the comping/arpeggio layer moves through the
  //                  current chord's tones: "up", "down", "updown", or
  //                  "random".
  //   `arpWave`/`arpMs`/`arpGain` — the comping layer's own timbre, note
  //                  length, and level, independent of the lead.
  //   `bassPattern`— a short cycle of chord-tone-triad positions (0/1/2)
  //                  the walking-bass layer steps through.
  //   `bassMs`     — that layer's note length.
  //   `hatDensity` — how busy the percussive hi-hat texture is.
  //   `echoWet`    — per-theme send level into the shared delay bus.
  //
  //   `beatMs` is the one shared subdivision every layer's timing is now a
  //   whole-number multiple of (`leadDiv`, `counterDiv`, `arpDiv`,
  //   `bassDiv`/`bassPhase`, `hatDiv`, `pulseDiv`) — see startClock() below.
  //   Previously each layer ran on its own independent timer with its own
  //   random jitter, so they'd slowly drift in and out of phase with each
  //   other; that drift (not the melody itself) was most of what read as
  //   "out of sync." Locking every layer to exact multiples of one grid
  //   removes that source of chaos entirely, while the *ratios* between
  //   the multiples (3-against-4, 6-against-9, etc.) are what give each
  //   page its own rhythmic personality without ever losing sync.
  const THEMES = {
    home: {
      root: 57, // A3 — bright, welcoming, pop-simple
      scale: [0, 2, 4, 7, 9, 12, 14, 16], // major pentatonic + octave, extra color tones
      progression: [0, 3, 5, 4], // chord roots as scale-degree indices — always in-key
      motif: [0, 2, 1, 4, 2],
      chordMs: 9000,
      noteMs: 480,
      filterHz: 1800,
      wave: "triangle",
      padWave: "sine",
      gain: 0.5,
      swing: 0.05,
      arpPattern: "up",
      arpWave: "triangle",
      arpMs: 240,
      arpGain: 0.5,
      bassPattern: [0, 0, 1, 0],
      bassMs: 480,
      hatDensity: 0.5,
      echoWet: 1.0,
      beatMs: 140,
      hatDiv: 1,
      arpDiv: 2,
      leadDiv: 4,
      counterDiv: 6,
      bassDiv: 4,
      bassPhase: 2,
      pulseDiv: 16,
    },
    projects: {
      root: 55, // G3 — driven, purposeful, syncopated
      scale: [0, 3, 5, 7, 10, 12, 15, 17], // minor pentatonic-ish, some tension
      progression: [0, 4, 2, 6],
      motif: [0, 1, 3, 2],
      chordMs: 7000,
      noteMs: 270,
      filterHz: 2200,
      wave: "sawtooth",
      padWave: "triangle",
      gain: 0.4,
      swing: 0.22,
      arpPattern: "updown",
      arpWave: "sawtooth",
      arpMs: 180,
      arpGain: 0.42,
      bassPattern: [0, 1, 0, 2],
      bassMs: 520,
      hatDensity: 0.75,
      echoWet: 0.6,
      beatMs: 105,
      hatDiv: 1,
      arpDiv: 2,
      leadDiv: 3,
      counterDiv: 5,
      bassDiv: 6,
      bassPhase: 3,
      pulseDiv: 12,
    },
    skills: {
      root: 60, // C4 — airy, spacious, unhurried
      scale: [0, 2, 5, 7, 9, 14, 16, 19], // lydian-leaning, open
      progression: [0, 4, 2, 5],
      motif: [0, 3, 4, 1, 3],
      chordMs: 10000,
      noteMs: 1150,
      filterHz: 1500,
      wave: "sine",
      padWave: "sine",
      gain: 0.45,
      swing: 0,
      arpPattern: "random",
      arpWave: "sine",
      arpMs: 580,
      arpGain: 0.34,
      bassPattern: [0, 0, 0, 1],
      bassMs: 1500,
      hatDensity: 0.22,
      echoWet: 1.7,
      beatMs: 230,
      hatDiv: 2,
      arpDiv: 3,
      leadDiv: 6,
      counterDiv: 9,
      bassDiv: 8,
      bassPhase: 4,
      pulseDiv: 24,
    },
    certifications: {
      root: 48, // C3 — low, stately, formal, unhurried
      scale: [0, 4, 7, 11, 12, 16, 19], // major 7th flavor, resolved
      progression: [0, 3, 1, 4],
      motif: [0, 2, 3, 1],
      chordMs: 11000,
      noteMs: 1450,
      filterHz: 1200,
      wave: "triangle",
      padWave: "sine",
      gain: 0.42,
      swing: 0.12,
      arpPattern: "down",
      arpWave: "triangle",
      arpMs: 740,
      arpGain: 0.4,
      bassPattern: [0, 2, 1, 0],
      bassMs: 1450,
      hatDensity: 0.15,
      echoWet: 1.35,
      beatMs: 220,
      hatDiv: 4,
      arpDiv: 4,
      leadDiv: 8,
      counterDiv: 12,
      bassDiv: 8,
      bassPhase: 4,
      pulseDiv: 32,
    },
    about: {
      root: 52, // E3 — warm, reflective, gently human
      scale: [0, 2, 3, 7, 9, 10, 12, 15], // minor pentatonic + passing tones
      progression: [0, 3, 2, 5],
      motif: [0, 2, 3, 1, 4],
      chordMs: 9500,
      noteMs: 860,
      filterHz: 1400,
      wave: "sine",
      padWave: "triangle",
      gain: 0.45,
      swing: 0.16,
      arpPattern: "updown",
      arpWave: "sine",
      arpMs: 430,
      arpGain: 0.38,
      bassPattern: [0, 0, 2, 1],
      bassMs: 860,
      hatDensity: 0.32,
      echoWet: 1.2,
      beatMs: 170,
      hatDiv: 2,
      arpDiv: 3,
      leadDiv: 6,
      counterDiv: 9,
      bassDiv: 6,
      bassPhase: 3,
      pulseDiv: 24,
    },
    default: {
      root: 55,
      scale: [0, 2, 4, 7, 9, 12],
      progression: [0, 3, 1, 4],
      motif: [0, 1, 3, 2],
      chordMs: 8000,
      noteMs: 860,
      filterHz: 1700,
      wave: "triangle",
      padWave: "sine",
      gain: 0.4,
      swing: 0.1,
      arpPattern: "up",
      arpWave: "triangle",
      arpMs: 430,
      arpGain: 0.4,
      bassPattern: [0, 0, 1, 0],
      bassMs: 860,
      hatDensity: 0.4,
      echoWet: 1.0,
      beatMs: 170,
      hatDiv: 2,
      arpDiv: 3,
      leadDiv: 6,
      counterDiv: 9,
      bassDiv: 6,
      bassPhase: 3,
      pulseDiv: 24,
    },
  };

  // How strongly pad/bass are pulled up vs. the lead, so the "continuous"
  // layer is actually audible at a normal volume instead of buried.
  const PAD_GAIN_MULT = 0.42; // was 0.22
  const BASS_GAIN_MULT = 0.48; // was 0.3

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
  let chordTimerId = null;
  let padNodes = null;
  let bassNodes = null;
  let delayBus = null;
  let walk = { lead: 0, counter: 0 };
  let pulseGain = null;
  let noiseBuffer = null;

  // --- Shared rhythmic grid ------------------------------------------------
  // A single beat counter/clock every layer's timing is derived from — see
  // startClock()/fireBeat() further down. Replaces what used to be five
  // independent setTimeout loops (lead+counter, pulse, arp, bass, hats),
  // each with its own random jitter, which is what let them drift out of
  // phase with each other over time.
  let clockTimerId = null;
  let clockNextTime = 0; // ctx.currentTime for the next beat
  let clockBeatNum = 0;

  // Tracks the last note each melodic layer actually played (MIDI note
  // number), so a new note can be nudged away from forming a harsh
  // clash (minor 2nd / tritone) with whatever's still ringing.
  let lastLeadMidi = null;
  let lastCounterMidi = null;

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

    // A short buffer of white noise, generated once and reused (looped)
    // for the hi-hat/percussion-texture layer — Web Audio has no built-in
    // noise source, so this is the standard way to make one.
    const noiseSeconds = 1;
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * noiseSeconds, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

    return ctx;
  }

  function currentTheme() {
    const key = (document.body && document.body.dataset.page) || "default";
    return THEMES[key] || THEMES.default;
  }

  // Which scale-degree index is the current chord's root. Always a valid
  // index into theme.scale, so the chord can never fall outside the key.
  function chordIndex(theme, atMs) {
    const prog = theme.progression && theme.progression.length ? theme.progression : [0];
    const idx = Math.floor(atMs / theme.chordMs) % prog.length;
    const raw = prog[(idx + prog.length) % prog.length];
    return ((raw % theme.scale.length) + theme.scale.length) % theme.scale.length;
  }

  // The chord root resolved to an actual semitone offset from `root` — for
  // the pad/bass/pulse, which just need "how far up from the root," not
  // the scale-index itself.
  function chordOffset(theme, atMs) {
    return theme.scale[chordIndex(theme, atMs)];
  }

  // A rough diatonic triad for the current chord, expressed as scale-index
  // positions (root + two stacked "thirds" within the scale, wrapping).
  // This is what the melodic walk gravitates toward — the harmonic anchor
  // that was missing before, since chord tones now come from the same
  // fixed scale the melody already lives in.
  function chordToneIndices(theme, idx) {
    const len = theme.scale.length;
    return [idx, (idx + 2) % len, (idx + 4) % len];
  }

  // --- Pad: two detuned oscillators + a sub-bass voice, both through slow
  // filter LFOs, both retargeted (glided, not re-triggered) whenever the
  // chord progression moves to its next chord. Runs continuously while
  // music is on.
  //
  // Always starts directly at its own theme's target pitch and just fades
  // gain up from silence — no more borrowing the previous page's chord
  // frequency and sliding into this one. That cross-theme portamento (often
  // spanning a different root note entirely) was the "zooming" sweep on
  // every navigation; a plain fade-in reads as a page starting cleanly
  // instead.
  function startPad(theme, themeKey) {
    const now = ctx.currentTime;
    const chord = chordOffset(theme, songTimeMs());
    const targetPadFreq = midiToFreq(theme.root + chord - 12);
    const targetBassFreq = midiToFreq(theme.root + chord - 24);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = theme.padWave;
    osc2.type = theme.padWave;
    osc1.frequency.value = targetPadFreq;
    osc2.frequency.value = targetPadFreq;
    osc2.detune.value = 9; // slight beating between the two, for warmth

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = theme.filterHz * 0.7; // was *0.5 — more presence, less buried
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

    padEnv.gain.linearRampToValueAtTime(theme.gain * PAD_GAIN_MULT, now + 1.4);

    padNodes = { osc1, osc2, filter, lfo, lfoGain, padEnv };

    // Sub-bass voice: one octave further down, sine only (keeps it clean,
    // felt more than heard), gives the pad an actual low end.
    const bassOsc = ctx.createOscillator();
    bassOsc.type = "sine";
    bassOsc.frequency.value = targetBassFreq;

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = "lowpass";
    bassFilter.frequency.value = 500; // was 400 — a bit more felt-and-heard presence

    const bassEnv = ctx.createGain();
    bassEnv.gain.value = 0;

    bassOsc.connect(bassFilter);
    bassFilter.connect(bassEnv);
    bassEnv.connect(musicGain);

    bassOsc.start(now);
    bassEnv.gain.linearRampToValueAtTime(theme.gain * BASS_GAIN_MULT, now + 1.6);

    bassNodes = { bassOsc, bassFilter, bassEnv };

    startClock(theme);
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
    stopClock();
  }

  // --- Rhythmic pulse layer ----------------------------------------------
  // A soft, low, heartbeat-like thump under everything else — this is a lot
  // of what makes the loop read as "a piece of music with a pulse" rather
  // than an ambient drone with notes sprinkled on top. Tempo and intensity
  // both track the current mood section (see currentSection() above), so
  // pacing genuinely shifts over time instead of just tone.
  function pulseBeat(theme, time) {
    if (!running || !ctx) return;
    const section = currentSection();
    const chord = chordOffset(theme, songTimeMs());
    const freq = midiToFreq(theme.root + chord - 24);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 2, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.09);

    const env = ctx.createGain();
    const peak = theme.gain * 0.16 * section.pulse;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0006, time + 0.32);

    osc.connect(env);
    env.connect(musicGain);
    osc.start(time);
    osc.stop(time + 0.34);
  }

  // --- Arpeggio / comping layer -------------------------------------------
  // Unlike the lead melody's free wander, this layer steps through a fixed,
  // repeating pattern (`theme.arpPattern`) over the *current chord's* three
  // triad tones — the same role a comping guitar or arpeggiated synth plays
  // in a real song: a steady, anticipatable figure that outlines the
  // harmony underneath the free melody. Repetition here (rather than in the
  // lead) is deliberately what supplies "catchy," since a pattern the ear
  // can predict is what a wandering, never-repeating lead can't provide on
  // its own.
  function arpPatternIndex(theme, step, tonesLen) {
    switch (theme.arpPattern) {
      case "down":
        return (tonesLen - 1 - (step % tonesLen) + tonesLen) % tonesLen;
      case "updown": {
        const cycle = tonesLen * 2 - 2 || 1;
        const p = step % cycle;
        return p < tonesLen ? p : cycle - p;
      }
      case "random":
        return Math.floor(Math.random() * tonesLen);
      case "up":
      default:
        return step % tonesLen;
    }
  }

  function arpNote(theme, time, localStep) {
    const atMs = songTimeMs();
    const idx = chordIndex(theme, atMs);
    const tones = chordToneIndices(theme, idx);
    const patIdx = arpPatternIndex(theme, localStep, tones.length);
    const degree = theme.scale[tones[patIdx]];
    const section = currentSection();
    const octaveUp = localStep % (tones.length * 2) >= tones.length ? 12 : 0;
    const freq = midiToFreq(theme.root + degree + octaveUp);

    const osc = ctx.createOscillator();
    osc.type = theme.arpWave;
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = theme.filterHz * 0.85;
    filter.Q.value = 0.6;

    const env = ctx.createGain();
    const peak = theme.gain * theme.arpGain * (0.75 + Math.random() * 0.2) * section.gain;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0006, time + theme.arpMs / 1000);

    const sendGain = ctx.createGain();
    sendGain.gain.value = 0.3 * theme.echoWet;

    osc.connect(filter);
    filter.connect(env);
    env.connect(musicGain);
    env.connect(sendGain);
    sendGain.connect(delayBus);

    osc.start(time);
    osc.stop(time + theme.arpMs / 1000 + 0.05);
  }

  // --- Walking bass layer --------------------------------------------------
  // The sustained sub-bass drone (in startPad) gives a continuous low
  // anchor; this is a separate, plucked layer that actually *moves* between
  // chord tones (root/3rd/5th) on a short repeating pattern per theme —
  // real basslines walk, they don't just hold one note — which is a big
  // part of what was missing for "more layers" and a distinct feel per page.
  function bassNote(theme, time, localStep) {
    const atMs = songTimeMs();
    const idx = chordIndex(theme, atMs);
    const tones = chordToneIndices(theme, idx);
    const pattern = theme.bassPattern && theme.bassPattern.length ? theme.bassPattern : [0];
    const patIdx = pattern[localStep % pattern.length] % tones.length;
    const degree = theme.scale[tones[patIdx]];
    const section = currentSection();
    const freq = midiToFreq(theme.root + degree - 12);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    filter.Q.value = 0.4;

    const env = ctx.createGain();
    const peak = theme.gain * 0.34 * (0.8 + Math.random() * 0.15) * section.gain;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0006, time + theme.bassMs / 1000);

    osc.connect(filter);
    filter.connect(env);
    env.connect(musicGain);

    osc.start(time);
    osc.stop(time + theme.bassMs / 1000 + 0.05);
  }

  // --- Hi-hat / percussion texture layer -----------------------------------
  // Short, filtered noise ticks — the fourth pillar (rhythm) alongside the
  // low pulse thump. Density and speed are per-theme, so busier/driven pages
  // (projects) feel audibly more rhythmic than sparse/airy ones (skills).
  function hatHit(theme, time, accent) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 1;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = accent ? 6500 : 8500;
    filter.Q.value = 0.7;

    const env = ctx.createGain();
    const section = currentSection();
    const peak = theme.gain * (accent ? 0.15 : 0.08) * section.pulse;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0004, time + (accent ? 0.09 : 0.045));

    src.connect(filter);
    filter.connect(env);
    env.connect(musicGain);

    src.start(time);
    src.stop(time + 0.12);
  }

  // --- Shared beat clock ----------------------------------------------------
  // A standard "lookahead" Web Audio scheduler: every CLOCK_TICK_MS it wakes
  // up and schedules any beats that fall within the next CLOCK_LOOKAHEAD_SEC
  // window, using ctx.currentTime (the audio clock) for actual note timing
  // rather than trusting setTimeout's timing directly — setTimeout is only
  // used to decide *when to check*, never *when a note plays*. Every layer's
  // participation is a simple "does this beat number divide evenly by my
  // subdivision" check against the same beat counter, so nothing can drift
  // out of phase with anything else the way five independent jittered
  // timers could.
  const CLOCK_TICK_MS = 40;
  const CLOCK_LOOKAHEAD_SEC = 0.15;

  function startClock(theme) {
    clockNextTime = ctx.currentTime + 0.05;
    clockBeatNum = 0;
    scheduleClockAhead();
  }
  function stopClock() {
    if (clockTimerId) {
      clearTimeout(clockTimerId);
      clockTimerId = null;
    }
  }
  function scheduleClockAhead() {
    if (!running) return;
    while (clockNextTime < ctx.currentTime + CLOCK_LOOKAHEAD_SEC) {
      fireBeat(clockBeatNum, clockNextTime);
      const theme = currentTheme();
      const section = currentSection();
      const beatSec = theme.beatMs / section.tempo / 1000;
      clockBeatNum++;
      clockNextTime += beatSec;
    }
    clockTimerId = setTimeout(scheduleClockAhead, CLOCK_TICK_MS);
  }

  function fireBeat(n, gridTime) {
    const theme = currentTheme();
    const section = currentSection();
    const beatSec = theme.beatMs / section.tempo / 1000;
    // Swing: every other grid position leans a little late — applied here,
    // once, to whichever layer(s) happen to land on that position, so the
    // shuffle feels like one shared groove instead of several unrelated
    // wobbles.
    const time = gridTime + (n % 2 === 1 ? theme.swing * beatSec : 0);

    if (n % theme.hatDiv === 0 && Math.random() < theme.hatDensity * section.density) {
      const accent = Math.floor(n / theme.hatDiv) % 4 === 0;
      hatHit(theme, time, accent);
    }
    if (n % theme.arpDiv === 0) {
      arpNote(theme, time, Math.floor(n / theme.arpDiv));
    }
    if (((n - theme.bassPhase) % theme.bassDiv + theme.bassDiv) % theme.bassDiv === 0) {
      bassNote(theme, time, Math.floor(n / theme.bassDiv));
    }
    if (n % theme.pulseDiv === 0) {
      pulseBeat(theme, time);
    }
    if (n % theme.leadDiv === 0) {
      fireLead(theme, time, section);
    }
    if (n % theme.counterDiv === 0) {
      fireCounter(theme, time, section);
    }
    if (Math.random() < 0.02 * section.density) {
      shimmer(theme, time + 0.02);
    }
  }

  // Glides the pad + bass to the current chord's root rather than
  // re-triggering them, so chord changes feel like the harmony shifting
  // underfoot instead of a new note starting.
  let lastChordIdx = null;
  function retargetPadToChord(theme) {
    if (!padNodes || !bassNodes) return;
    const now = ctx.currentTime;
    const idx = chordIndex(theme, songTimeMs());
    const chord = theme.scale[idx];
    const padFreq = midiToFreq(theme.root + chord - 12);
    const bassFreq = midiToFreq(theme.root + chord - 24);
    [padNodes.osc1, padNodes.osc2].forEach((osc) => {
      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setTargetAtTime(padFreq, now, 2.2);
    });
    bassNodes.bassOsc.frequency.cancelScheduledValues(now);
    bassNodes.bassOsc.frequency.setTargetAtTime(bassFreq, now, 2.2);

    // A gentle swell right as the chord actually changes, so the harmonic
    // movement is something you notice rather than something only true on
    // paper — this is most of what makes the "continuous" layer read as
    // continuous instead of just quietly present.
    if (lastChordIdx !== null && lastChordIdx !== idx) {
      const base = theme.gain * PAD_GAIN_MULT;
      padNodes.padEnv.gain.cancelScheduledValues(now);
      padNodes.padEnv.gain.setValueAtTime(padNodes.padEnv.gain.value, now);
      padNodes.padEnv.gain.linearRampToValueAtTime(base * 1.3, now + 0.5);
      padNodes.padEnv.gain.linearRampToValueAtTime(base, now + 2.6);
    }
    lastChordIdx = idx;
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
    sendGain.gain.value = sendToDelay * theme.echoWet;

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
    sendGain.gain.value = 0.35 * theme.echoWet;

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
  //
  // `pull` (0..1) is how strongly this step is drawn toward the nearest
  // note of `tones` (the current chord's tones) rather than moving freely.
  // This is the actual harmony-awareness that was missing before: instead
  // of a uniform random walk that ignores what chord is playing, the walk
  // now resolves toward a chord tone right after a chord change and loosens
  // into free passing-tone wander as the chord settles in — which is the
  // same target-then-decorate logic real melodic improvisation uses.
  function stepWalk(theme, pos, pull, tones) {
    const len = theme.scale.length;
    if (tones && tones.length && Math.random() < pull) {
      let target = tones[0];
      let bestDist = Math.abs(pos - target);
      for (const t of tones) {
        const d = Math.abs(pos - t);
        if (d < bestDist) {
          bestDist = d;
          target = t;
        }
      }
      if (target > pos) pos += Math.random() < 0.25 ? 2 : 1;
      else if (target < pos) pos -= Math.random() < 0.25 ? 2 : 1;
      // else already on a chord tone — fall through to a small free move
      else {
        const r = Math.random();
        if (r < 0.4) pos += 1;
        else if (r < 0.8) pos -= 1;
      }
    } else {
      const r = Math.random();
      if (r < 0.45) pos += 1;
      else if (r < 0.75) pos -= 1;
      else if (r < 0.85) pos += 2;
      else if (r < 0.95) pos -= 2;
      // else: stay — a repeated note now and then reads as intentional
    }
    if (pos < 0) pos = 0;
    if (pos >= len) pos = len - 1;
    return pos;
  }

  function isChordTone(pos, tones) {
    return tones.indexOf(pos) !== -1;
  }

  // Tracks the last chord index seen by the lead voice, separate from the
  // pad's own lastChordIdx above, so it can tell exactly when a chord
  // change happens and, at that moment, decide whether to weave in a
  // motif from the theme's bank (see "Emergent motif memory" above)
  // instead of a free wander step. Firing on roughly half of chord
  // changes, rather than every single one, is what keeps it "recognizable
  // but unpredictable" instead of a mechanical, fully-repeating loop.
  let lastSchedChordIdx = null;
  let motifQueue = [];
  // A rolling buffer of the free-wander notes the lead has played since
  // its last resolution — candidate material for the motif bank. Reset
  // whenever a phrase resolves (successfully captured or not) or when a
  // motif-replay finishes, so captures reflect genuinely fresh material
  // rather than replayed motifs feeding back into the bank.
  let leadRun = [];

  function fireLead(theme, time, section) {
    const themeKey = (document.body && document.body.dataset.page) || "default";
    const atMs = songTimeMs();
    const idx = chordIndex(theme, atMs);
    const tones = chordToneIndices(theme, idx);

    if (lastSchedChordIdx !== idx) {
      if (lastSchedChordIdx !== null && Math.random() < 0.55) {
        const picked = pickMotif(themeKey);
        if (picked) motifQueue = picked;
      }
      lastSchedChordIdx = idx;
    }

    // Pull toward a chord tone is strongest right as a chord lands and
    // relaxes over the rest of that chord's time window — resolve, then
    // wander freely until the next resolution. Floor is kept fairly high
    // (0.3, not near-zero) so the wander always stays reasonably anchored
    // to the harmony instead of drifting far enough to read as noise.
    const sinceChord = atMs % theme.chordMs;
    const chordFrac = sinceChord / theme.chordMs;
    const pull = 0.62 - 0.32 * Math.min(1, chordFrac * 2);

    // Lead voice — not every beat plays a note; occasional rests keep it
    // from feeling like a busy, mechanical arpeggio. Rest probability and
    // velocity both track the current mood section, so a "calm" stretch
    // genuinely plays sparser/softer than a "peak" one, not just quieter.
    const leadPlayChance = 1 - 0.18 / section.density;
    if (Math.random() >= leadPlayChance) return;

    let resolved = false;
    if (motifQueue.length) {
      walk.lead = Math.max(0, Math.min(theme.scale.length - 1, motifQueue.shift()));
      leadRun = []; // motif material doesn't get re-captured as "new"
    } else {
      walk.lead = stepWalk(theme, walk.lead, pull, tones);
      resolved = isChordTone(walk.lead, tones);
      leadRun.push(walk.lead);
      if (leadRun.length > MOTIF_MAX_LEN) leadRun.shift();
      if (resolved && leadRun.length >= MOTIF_MIN_LEN && Math.random() < 0.35) {
        captureMotif(themeKey, leadRun);
        leadRun = [walk.lead];
      }
    }

    // Single source of transposition: straight off the theme's fixed
    // scale, never re-shifted by the chord. The chord's influence comes
    // entirely through the walk's bias above, so melody and harmony can
    // no longer fall out of key with each other.
    const degree = theme.scale[walk.lead];
    const octaveUp = Math.random() < 0.15 ? 12 : 0;
    const midi = theme.root + degree + octaveUp;
    const freq = midiToFreq(midi);
    const velocity = (0.62 + Math.random() * 0.28) * section.gain;
    pluck(theme, freq, time + 0.02, velocity, 1, 0.28);
    lastLeadMidi = midi;
    saveWalkState(walk);
  }

  // Sparser high counter-melody — this is what gives the piece its "more
  // than one thing happening" complexity without crowding the mix. Nudged
  // away from forming a harsh clash (a minor 2nd or tritone) against
  // whatever the lead just played, since two independently-wandering
  // voices landing a semitone apart is the single most common source of
  // a generative texture suddenly sounding "wrong" rather than just busy.
  function fireCounter(theme, time, section) {
    const atMs = songTimeMs();
    const idx = chordIndex(theme, atMs);
    const tones = chordToneIndices(theme, idx);
    const sinceChord = atMs % theme.chordMs;
    const chordFrac = sinceChord / theme.chordMs;
    const pull = (0.62 - 0.32 * Math.min(1, chordFrac * 2)) * 0.75;

    walk.counter = stepWalk(theme, walk.counter, pull, tones);
    let degree = theme.scale[walk.counter];
    let midi = theme.root + degree + 19;

    if (lastLeadMidi !== null) {
      const interval = Math.abs(midi - lastLeadMidi) % 12;
      if (interval === 1 || interval === 11 || interval === 6) {
        const alt = walk.counter + (midi > lastLeadMidi ? 1 : -1);
        if (alt >= 0 && alt < theme.scale.length) {
          walk.counter = alt;
          degree = theme.scale[walk.counter];
          midi = theme.root + degree + 19;
        }
      }
    }

    const freq = midiToFreq(midi);
    pluck(theme, freq, time + 0.05, (0.55 + Math.random() * 0.25) * section.gain, 0.55, 0.4);
    lastCounterMidi = midi;
    saveWalkState(walk);
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
    lastSchedChordIdx = null;
    leadRun = [];
    motifQueue = [];
    const themeKey = (document.body && document.body.dataset.page) || "default";
    startPad(currentTheme(), THEMES[themeKey] ? themeKey : "default");
    scheduleChordWatch();
  }

  function stopMusic() {
    running = false;
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