/**
 * Purin Cycle — Web Audio API Sound Effects & Cozy Music-Box BGM Engine
 * Zero external audio files; 100% offline-safe and iOS Safari gesture-unlocked.
 */

const BGM_TARGET_GAIN = 0.045;
const BGM_FADE_SEC = 0.12;
const BGM_FILTER_HZ = 1400;
const BGM_BPM = 76;
const STEP_DURATION = 60 / BGM_BPM / 2; // Eighth-note step (~0.3947s)
const LOOKAHEAD_MS = 100;
const SCHEDULE_AHEAD_SEC = 0.28;

// 4-bar cozy progression: Cadd9 -> Am7 -> Fmaj7 -> G6 (32 eighth-note steps)
const BGM_CHORDS = [
  [261.63, 293.66, 329.63, 392.0], // Bar 0: Cadd9 (C4, D4, E4, G4)
  [220.0, 261.63, 329.63, 392.0],  // Bar 1: Am7   (A3, C4, E4, G4)
  [174.61, 220.0, 261.63, 329.63], // Bar 2: Fmaj7 (F3, A3, C4, E4)
  [196.0, 246.94, 293.66, 329.63], // Bar 3: G6    (G3, B3, D4, E4)
];

// Gentle Sanrio music-box melody over the 32 eighth-note steps (null = rest)
const BGM_MELODY = [
  // Bar 0 (Cadd9)
  659.25, 783.99, 587.33, null, 523.25, 587.33, 659.25, null,
  // Bar 1 (Am7)
  783.99, 659.25, 523.25, null, 587.33, 659.25, 523.25, null,
  // Bar 2 (Fmaj7)
  440.0, 523.25, 659.25, 783.99, 659.25, null, 587.33, 523.25,
  // Bar 3 (G6)
  587.33, 659.25, 783.99, null, 659.25, 587.33, null, null,
];

class PurinSoundEngine {
  constructor() {
    this.ctx = null;
    this.sfxGain = null;
    this.bgmMasterGain = null;
    this.bgmFilter = null;

    this.sfxEnabled = true;
    this.bgmEnabled = false;

    this.bgmRunning = false;
    this.schedulerTimer = null;
    this.nextStepTime = 0;
    this.currentStep = 0;
    this.activeBgmNodes = new Set();

    this.unlocked = false;
    this._bindLifecycle();
  }

  _bindLifecycle() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const onGesture = () => {
      this.unlock();
    };
    window.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
    window.addEventListener('keydown', onGesture, { capture: true, passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._pauseBgm(0.08);
      } else if (this.bgmEnabled) {
        this.unlock();
        this._startBgm();
      }
    });
  }

  _ensureContext() {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    const sfxGain = ctx.createGain();
    sfxGain.gain.value = 1.0;
    sfxGain.connect(ctx.destination);

    const bgmFilter = ctx.createBiquadFilter();
    bgmFilter.type = 'lowpass';
    bgmFilter.frequency.value = BGM_FILTER_HZ;
    bgmFilter.Q.value = 0.7;

    const bgmMasterGain = ctx.createGain();
    bgmMasterGain.gain.value = 0.0001;

    bgmMasterGain.connect(bgmFilter);
    bgmFilter.connect(ctx.destination);

    this.ctx = ctx;
    this.sfxGain = sfxGain;
    this.bgmFilter = bgmFilter;
    this.bgmMasterGain = bgmMasterGain;
    return ctx;
  }

  unlock() {
    const ctx = this._ensureContext();
    if (!ctx) return null;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    if (!this.unlocked) {
      this.unlocked = true;
      try {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        // Ignore if browser blocks silent buffer before gesture
      }
    }

    if (this.bgmEnabled && !document.hidden && !this.bgmRunning) {
      this._startBgm();
    }

    return ctx;
  }

  setSfxEnabled(enabled) {
    this.sfxEnabled = Boolean(enabled);
  }

  setBgmEnabled(enabled) {
    const next = Boolean(enabled);
    this.bgmEnabled = next;

    if (next) {
      this.unlock();
      if (!document.hidden) {
        this._startBgm();
      }
    } else {
      this._pauseBgm(BGM_FADE_SEC);
    }
  }

  /* ========================================================================
     7 Tactile Sanrio / Custard SFX
     ======================================================================== */
  playSfx(name, { force = false } = {}) {
    if (!force && !this.sfxEnabled) return;
    const ctx = this.unlock();
    if (!ctx || !this.sfxGain) return;

    const now = ctx.currentTime;
    switch (name) {
      case 'tap':
        this._sfxTap(ctx, now);
        break;
      case 'chip':
        this._sfxChip(ctx, now);
        break;
      case 'mascot':
        this._sfxMascot(ctx, now);
        break;
      case 'drawer':
        this._sfxDrawer(ctx, now);
        break;
      case 'period':
        this._sfxPeriod(ctx, now);
        break;
      case 'save':
        this._sfxSave(ctx, now);
        break;
      case 'error':
        this._sfxError(ctx, now);
        break;
      default:
        break;
    }
  }

  _sfxTap(ctx, now) {
    // Soft warm marimba/pudding pop (520Hz -> 680Hz, 55ms)
    const osc = ctx.createOscillator();
    const tri = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    tri.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.055);
    tri.frequency.setValueAtTime(520, now);
    tri.frequency.exponentialRampToValueAtTime(680, now + 0.055);

    const triGain = ctx.createGain();
    triGain.gain.value = 0.28;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.058);

    osc.connect(gain);
    tri.connect(triGain);
    triGain.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    tri.start(now);
    osc.stop(now + 0.065);
    tri.stop(now + 0.065);
  }

  _sfxChip(ctx, now) {
    // Crisp bubbly pop (620Hz -> 880Hz, 65ms)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.065);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.068);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.075);
  }

  _sfxMascot(ctx, now) {
    // Playful two-note Pompompurin chirp (660Hz then 880Hz with gentle vibrato, 160ms)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(660, now + 0.062);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.082);

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(18, now);
    lfoGain.gain.setValueAtTime(0, now);
    lfoGain.gain.linearRampToValueAtTime(10, now + 0.08);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.13, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.065);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.082);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.165);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    lfo.start(now);
    osc.stop(now + 0.175);
    lfo.stop(now + 0.175);
  }

  _sfxDrawer(ctx, now) {
    // Soft upward cushion whoosh-pop (320Hz -> 540Hz, 110ms)
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(540, now + 0.11);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(1800, now + 0.11);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.022);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.115);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.125);
  }

  _sfxPeriod(ctx, now) {
    // Warm cozy 3-note chord chime (C5 - E5 - G5, 260ms)
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.036;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.095, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(start);
      osc.stop(start + 0.26);
    });
  }

  _sfxSave(ctx, now) {
    // Happy sparkling 4-note arpeggio (C5 - E5 - G5 - C6, 340ms)
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.062;
      const osc = ctx.createOscillator();
      const bell = ctx.createOscillator();
      const bellGain = ctx.createGain();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      bell.type = 'triangle';
      bell.frequency.setValueAtTime(freq * 2, start);
      bellGain.gain.value = 0.16;

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.1, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.175);

      osc.connect(gain);
      bell.connect(bellGain);
      bellGain.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(start);
      bell.start(start);
      osc.stop(start + 0.19);
      bell.stop(start + 0.19);
    });
  }

  _sfxError(ctx, now) {
    // Gentle low double-boop (240Hz -> 190Hz, 180ms)
    const steps = [
      { freq: 240, offset: 0, dur: 0.075 },
      { freq: 190, offset: 0.09, dur: 0.09 },
    ];
    steps.forEach(({ freq, offset, dur }) => {
      const start = now + offset;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      filter.type = 'lowpass';
      filter.frequency.value = 650;

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.13, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(start);
      osc.stop(start + dur + 0.015);
    });
  }

  /* ========================================================================
     Gapless Cozy Music-Box & Warm Electric-Piano BGM Scheduler
     ======================================================================== */
  _startBgm() {
    if (this.bgmRunning || !this.bgmEnabled) return;
    const ctx = this._ensureContext();
    if (!ctx || !this.bgmMasterGain) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    this.bgmRunning = true;
    const now = ctx.currentTime;
    this.bgmMasterGain.gain.cancelScheduledValues(now);
    this.bgmMasterGain.gain.setValueAtTime(
      Math.max(0.0001, this.bgmMasterGain.gain.value),
      now
    );
    this.bgmMasterGain.gain.linearRampToValueAtTime(BGM_TARGET_GAIN, now + BGM_FADE_SEC);

    this.nextStepTime = now + 0.05;
    this._scheduleLoop();
    this.schedulerTimer = window.setInterval(() => this._scheduleLoop(), LOOKAHEAD_MS);
  }

  _pauseBgm(fadeSec = BGM_FADE_SEC) {
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.bgmRunning = false;

    if (!this.ctx || !this.bgmMasterGain) return;
    const now = this.ctx.currentTime;
    this.bgmMasterGain.gain.cancelScheduledValues(now);
    this.bgmMasterGain.gain.setValueAtTime(
      Math.max(0.0001, this.bgmMasterGain.gain.value),
      now
    );
    this.bgmMasterGain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);

    const stopAt = now + fadeSec + 0.02;
    this.activeBgmNodes.forEach((osc) => {
      try {
        osc.stop(stopAt);
      } catch {
        // Node may already be stopped
      }
    });
    this.activeBgmNodes.clear();
  }

  _scheduleLoop() {
    if (!this.bgmRunning || !this.ctx) return;

    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      this._scheduleStep(this.currentStep, this.nextStepTime);
      this.nextStepTime += STEP_DURATION;
      this.currentStep = (this.currentStep + 1) % BGM_MELODY.length;
    }
  }

  _scheduleStep(stepIndex, time) {
    const ctx = this.ctx;
    if (!ctx || !this.bgmMasterGain) return;

    // Warm electric-piano chord pad on the downbeat of every 8-step bar
    if (stepIndex % 8 === 0) {
      const barIndex = Math.floor(stepIndex / 8) % BGM_CHORDS.length;
      const chord = BGM_CHORDS[barIndex];
      const barDur = STEP_DURATION * 8;
      this._playPadChord(ctx, chord, time, barDur);
    }

    // Delicate music-box melody chime
    const melodyFreq = BGM_MELODY[stepIndex];
    if (melodyFreq) {
      this._playMusicBoxNote(ctx, melodyFreq, time, STEP_DURATION * 1.65);
    }
  }

  _trackBgmOsc(osc) {
    this.activeBgmNodes.add(osc);
    osc.onended = () => {
      this.activeBgmNodes.delete(osc);
    };
  }

  _playPadChord(ctx, freqs, startTime, duration) {
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      // Tiny detune warmth across voices
      osc.frequency.setValueAtTime(freq, startTime);
      osc.detune.setValueAtTime((idx - 1.5) * 2.2, startTime);

      const peak = 0.22 / freqs.length;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(peak, startTime + 0.18);
      gain.gain.exponentialRampToValueAtTime(peak * 0.45, startTime + duration * 0.78);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + 0.08);

      osc.connect(gain);
      gain.connect(this.bgmMasterGain);

      this._trackBgmOsc(osc);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.12);
    });
  }

  _playMusicBoxNote(ctx, freq, startTime, duration) {
    const osc = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const overtoneGain = ctx.createGain();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    overtone.type = 'triangle';
    overtone.frequency.setValueAtTime(freq * 2, startTime);
    overtoneGain.gain.value = 0.14;

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(0.32, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    overtone.connect(overtoneGain);
    overtoneGain.connect(gain);
    gain.connect(this.bgmMasterGain);

    this._trackBgmOsc(osc);
    this._trackBgmOsc(overtone);
    osc.start(startTime);
    overtone.start(startTime);
    osc.stop(startTime + duration + 0.04);
    overtone.stop(startTime + duration + 0.04);
  }
}

export const soundEngine = new PurinSoundEngine();
