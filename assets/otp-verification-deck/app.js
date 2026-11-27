(() => {
  'use strict';

  const VALID_CODE = '1234';
  const SLOT_COUNT = 4;

  const slots = Array.from(document.querySelectorAll('.slot'));
  const inputs = slots.map((slot) => slot.querySelector('.slot__input'));
  const cards = slots.map((slot) => slot.querySelector('.slot__card'));
  const frames = slots.map((slot) => slot.querySelector('.slot__card-frame'));
  const sheens = slots.map((slot) => slot.querySelector('.slot__card-sheen'));
  const digits = slots.map((slot) => slot.querySelector('.slot__digit'));

  const slotsRow = document.getElementById('slotsRow');
  const deckDeskLight = document.getElementById('deckDeskLight');
  const deckOverlayInner = document.getElementById('deckOverlayInner');
  const rippleRing = document.getElementById('rippleRing');
  const deckCoreGlow = document.querySelector('.deck-core-glow');
  const beamSvg = document.querySelector('.beam-svg');
  const beamBloom = document.querySelector('.beam-stroke--bloom');
  const beamCore = document.querySelector('.beam-stroke--core');
  const beamGlint = document.querySelector('.beam-stroke--glint');
  const beamStrokes = [beamBloom, beamCore, beamGlint];
  const checkSvg = document.querySelector('.check-svg');
  const checkPath = document.querySelector('.check-svg__path');

  const titleContainer = document.getElementById('titleContainer');
  const subtitleContainer = document.getElementById('subtitleContainer');
  const resendRow = document.getElementById('resendRow');
  const resendBtn = document.getElementById('resendBtn');
  const retrySuccessBtn = document.getElementById('retrySuccessBtn');
  const liveRegion = document.getElementById('liveRegion');

  const demoValidBtn = document.getElementById('demoValidBtn');
  const demoInvalidBtn = document.getElementById('demoInvalidBtn');
  const slowMoBtn = document.getElementById('slowMoBtn');
  const soundBtn = document.getElementById('soundBtn');
  const resetBtn = document.getElementById('resetBtn');

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Wider, tactile playing-card fan geometry */
  const FAN_ANGLES = [-16, -5.5, 5.5, 16];
  const FAN_X = [-10, -3, 3, 10];
  const FAN_Y = [-6, -18, -18, -6];

  /* Tangible physical deck stack offsets (100% opaque, layered by brightness) */
  const STACK_ANGLES = [-5.5, 3.5, -2, 0];
  const STACK_Y = [6, 4, 2, 0];
  const STACK_SCALE = [0.955, 0.97, 0.985, 1];
  const STACK_BRIGHTNESS = [0.72, 0.82, 0.91, 1];

  let slowMo = false;
  let soundEnabled = true;
  let isBusy = false;
  let suppressNextFocusSound = true;
  let runId = 0;
  let resendTimer = null;
  let activeAnimations = [];
  let pendingTimeouts = new Set();

  const DeckAudio = window.DeckAudio || {
    setEnabled() {},
    stopScheduled() {},
    playFocus() {},
    playType() {},
    playDelete() {},
    playFanCard() {},
    playStackCard() {},
    playStackLock() {},
    playOpticalBeat() {},
    playSuccess() {},
    playError() {},
    playDealCard() {},
  };
  DeckAudio.setEnabled(soundEnabled);

  const getScale = () => (slowMo ? 2.5 : 1);

  const scheduleTask = (fn, delayMs, currentRunId) => {
    const id = setTimeout(() => {
      pendingTimeouts.delete(id);
      if (currentRunId === runId) fn();
    }, delayMs);
    pendingTimeouts.add(id);
    return id;
  };

  const wait = (ms, currentRunId) =>
    new Promise((resolve) => {
      const id = setTimeout(() => {
        pendingTimeouts.delete(id);
        resolve(currentRunId === runId);
      }, ms * getScale());
      pendingTimeouts.add(id);
    });

  function trackAnim(anim) {
    if (anim) activeAnimations.push(anim);
    return anim;
  }

  function safeFinished(anim) {
    return anim ? anim.finished.catch(() => {}) : Promise.resolve();
  }

  function clearAnimationsAndTimers() {
    DeckAudio.stopScheduled();
    pendingTimeouts.forEach((id) => clearTimeout(id));
    pendingTimeouts.clear();
    activeAnimations.forEach((anim) => {
      try {
        anim.cancel();
      } catch (_) {
        // Ignore already-finished animation cancellation errors
      }
    });
    activeAnimations = [];
    document.querySelectorAll('.kinetic-text--exiting').forEach((el) => el.remove());
  }

  /* Kinetic Typography: masked vertical wipe with zero ghost overlap */
  function setKineticText(container, html, isHtml = false) {
    container.querySelectorAll('.kinetic-text--exiting').forEach((el) => el.remove());
    const current = container.querySelector('.kinetic-text');
    const nextText = isHtml ? html : escapeHtml(html);
    if (current && current.innerHTML.trim() === nextText.trim()) return;

    if (current) {
      current.classList.add('kinetic-text--exiting');
      if (prefersReducedMotion) {
        current.remove();
      } else {
        const exitAnim = trackAnim(
          current.animate(
            [
              { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
              { opacity: 0, transform: 'translateY(-110%)', filter: 'blur(3px)' },
            ],
            {
              duration: 220 * getScale(),
              easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
              fill: 'forwards',
            }
          )
        );
        exitAnim.onfinish = () => current.remove();
        exitAnim.oncancel = () => current.remove();
      }
    }

    const incoming = document.createElement('span');
    incoming.className = 'kinetic-text';
    incoming.innerHTML = nextText;
    container.appendChild(incoming);

    if (!prefersReducedMotion) {
      trackAnim(
        incoming.animate(
          [
            { opacity: 0, transform: 'translateY(110%)', filter: 'blur(3px)' },
            { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
          ],
          {
            duration: 260 * getScale(),
            delay: 35 * getScale(),
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both',
          }
        )
      );
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function setStatusCopy(state) {
    document.body.setAttribute('data-state', state);
    if (state === 'idle') {
      setKineticText(titleContainer, 'Enter your code');
      setKineticText(
        subtitleContainer,
        'Sent to <span class="phone-mask">+1 415 •••• 0142</span>',
        true
      );
      liveRegion.textContent = 'Ready for 4-digit verification code.';
    } else if (state === 'verifying') {
      setKineticText(titleContainer, 'Checking your code');
      setKineticText(subtitleContainer, 'One moment — confirming it.');
      liveRegion.textContent = 'Checking your verification code.';
    } else if (state === 'success') {
      setKineticText(titleContainer, 'Code verified');
      setKineticText(subtitleContainer, 'You’re all set — welcome back.');
      liveRegion.textContent = 'Code verified. Welcome back.';
    } else if (state === 'error') {
      setKineticText(titleContainer, 'Incorrect code');
      setKineticText(subtitleContainer, 'That code didn’t match. Try again.');
      liveRegion.textContent = 'Incorrect code. Try again.';
    }
  }

  function updateFocusStyles(focusedIndex) {
    slots.forEach((slot, idx) => {
      slot.classList.toggle('is-focused', !isBusy && idx === focusedIndex);
    });
  }

  function setDigit(index, char, animatePress = true) {
    const input = inputs[index];
    const digitEl = digits[index];
    const cardEl = cards[index];
    const slot = slots[index];

    const clean = char ? char.replace(/\D/g, '').slice(-1) : '';
    input.value = clean;
    digitEl.textContent = clean;
    slot.classList.toggle('is-filled', Boolean(clean));

    if (clean && animatePress && !prefersReducedMotion) {
      DeckAudio.playType(index);
      // Physical press-down -> spring rebound
      trackAnim(
        cardEl.animate(
          [
            { transform: 'translateY(-4px) rotateX(4deg) scale(1)' },
            { transform: 'translateY(2px) rotateX(-2deg) scale(0.955)', offset: 0.32 },
            { transform: 'translateY(-5px) rotateX(3deg) scale(1.02)', offset: 0.72 },
            { transform: 'translateY(0) rotateX(0deg) scale(1)' },
          ],
          {
            duration: 240 * getScale(),
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          }
        )
      );
      trackAnim(
        digitEl.animate(
          [
            { opacity: 0, transform: 'translateY(7px) scale(0.8)', filter: 'blur(2px)' },
            { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
          ],
          {
            duration: 170 * getScale(),
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          }
        )
      );
    }
  }

  function getCode() {
    return inputs.map((i) => i.value).join('');
  }

  function computeCenterOffsets() {
    const rowRect = slotsRow.getBoundingClientRect();
    const rowCenterX = rowRect.left + rowRect.width / 2;
    return slots.map((slot) => {
      const rect = slot.getBoundingClientRect();
      return rowCenterX - (rect.left + rect.width / 2);
    });
  }

  async function runVerificationSequence(code) {
    if (isBusy) return;
    isBusy = true;
    const myRunId = ++runId;

    inputs.forEach((inp) => {
      inp.disabled = true;
      inp.blur();
    });
    updateFocusStyles(-1);
    resendRow.classList.add('is-muted');
    setStatusCopy('verifying');

    if (prefersReducedMotion) {
      beamSvg.classList.add('is-visible');
      deckCoreGlow.classList.add('is-active');
      deckDeskLight.classList.add('is-active');
      DeckAudio.playOpticalBeat(650 * getScale());
      if (!(await wait(650, myRunId))) return;
      if (code === VALID_CODE) {
        setStatusCopy('success');
        DeckAudio.playSuccess();
        beamSvg.classList.add('is-solid');
        checkSvg.classList.add('is-visible');
        checkPath.style.strokeDashoffset = '0';
        resendRow.hidden = true;
        retrySuccessBtn.hidden = false;
      } else {
        setStatusCopy('error');
        DeckAudio.playError(getScale());
        if (!(await wait(650, myRunId))) return;
        await resetToIdle(true);
      }
      isBusy = false;
      return;
    }

    // Phase 1: Playing-Card Hand Fan Out
    const fanPromises = cards.map((card, i) => {
      const delayMs = i * 30 * getScale();
      scheduleTask(() => DeckAudio.playFanCard(i), delayMs, myRunId);
      slots[i].style.zIndex = String(10 + i);
      card.style.zIndex = String(10 + i);
      trackAnim(
        sheens[i].animate(
          [
            { opacity: 0, transform: 'translateX(-125%)' },
            { opacity: 0.9, offset: 0.45 },
            { opacity: 0, transform: 'translateX(135%)' },
          ],
          {
            duration: 440 * getScale(),
            delay: (30 + i * 35) * getScale(),
            easing: 'ease-out',
          }
        )
      );

      const anim = trackAnim(
        card.animate(
          [
            {
              transform: 'translate3d(0, 0, 0) rotateX(0deg) rotateZ(0deg) scale(1)',
              filter: 'brightness(1)',
              boxShadow:
                '0 2px 0 #111216, 0 3px 0 rgba(255,255,255,0.045), 0 10px 22px -6px rgba(0,0,0,0.78), inset 0 1px 0 rgba(255,255,255,0.2)',
            },
            {
              transform: `translate3d(${FAN_X[i]}px, ${FAN_Y[i]}px, 0) rotateX(6deg) rotateZ(${FAN_ANGLES[i]}deg) scale(1.035)`,
              filter: 'brightness(1)',
              boxShadow:
                '0 3px 0 #111216, 0 4px 0 rgba(255,255,255,0.06), 0 24px 36px -8px rgba(0,0,0,0.88), inset 0 1px 0 rgba(255,255,255,0.28)',
            },
          ],
          {
            duration: 320 * getScale(),
            delay: delayMs,
            easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
            fill: 'forwards',
          }
        )
      );
      return safeFinished(anim);
    });

    await Promise.all(fanPromises);
    if (myRunId !== runId) return;

    if (!(await wait(105, myRunId))) return;

    // Phase 2: Bottom-to-Top Silk Riffle Stack (card 01 seats first, 04 layers cleanly on top)
    const centerDeltas = computeCenterOffsets();
    const stackPromises = cards.map((card, i) => {
      slots[i].classList.add('is-stacked');
      const delayMs = i * 34 * getScale();
      scheduleTask(() => DeckAudio.playStackCard(i), delayMs, myRunId);

      const midX = FAN_X[i] * 0.45 + centerDeltas[i] * 0.55;
      const midY = Math.min(FAN_Y[i], STACK_Y[i]) - 6;

      const anim = trackAnim(
        card.animate(
          [
            {
              transform: `translate3d(${FAN_X[i]}px, ${FAN_Y[i]}px, 0) rotateX(6deg) rotateZ(${FAN_ANGLES[i]}deg) scale(1.035)`,
              filter: 'brightness(1)',
              easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
            },
            {
              transform: `translate3d(${midX}px, ${midY}px, 0) rotateX(2deg) rotateZ(${FAN_ANGLES[i] * 0.25}deg) scale(1.015)`,
              filter: `brightness(${(1 + STACK_BRIGHTNESS[i]) * 0.5})`,
              offset: 0.38,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            },
            {
              transform: `translate3d(${centerDeltas[i]}px, ${STACK_Y[i]}px, 0) rotateX(0deg) rotateZ(${STACK_ANGLES[i]}deg) scale(${STACK_SCALE[i]})`,
              filter: `brightness(${STACK_BRIGHTNESS[i]})`,
            },
          ],
          {
            duration: 460 * getScale(),
            delay: delayMs,
            fill: 'forwards',
          }
        )
      );

      trackAnim(
        digits[i].animate(
          [
            { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
            { opacity: 0, transform: 'scale(0.76)', filter: 'blur(3px)' },
          ],
          {
            duration: 210 * getScale(),
            delay: (40 + i * 24) * getScale(),
            easing: 'ease-out',
            fill: 'forwards',
          }
        )
      );

      return safeFinished(anim);
    });

    await Promise.all(stackPromises);
    if (myRunId !== runId) return;

    DeckAudio.playStackLock();

    // Phase 3: Rhythmic Whip-Cadence Optical Beam + Synced Desk Glow
    beamSvg.classList.add('is-visible');
    deckCoreGlow.classList.add('is-active');
    deckDeskLight.classList.add('is-active');

    const BEAT_MS = 920 * getScale();
    const WHIP_EASING = 'cubic-bezier(0.76, 0, 0.24, 1)';

    DeckAudio.playOpticalBeat(BEAT_MS);
    scheduleTask(() => DeckAudio.playOpticalBeat(BEAT_MS), BEAT_MS, myRunId);

    const orbitLoops = beamStrokes.map((stroke) =>
      trackAnim(
        stroke.animate(
          [{ strokeDashoffset: 0 }, { strokeDashoffset: -1 }],
          {
            duration: BEAT_MS,
            iterations: Infinity,
            easing: WHIP_EASING,
          }
        )
      )
    );

    const stretchBloom = trackAnim(
      beamBloom.animate(
        [
          { strokeDasharray: '0.14 0.86', opacity: 0.48 },
          { strokeDasharray: '0.36 0.64', opacity: 1, offset: 0.45 },
          { strokeDasharray: '0.14 0.86', opacity: 0.5 },
        ],
        {
          duration: BEAT_MS,
          iterations: Infinity,
          easing: 'ease-in-out',
        }
      )
    );

    const stretchCore = trackAnim(
      beamCore.animate(
        [
          { strokeDasharray: '0.14 0.86', opacity: 0.72 },
          { strokeDasharray: '0.36 0.64', opacity: 1, offset: 0.45 },
          { strokeDasharray: '0.14 0.86', opacity: 0.75 },
        ],
        {
          duration: BEAT_MS,
          iterations: Infinity,
          easing: 'ease-in-out',
        }
      )
    );

    const deskBeat = trackAnim(
      deckDeskLight.animate(
        [
          { opacity: 0.42, transform: 'translate(-50%, -50%) scale(0.84)' },
          { opacity: 0.95, transform: 'translate(-50%, -50%) scale(1.06)', offset: 0.45 },
          { opacity: 0.45, transform: 'translate(-50%, -50%) scale(0.86)' },
        ],
        {
          duration: BEAT_MS,
          iterations: Infinity,
          easing: 'ease-in-out',
        }
      )
    );

    const topCard = cards[SLOT_COUNT - 1];
    const topCenterX = centerDeltas[SLOT_COUNT - 1];

    const topPulse = trackAnim(
      topCard.animate(
        [
          { transform: `translate3d(${topCenterX}px, 0px, 0) scale(1)` },
          { transform: `translate3d(${topCenterX}px, 0px, 0) scale(1.022)`, offset: 0.45 },
          { transform: `translate3d(${topCenterX}px, 0px, 0) scale(1)` },
        ],
        {
          duration: BEAT_MS,
          iterations: Infinity,
          easing: 'ease-in-out',
        }
      )
    );

    const overlayPulse = trackAnim(
      deckOverlayInner.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.022)', offset: 0.45 },
          { transform: 'scale(1)' },
        ],
        {
          duration: BEAT_MS,
          iterations: Infinity,
          easing: 'ease-in-out',
        }
      )
    );

    // Let ~1.5 rhythmic beats play cleanly
    if (!(await wait(1380, myRunId))) return;

    // Stop rhythmic loops cleanly before resolving
    orbitLoops.forEach((a) => a.cancel());
    stretchBloom.cancel();
    stretchCore.cancel();
    deskBeat.cancel();
    topPulse.cancel();
    overlayPulse.cancel();

    // Phase 4A: Success (3D Tactile Snap + Lock-in Border + Single Hairline Ripple)
    if (code === VALID_CODE) {
      setStatusCopy('success');
      DeckAudio.playSuccess();
      beamSvg.classList.add('is-solid');

      // Subtle victorious settle on lower 3 cards
      cards.slice(0, SLOT_COUNT - 1).forEach((card, i) => {
        trackAnim(
          card.animate(
            [
              {
                transform: `translate3d(${centerDeltas[i]}px, ${STACK_Y[i]}px, 0) rotateZ(${STACK_ANGLES[i]}deg) scale(${STACK_SCALE[i]})`,
              },
              {
                transform: `translate3d(${centerDeltas[i]}px, ${STACK_Y[i]}px, 0) rotateZ(${STACK_ANGLES[i]}deg) scale(${STACK_SCALE[i] * 1.04})`,
              },
              {
                transform: `translate3d(${centerDeltas[i]}px, ${STACK_Y[i]}px, 0) rotateZ(${STACK_ANGLES[i]}deg) scale(${STACK_SCALE[i]})`,
              },
            ],
            {
              duration: 420 * getScale(),
              easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
              fill: 'forwards',
            }
          )
        );
      });

      // Top card + overlay perform synchronized 3D tactile snap
      const snapFrames = (x) => [
        { transform: `translate3d(${x}px, 0, 0) rotateY(0deg) scale(1)` },
        { transform: `translate3d(${x}px, 0, 0) rotateY(-12deg) scale(1.06)`, offset: 0.42 },
        { transform: `translate3d(${x}px, 0, 0) rotateY(0deg) scale(1)` },
      ];

      trackAnim(
        topCard.animate(snapFrames(topCenterX), {
          duration: 460 * getScale(),
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards',
        })
      );

      trackAnim(
        deckOverlayInner.animate(snapFrames(0), {
          duration: 460 * getScale(),
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards',
        })
      );

      // Single expanding hairline ripple ring
      trackAnim(
        rippleRing.animate(
          [
            { opacity: 0.72, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(1.62)' },
          ],
          {
            duration: 620 * getScale(),
            delay: 70 * getScale(),
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'forwards',
          }
        )
      );

      checkSvg.classList.add('is-visible');
      trackAnim(
        checkPath.animate(
          [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
          {
            duration: 340 * getScale(),
            delay: 110 * getScale(),
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards',
          }
        )
      );

      resendRow.hidden = true;
      retrySuccessBtn.hidden = false;
      isBusy = false;
      return;
    }

    // Phase 4B: Error (Double-Beat Crimson Flash + Damped Shake + Dealer Deal-Back)
    setStatusCopy('error');
    DeckAudio.playError(getScale());
    beamSvg.classList.add('is-solid');

    // Double-beat crimson flash synced with the shake peaks
    trackAnim(
      beamSvg.animate(
        [{ opacity: 1 }, { opacity: 0.3, offset: 0.25 }, { opacity: 1, offset: 0.5 }, { opacity: 0.85 }],
        { duration: 420 * getScale(), easing: 'ease-in-out' }
      )
    );

    const shakeX = [0, -11, 10, -7, 5, -2, 0];
    const shakeRot = [0, -2.5, 2.2, -1.6, 1.1, -0.4, 0];

    const shakePromises = cards.map((card, i) => {
      const frames = shakeX.map((dx, k) => ({
        transform: `translate3d(${centerDeltas[i] + dx}px, ${STACK_Y[i]}px, 0) rotateZ(${STACK_ANGLES[i] + shakeRot[k]}deg) scale(${STACK_SCALE[i]})`,
      }));
      return safeFinished(
        trackAnim(
          card.animate(frames, {
            duration: 420 * getScale(),
            easing: 'ease-in-out',
          })
        )
      );
    });

    trackAnim(
      deckOverlayInner.animate(
        shakeX.map((dx, k) => ({
          transform: `translate3d(${dx}px, 0, 0) rotateZ(${shakeRot[k]}deg)`,
        })),
        {
          duration: 420 * getScale(),
          easing: 'ease-in-out',
        }
      )
    );

    await Promise.all(shakePromises);
    if (myRunId !== runId) return;

    if (!(await wait(220, myRunId))) return;

    beamSvg.classList.remove('is-visible', 'is-solid');
    deckCoreGlow.classList.remove('is-active');
    deckDeskLight.classList.remove('is-active');

    // Crisp top-to-bottom dealer deal-back onto the clean matte desk with cushioned settle
    const dealPromises = cards.map((card, i) => {
      slots[i].classList.remove('is-stacked');
      slots[i].classList.add('is-error-flash');

      const delayMs = (SLOT_COUNT - 1 - i) * 42 * getScale();
      scheduleTask(() => DeckAudio.playDealCard(i, getScale()), delayMs, myRunId);

      const anim = trackAnim(
        card.animate(
          [
            {
              transform: `translate3d(${centerDeltas[i]}px, ${STACK_Y[i]}px, 0) rotateZ(${STACK_ANGLES[i]}deg) scale(${STACK_SCALE[i]})`,
              filter: `brightness(${STACK_BRIGHTNESS[i]})`,
              easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
            },
            {
              transform: `translate3d(${centerDeltas[i] * 0.36}px, -15px, 0) rotateZ(${FAN_ANGLES[i] * 0.35}deg) scale(1.025)`,
              filter: 'brightness(1)',
              offset: 0.4,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            },
            {
              transform: 'translate3d(0, 1.5px, 0) rotateZ(0deg) scale(0.99)',
              filter: 'brightness(1)',
              offset: 0.82,
              easing: 'ease-out',
            },
            {
              transform: 'translate3d(0, 0, 0) rotateZ(0deg) scale(1)',
              filter: 'brightness(1)',
            },
          ],
          {
            duration: 460 * getScale(),
            delay: delayMs,
            fill: 'forwards',
          }
        )
      );
      return safeFinished(anim);
    });

    await Promise.all(dealPromises);
    if (myRunId !== runId) return;

    if (!(await wait(160, myRunId))) return;
    await resetToIdle(true);
  }

  async function resetToIdle(keepErrorHint = false) {
    runId += 1;
    clearAnimationsAndTimers();
    isBusy = false;

    beamSvg.classList.remove('is-visible', 'is-solid');
    deckCoreGlow.classList.remove('is-active');
    deckDeskLight.classList.remove('is-active');
    checkSvg.classList.remove('is-visible');
    checkPath.style.strokeDashoffset = '1';
    rippleRing.style.opacity = '0';
    rippleRing.style.transform = '';

    cards.forEach((card, i) => {
      slots[i].style.zIndex = '';
      card.style.zIndex = '';
      card.style.transform = '';
      card.style.opacity = '';
      card.style.filter = '';
      card.style.boxShadow = '';
      frames[i].style.opacity = '';
      sheens[i].style.transform = '';
      sheens[i].style.opacity = '';
      digits[i].style.opacity = '';
      digits[i].style.transform = '';
      digits[i].style.filter = '';
      slots[i].classList.remove('is-error-flash', 'is-filled', 'is-stacked');
      inputs[i].disabled = false;
      inputs[i].value = '';
      digits[i].textContent = '';
    });

    deckOverlayInner.style.transform = '';
    resendRow.hidden = false;
    resendRow.classList.remove('is-muted');
    retrySuccessBtn.hidden = true;

    if (!keepErrorHint) {
      setStatusCopy('idle');
    } else {
      document.body.setAttribute('data-state', 'idle');
      setKineticText(titleContainer, 'Enter your code');
      setKineticText(
        subtitleContainer,
        'Sent to <span class="phone-mask">+1 415 •••• 0142</span>',
        true
      );
    }

    suppressNextFocusSound = true;
    inputs[0].focus();
    updateFocusStyles(0);
  }

  async function autoTypeDemo(code) {
    await resetToIdle(false);
    const myRunId = runId;
    const chars = code.split('');
    for (let i = 0; i < chars.length; i++) {
      if (myRunId !== runId) return;
      suppressNextFocusSound = true;
      inputs[i].focus();
      updateFocusStyles(i);
      setDigit(i, chars[i], true);
      if (i < chars.length - 1) {
        if (!(await wait(135, myRunId))) return;
      }
    }
    if (!(await wait(140, myRunId))) return;
    runVerificationSequence(code);
  }

  /* Input & Keyboard Ergonomics */
  inputs.forEach((input, idx) => {
    input.addEventListener('focus', () => {
      if (isBusy) return;
      if (document.body.getAttribute('data-state') !== 'idle') {
        setStatusCopy('idle');
      }
      if (suppressNextFocusSound) {
        suppressNextFocusSound = false;
      } else {
        DeckAudio.playFocus();
      }
      updateFocusStyles(idx);
    });

    input.addEventListener('blur', () => {
      if (!isBusy) updateFocusStyles(-1);
    });

    input.addEventListener('input', (e) => {
      if (isBusy) return;
      const raw = e.target.value.replace(/\D/g, '');
      if (!raw) {
        setDigit(idx, '', false);
        return;
      }

      if (raw.length > 1) {
        fillFromString(raw, idx);
        return;
      }

      setDigit(idx, raw, true);

      if (idx < SLOT_COUNT - 1) {
        suppressNextFocusSound = true;
        inputs[idx + 1].focus();
        updateFocusStyles(idx + 1);
      } else {
        const code = getCode();
        if (code.length === SLOT_COUNT) {
          runVerificationSequence(code);
        }
      }
    });

    input.addEventListener('keydown', (e) => {
      if (isBusy) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (input.value) {
          DeckAudio.playDelete();
          setDigit(idx, '', false);
        } else if (idx > 0) {
          DeckAudio.playDelete();
          suppressNextFocusSound = true;
          inputs[idx - 1].focus();
          updateFocusStyles(idx - 1);
          setDigit(idx - 1, '', false);
        }
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        e.preventDefault();
        inputs[idx - 1].focus();
        updateFocusStyles(idx - 1);
      } else if (e.key === 'ArrowRight' && idx < SLOT_COUNT - 1) {
        e.preventDefault();
        inputs[idx + 1].focus();
        updateFocusStyles(idx + 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const code = getCode();
        if (code.length === SLOT_COUNT) {
          runVerificationSequence(code);
        } else if (code.length === 0) {
          autoTypeDemo(VALID_CODE);
        }
      }
    });

    input.addEventListener('paste', (e) => {
      if (isBusy) return;
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      if (pasted) {
        fillFromString(pasted, idx);
      }
    });
  });

  async function fillFromString(digitsStr, startIdx = 0) {
    const myRunId = runId;
    const chars = digitsStr.slice(0, SLOT_COUNT - startIdx).split('');
    for (let offset = 0; offset < chars.length; offset++) {
      if (myRunId !== runId) return;
      const targetIdx = startIdx + offset;
      setDigit(targetIdx, chars[offset], true);
      if (offset < chars.length - 1) {
        await wait(45, myRunId);
      }
    }
    const nextIdx = Math.min(startIdx + chars.length, SLOT_COUNT - 1);
    suppressNextFocusSound = true;
    inputs[nextIdx].focus();
    updateFocusStyles(nextIdx);

    const fullCode = getCode();
    if (fullCode.length === SLOT_COUNT) {
      await wait(120, myRunId);
      if (myRunId === runId) runVerificationSequence(fullCode);
    }
  }

  /* Controls */
  demoValidBtn.addEventListener('click', () => autoTypeDemo(VALID_CODE));
  demoInvalidBtn.addEventListener('click', () => autoTypeDemo('5829'));
  resetBtn.addEventListener('click', () => resetToIdle(false));
  retrySuccessBtn.addEventListener('click', () => resetToIdle(false));

  slowMoBtn.addEventListener('click', () => {
    slowMo = !slowMo;
    slowMoBtn.setAttribute('aria-pressed', String(slowMo));
  });

  soundBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundBtn.setAttribute('aria-pressed', String(soundEnabled));
    DeckAudio.setEnabled(soundEnabled);
    if (soundEnabled) DeckAudio.playType(1);
  });

  resendBtn.addEventListener('click', () => {
    if (resendTimer || isBusy) return;
    let remaining = 30;
    resendBtn.disabled = true;
    resendBtn.textContent = `Sent (${remaining}s)`;
    setKineticText(subtitleContainer, 'A fresh code is on its way.');
    resendTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(resendTimer);
        resendTimer = null;
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend';
      } else {
        resendBtn.textContent = `Sent (${remaining}s)`;
      }
    }, 1000);
  });

  // Initial focus
  suppressNextFocusSound = true;
  inputs[0].focus();
  updateFocusStyles(0);
})();
