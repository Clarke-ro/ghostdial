/**
 * Presentation-only generated audio for the phone UI.
 *
 * The service deliberately owns no controller or engine state. Audio is best
 * effort: every browser API boundary is guarded so a missing or blocked Web
 * Audio implementation cannot interrupt an input event.
 */

const KEY_BEEP_FREQUENCIES = Object.freeze([440, 660]);
const KEY_BEEP_DURATION = 0.09;
const KEY_BEEP_ATTACK = 0.012;
const KEY_BEEP_PEAK = 0.055;
const CONNECTING_FREQUENCIES = Object.freeze([220, 330]);
const CONNECTING_PEAK = 0.018;
const CONNECTING_FADE = 0.035;

function invoke(target, method, ...args) {
  try {
    if (target && typeof target[method] === 'function') {
      return target[method](...args);
    }
  } catch {
    // Web Audio methods can fail when autoplay is blocked or a context closes.
  }
  return undefined;
}

function assign(target, property, value) {
  try {
    if (target) {
      target[property] = value;
    }
  } catch {
    // Some browser implementations expose read-only audio-node properties.
  }
}

function scheduleParam(param, method, ...args) {
  if (param && typeof param[method] === 'function') {
    invoke(param, method, ...args);
    return;
  }

  if (method === 'setValueAtTime' && param) {
    assign(param, 'value', args[0]);
  }
}

function currentAudioTime(context, now) {
  try {
    if (Number.isFinite(context?.currentTime)) {
      return context.currentTime;
    }
  } catch {
    // Fall through to the injected clock.
  }

  try {
    const value = now();
    return Number.isFinite(value) ? value / 1000 : 0;
  } catch {
    return 0;
  }
}

function connect(source, destination) {
  invoke(source, 'connect', destination);
}

function stopVoice(voice, when = 0) {
  if (!voice || voice.stopped) {
    return;
  }

  voice.stopped = true;
  for (const oscillator of voice.oscillators) {
    invoke(oscillator, 'stop', when);
  }
}

function releaseVoice(voice) {
  if (!voice) {
    return;
  }

  for (const oscillator of voice.oscillators) {
    invoke(oscillator, 'disconnect');
  }
  invoke(voice.gain, 'disconnect');
}

function createVoice(context, frequencies, {
  peak,
  duration = null,
  now,
} = {}) {
  let gain;
  const oscillators = [];

  try {
    gain = context.createGain();
    for (const frequency of frequencies) {
      const oscillator = context.createOscillator();
      assign(oscillator, 'type', 'sine');
      scheduleParam(oscillator.frequency, 'setValueAtTime', frequency, currentAudioTime(context, now));
      connect(oscillator, gain);
      oscillators.push(oscillator);
    }
    connect(gain, context.destination);
  } catch {
    const failedVoice = { oscillators, gain, stopped: false };
    stopVoice(failedVoice);
    releaseVoice(failedVoice);
    return null;
  }

  const voice = { oscillators, gain, stopped: false };
  const startAt = currentAudioTime(context, now);

  try {
    if (duration === null) {
      scheduleParam(gain?.gain, 'setValueAtTime', peak, startAt);
    } else {
      const attackAt = startAt + KEY_BEEP_ATTACK;
      const endAt = startAt + duration;
      scheduleParam(gain?.gain, 'setValueAtTime', 0, startAt);
      scheduleParam(gain?.gain, 'linearRampToValueAtTime', peak, attackAt);
      scheduleParam(gain?.gain, 'linearRampToValueAtTime', 0, endAt);
    }

    for (const oscillator of oscillators) {
      invoke(oscillator, 'start', startAt);
    }

    if (duration !== null) {
      stopVoice(voice, startAt + duration);
    }
  } catch {
    stopVoice(voice);
    releaseVoice(voice);
    return null;
  }

  return voice;
}

function createNoopMethods() {
  let muted = false;
  let destroyed = false;

  return Object.freeze({
    keyBeep() {},
    startConnecting() {},
    stopConnecting() {},
    setMuted(value) {
      if (!destroyed) {
        muted = Boolean(value);
      }
    },
    isMuted() {
      return muted;
    },
    destroy() {
      destroyed = true;
    },
  });
}

/**
 * Create a generated Web Audio presentation service.
 *
 * The context is created only by keyBeep() or setMuted(false), both of which
 * are intended to be called from accepted user gestures. startConnecting()
 * can use an already-created context, but never creates one by itself.
 *
 * @param {object} [options]
 * @param {Function} [options.AudioContextCtor]
 * @param {() => number} [options.now]
 * @returns {{keyBeep: Function, startConnecting: Function, stopConnecting: Function,
 *   setMuted: Function, isMuted: Function, destroy: Function}}
 */
export function createAudioService({
  AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  let context = null;
  let muted = false;
  let connectingRequested = false;
  let connectingVoice = null;
  let destroyed = false;
  const beepVoices = new Set();

  function resumeIfSuspended(audioContext) {
    try {
      if (audioContext?.state !== 'suspended' || typeof audioContext.resume !== 'function') {
        return;
      }

      const result = audioContext.resume();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // A rejected or throwing resume is an audio-only failure.
    }
  }

  function ensureContext({ allowCreate }) {
    if (destroyed) {
      return null;
    }

    if (!context && allowCreate && typeof AudioContextCtor === 'function') {
      try {
        context = new AudioContextCtor();
      } catch {
        context = null;
      }
    }

    if (context) {
      resumeIfSuspended(context);
    }

    return context;
  }

  function silenceConnectingVoice() {
    const voice = connectingVoice;
    connectingVoice = null;
    if (!voice) {
      return;
    }

    const audioContext = context;
    const endAt = audioContext
      ? currentAudioTime(audioContext, now) + CONNECTING_FADE
      : 0;
    try {
      scheduleParam(voice.gain?.gain, 'linearRampToValueAtTime', 0, endAt);
    } catch {
      // Keep cleanup best effort even when an AudioParam is unavailable.
    }
    stopVoice(voice, endAt);
    releaseVoice(voice);
  }

  function beginConnectingVoice() {
    if (destroyed || muted || connectingVoice || !context) {
      return;
    }

    const voice = createVoice(context, CONNECTING_FREQUENCIES, {
      peak: CONNECTING_PEAK,
      now,
    });
    if (voice) {
      connectingVoice = voice;
    }
  }

  function keyBeep() {
    if (destroyed || muted) {
      return;
    }

    const audioContext = ensureContext({ allowCreate: true });
    if (!audioContext) {
      return;
    }

    const voice = createVoice(audioContext, KEY_BEEP_FREQUENCIES, {
      duration: KEY_BEEP_DURATION,
      peak: KEY_BEEP_PEAK,
      now,
    });
    if (voice) {
      beepVoices.add(voice);
    }
  }

  function startConnecting() {
    if (destroyed) {
      return;
    }

    connectingRequested = true;
    beginConnectingVoice();
  }

  function stopConnecting() {
    connectingRequested = false;
    silenceConnectingVoice();
  }

  function setMuted(value) {
    if (destroyed) {
      return;
    }

    muted = Boolean(value);
    if (muted) {
      silenceConnectingVoice();
      return;
    }

    // Unmuting is a user gesture in the controller, so it is a permitted
    // point to create or resume a context. Missed key beeps are not replayed.
    ensureContext({ allowCreate: true });
    if (connectingRequested) {
      beginConnectingVoice();
    }
  }

  function isMuted() {
    return muted;
  }

  function destroy() {
    if (destroyed) {
      return;
    }

    destroyed = true;
    connectingRequested = false;
    silenceConnectingVoice();

    for (const voice of beepVoices) {
      stopVoice(voice);
      releaseVoice(voice);
    }
    beepVoices.clear();

    const audioContext = context;
    context = null;
    const closeResult = invoke(audioContext, 'close');
    if (closeResult && typeof closeResult.catch === 'function') {
      closeResult.catch(() => {});
    }
  }

  return Object.freeze({
    keyBeep,
    startConnecting,
    stopConnecting,
    setMuted,
    isMuted,
    destroy,
  });
}

/**
 * Return an audio-compatible service for tests and non-browser consumers.
 * It has no timers, browser audio nodes, or side effects.
 */
export function createNoopAudioService() {
  return createNoopMethods();
}

export default createAudioService;
