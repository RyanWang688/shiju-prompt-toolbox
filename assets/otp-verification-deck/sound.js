(() => {
  'use strict';

  let ctx = null;
  let masterGain = null;
  let compressor = null;
  let noiseBuffer = null;
  let enabled = true;
  const scheduledTimers = new Set();

  function schedule(fn, delayMs) {
    const id = setTimeout(() => {
      scheduledTimers.delete(id);
      if (enabled) fn();
    }, Math.max(0, delayMs));
    scheduledTimers.add(id);
    return id;
  }

  function stopScheduled() {
    scheduledTimers.forEach((id) => clearTimeout(id));
    scheduledTimers.clear();
  }

  function createNoiseBuffer(audioCtx) {
    const length = Math.floor(audioCtx.sampleRate * 1.5);
    const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  function ensureContext() {
    if (!enabled) return null;
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-16, ctx.currentTime);
      compressor.knee.setValueAtTime(18, ctx.currentTime);
      compressor.ratio.setValueAtTime(4, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.14, ctx.currentTime);

      masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.85, ctx.currentTime);

      masterGain.connect(compressor);
      compressor.connect(ctx.destination);
      noiseBuffer = createNoiseBuffer(ctx);
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function unlock() {
    if (!enabled) return;
    ensureContext();
  }

  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true, passive: true });

  function playNoiseBurst({
    delay = 0,
    duration = 0.05,
    filterType = 'bandpass',
    freqStart = 1400,
    freqEnd = freqStart,
    q = 1.4,
    gainPeak = 0.04,
  }) {
    const audioCtx = ensureContext();
    if (!audioCtx || !noiseBuffer) return;

    const start = audioCtx.currentTime + delay;
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.setValueAtTime(q, start);
    filter.frequency.setValueAtTime(Math.max(40, freqStart), start);
    if (freqEnd !== freqStart) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), start + duration);
    }

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainPeak), start + Math.min(0.008, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    src.start(start);
    src.stop(start + duration + 0.02);
  }

  function playTone({
    delay = 0,
    duration = 0.08,
    type = 'sine',
    freqStart = 440,
    freqEnd = freqStart,
    attack = 0.006,
    gainPeak = 0.04,
    lowpassFreq = 0,
  }) {
    const audioCtx = ensureContext();
    if (!audioCtx) return;

    const start = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), start);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + duration);
    }

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainPeak), start + Math.min(attack, duration * 0.4));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    if (lowpassFreq > 0) {
      const lp = audioCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(lowpassFreq, start);
      osc.connect(lp);
      lp.connect(gain);
    } else {
      osc.connect(gain);
    }

    gain.connect(masterGain);
    osc.start(start);
    osc.stop(start + duration + 0.025);
  }

  const DeckAudio = {
    setEnabled(nextEnabled) {
      enabled = Boolean(nextEnabled);
      if (!enabled) {
        stopScheduled();
      } else {
        ensureContext();
      }
    },

    isEnabled() {
      return enabled;
    },

    stopScheduled,

    /* 1. Matte card focus lift brush */
    playFocus() {
      if (!enabled) return;
      playNoiseBurst({
        duration: 0.022,
        filterType: 'bandpass',
        freqStart: 2200,
        freqEnd: 2700,
        q: 1.8,
        gainPeak: 0.016,
      });
    },

    /* 2. Two-layer tactile card press + ceramic/wood tap */
    playType(index = 0) {
      if (!enabled) return;
      playNoiseBurst({
        duration: 0.016,
        filterType: 'highpass',
        freqStart: 1850,
        q: 1.0,
        gainPeak: 0.036,
      });
      playTone({
        duration: 0.046,
        type: 'triangle',
        freqStart: 350 + index * 36,
        freqEnd: 175,
        attack: 0.003,
        gainPeak: 0.055,
      });
    },

    /* 3. Muted reverse tap on backspace delete */
    playDelete() {
      if (!enabled) return;
      playNoiseBurst({
        duration: 0.02,
        filterType: 'bandpass',
        freqStart: 1400,
        freqEnd: 900,
        q: 1.6,
        gainPeak: 0.018,
      });
      playTone({
        duration: 0.038,
        type: 'triangle',
        freqStart: 215,
        freqEnd: 115,
        attack: 0.003,
        gainPeak: 0.038,
      });
    },

    /* 4. Card fan slide + delicate flick tick */
    playFanCard(index = 0) {
      if (!enabled) return;
      playNoiseBurst({
        duration: 0.075,
        filterType: 'bandpass',
        freqStart: 1250 + index * 140,
        freqEnd: 2950 + index * 180,
        q: 1.5,
        gainPeak: 0.032,
      });
      playTone({
        duration: 0.032,
        type: 'sine',
        freqStart: 480 + index * 55,
        freqEnd: 620 + index * 55,
        attack: 0.004,
        gainPeak: 0.014,
      });
    },

    /* 5a. Card gather air swish during riffle stack */
    playStackCard(index = 0) {
      if (!enabled) return;
      playNoiseBurst({
        duration: 0.068,
        filterType: 'bandpass',
        freqStart: 2100 - index * 110,
        freqEnd: 980,
        q: 1.35,
        gainPeak: 0.026,
      });
    },

    /* 5b. Grounded deck-tap thud when 4 cards seat into center stack */
    playStackLock() {
      if (!enabled) return;
      playTone({
        duration: 0.095,
        type: 'sine',
        freqStart: 118,
        freqEnd: 52,
        attack: 0.003,
        gainPeak: 0.08,
      });
      playNoiseBurst({
        duration: 0.022,
        filterType: 'bandpass',
        freqStart: 950,
        freqEnd: 680,
        q: 1.9,
        gainPeak: 0.032,
      });
    },

    /* 6. Rhythmic whip-cadence orbital optical whoosh + soft harmonic pulse */
    playOpticalBeat(beatDurationMs = 920) {
      if (!enabled) return;
      const beatSec = Math.max(0.35, beatDurationMs / 1000);
      const audioCtx = ensureContext();
      if (!audioCtx || !noiseBuffer) return;

      const start = audioCtx.currentTime;
      const src = audioCtx.createBufferSource();
      src.buffer = noiseBuffer;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(2.3, start);
      filter.frequency.setValueAtTime(600, start);
      filter.frequency.exponentialRampToValueAtTime(2350, start + beatSec * 0.44);
      filter.frequency.exponentialRampToValueAtTime(740, start + beatSec * 0.92);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.024, start + beatSec * 0.42);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + beatSec * 0.92);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      src.start(start);
      src.stop(start + beatSec);

      // Soft crystalline overtone pulse synced with the optical whip peak
      playTone({
        delay: beatSec * 0.08,
        duration: beatSec * 0.65,
        type: 'sine',
        freqStart: 587.33, // D5
        attack: beatSec * 0.24,
        gainPeak: 0.016,
      });
      playTone({
        delay: beatSec * 0.1,
        duration: beatSec * 0.62,
        type: 'sine',
        freqStart: 880, // A5
        attack: beatSec * 0.24,
        gainPeak: 0.011,
      });
    },

    /* 7. Magnetic 3D snap + warm major-9th glass shimmer */
    playSuccess() {
      if (!enabled) return;
      // Magnetic snap synced with rotateY(-12deg)
      playNoiseBurst({
        duration: 0.024,
        filterType: 'bandpass',
        freqStart: 2100,
        freqEnd: 3200,
        q: 1.4,
        gainPeak: 0.04,
      });
      playTone({
        duration: 0.075,
        type: 'triangle',
        freqStart: 280,
        freqEnd: 540,
        attack: 0.004,
        gainPeak: 0.048,
      });

      // Restrained major-9th glass shimmer (D5, F#5, A5, C#6, E6)
      const chord = [587.33, 739.99, 880.0, 1108.73, 1318.51];
      chord.forEach((freq, i) => {
        playTone({
          delay: 0.035 + i * 0.032,
          duration: 0.42 - i * 0.02,
          type: 'sine',
          freqStart: freq,
          attack: 0.014,
          gainPeak: 0.024 - i * 0.002,
          lowpassFreq: 3800,
        });
      });
    },

    /* 8. Double-beat muted low knock + dry card-rattle synced to shake */
    playError(scale = 1) {
      if (!enabled) return;
      const beat2Sec = 0.13 * scale;

      playTone({
        delay: 0,
        duration: 0.11,
        type: 'triangle',
        freqStart: 145,
        freqEnd: 74,
        attack: 0.004,
        gainPeak: 0.068,
      });
      playNoiseBurst({
        delay: 0,
        duration: 0.04,
        filterType: 'bandpass',
        freqStart: 1100,
        freqEnd: 650,
        q: 2.2,
        gainPeak: 0.026,
      });

      playTone({
        delay: beat2Sec,
        duration: 0.13,
        type: 'triangle',
        freqStart: 118,
        freqEnd: 58,
        attack: 0.004,
        gainPeak: 0.06,
      });
      playNoiseBurst({
        delay: beat2Sec,
        duration: 0.045,
        filterType: 'bandpass',
        freqStart: 980,
        freqEnd: 520,
        q: 2.2,
        gainPeak: 0.022,
      });
    },

    /* 9. Deal-back: launch air swish + matte desk slap at ~375ms * scale */
    playDealCard(index = 0, scale = 1) {
      if (!enabled) return;
      // Takeoff swish
      playNoiseBurst({
        duration: 0.065,
        filterType: 'bandpass',
        freqStart: 1700 + index * 120,
        freqEnd: 1050,
        q: 1.5,
        gainPeak: 0.024,
      });

      // Crisp card-slap onto the matte desk at landing bounce (offset ~0.82 of 460ms)
      schedule(() => {
        playNoiseBurst({
          duration: 0.026,
          filterType: 'bandpass',
          freqStart: 1120,
          freqEnd: 760,
          q: 1.8,
          gainPeak: 0.036,
        });
        playTone({
          duration: 0.065,
          type: 'sine',
          freqStart: 135 - index * 6,
          freqEnd: 64,
          attack: 0.003,
          gainPeak: 0.048,
        });
      }, 375 * scale);
    },
  };

  window.DeckAudio = DeckAudio;
})();
