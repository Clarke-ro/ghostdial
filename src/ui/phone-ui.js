import { createPhoneControls } from './controls.js';
import { handleKeyboardEvent } from './keyboard.js';
import {
  createMultiTapController,
  MULTI_TAP_COMMIT_DELAY,
} from './multi-tap.js';
import { createRenderer } from './render.js';
import { createNoopAudioService } from './audio.js';

const MAX_INPUT_LENGTH = 160;
const END_PAUSE_MS = 1500;

const INTERACTIVE_LIFECYCLES = new Set(['idle', 'interactive', 'error']);

function isPromiseLike(value) {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function';
}

function readNow(clock) {
  if (typeof clock === 'function') {
    return clock();
  }

  if (clock && typeof clock.now === 'function') {
    return clock.now();
  }

  return Date.now();
}

function safeAudioCall(audio, method, ...args) {
  try {
    if (!audio || typeof audio[method] !== 'function') {
      return undefined;
    }

    const result = audio[method](...args);
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
    return result;
  } catch {
    // Audio is presentation-only. A browser or fake-audio failure must never
    // change the input, engine, lifecycle, or timer behavior.
    return undefined;
  }
}

function setControlDisabled(control, disabled) {
  if (!control) {
    return;
  }

  control.disabled = Boolean(disabled);
  control.setAttribute?.('aria-disabled', String(Boolean(disabled)));
}

function copyPending(pending) {
  return pending ? { ...pending } : null;
}

/**
 * Mount the browser phone and return its deterministic controller seam.
 *
 * The controller owns browser lifecycle state and input buffering, while the
 * injected transition remains the only source of engine state and screen
 * results. Audio is deliberately called defensively and never participates in
 * a transition or snapshot.
 *
 * @param {Element} root
 * @param {object} options
 * @param {(state: object|null, input: string, provider: Function) => object|Promise<object>} options.transition
 * @param {Function} options.aiProvider
 * @param {object} [options.audio]
 * @param {object|Function} [options.clock=globalThis]
 * @param {Function} [options.setTimeoutFn=globalThis.setTimeout]
 * @param {Function} [options.clearTimeoutFn=globalThis.clearTimeout]
 * @param {number} [options.endPauseMs=1500]
 * @returns {object}
 */
export function mountPhoneUI(root, {
  transition,
  aiProvider,
  audio = createNoopAudioService(),
  clock = globalThis,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  endPauseMs = END_PAUSE_MS,
} = {}) {
  if (!root || typeof root.append !== 'function') {
    throw new TypeError('mountPhoneUI requires a root element');
  }
  if (typeof transition !== 'function') {
    throw new TypeError('mountPhoneUI requires a transition function');
  }
  if (typeof aiProvider !== 'function') {
    throw new TypeError('mountPhoneUI requires an AI provider');
  }
  if (typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
    throw new TypeError('mountPhoneUI requires timer functions');
  }
  if (!Number.isFinite(endPauseMs) || endPauseMs < 0) {
    throw new RangeError('endPauseMs must be a non-negative finite number');
  }

  const documentRef = root.ownerDocument ?? globalThis.document;
  let destroyed = false;
  let engineState = null;
  let lifecycle = 'idle';
  let screen = null;
  let pendingTransition = null;
  let endTimer = null;
  let transitionToken = 0;
  let endToken = 0;
  let muted = false;

  let controls;
  let renderer;
  let multiTap;

  function isInteractive() {
    return INTERACTIVE_LIFECYCLES.has(lifecycle);
  }

  function isActiveConScreen() {
    return lifecycle === 'interactive'
      && engineState !== null
      && screen?.type === 'CON';
  }

  function updateNavigationDisabled() {
    const disabled = !isActiveConScreen();
    setControlDisabled(controls?.backKey, disabled);
    setControlDisabled(controls?.homeKey, disabled);
  }

  function render() {
    renderer.render({
      lifecycle,
      screen,
      inputBuffer: multiTap.getInputBuffer(),
      muted,
    });
    updateNavigationDisabled();
  }

  function syncInput() {
    renderer.renderInput(multiTap.getInputBuffer());
  }

  function clearEndTimer() {
    endToken += 1;
    if (endTimer !== null) {
      clearTimeoutFn(endTimer);
      endTimer = null;
    }
  }

  function stopConnecting() {
    safeAudioCall(audio, 'stopConnecting');
  }

  function leaveLoading() {
    if (lifecycle === 'loading') {
      stopConnecting();
    }
  }

  function resetToIdle() {
    clearEndTimer();
    leaveLoading();
    pendingTransition = null;
    engineState = null;
    screen = null;
    lifecycle = 'idle';
    multiTap.clear();
    render();
  }

  function scheduleEndReset() {
    clearEndTimer();
    const token = ++endToken;
    endTimer = setTimeoutFn(() => {
      endTimer = null;
      if (destroyed || token !== endToken || lifecycle !== 'end-pause') {
        return;
      }
      resetToIdle();
    }, endPauseMs);
  }

  function adoptResult(result) {
    if (!result || typeof result !== 'object') {
      throw new TypeError('transition must return an engine result');
    }

    const nextScreen = result.screen;
    if (!nextScreen || typeof nextScreen !== 'object') {
      throw new TypeError('transition result must include a screen');
    }

    leaveLoading();
    pendingTransition = null;
    engineState = result.state;
    screen = nextScreen;

    if (nextScreen.type === 'END') {
      lifecycle = 'end-pause';
      render();
      scheduleEndReset();
      return;
    }

    lifecycle = 'interactive';
    render();
  }

  function enterRecoverableError(stateAtStart) {
    leaveLoading();
    pendingTransition = null;
    engineState = stateAtStart;
    screen = null;
    lifecycle = 'error';
    multiTap.clear();
    render();
  }

  function handleResult(result, stateAtStart, token) {
    if (destroyed || token !== transitionToken) {
      return;
    }

    if (isPromiseLike(result)) {
      lifecycle = 'loading';
      pendingTransition = { token, stateAtStart };
      render();
      safeAudioCall(audio, 'startConnecting');

      Promise.resolve(result).then(
        (resolved) => {
          if (destroyed || token !== transitionToken) {
            return;
          }
          adoptResult(resolved);
        },
        () => {
          if (destroyed || token !== transitionToken) {
            return;
          }
          enterRecoverableError(stateAtStart);
        },
      );
      return;
    }

    adoptResult(result);
  }

  function submit(inputOverride) {
    if (destroyed || !isInteractive()) {
      return false;
    }

    const navigationSubmission = inputOverride !== undefined;
    if (navigationSubmission && !isActiveConScreen()) {
      return false;
    }

    // Navigation buttons intentionally discard all stale typed content. The
    // ordinary Call/Enter path commits pending multi-tap before taking its
    // exact submission snapshot.
    if (navigationSubmission) {
      multiTap.clear();
    } else {
      multiTap.commit();
    }

    const stateAtStart = engineState;
    const inputAtStart = navigationSubmission
      ? inputOverride
      : multiTap.getInputBuffer();

    multiTap.clear();
    syncInput();

    const token = ++transitionToken;
    let result;
    try {
      result = transition(stateAtStart, inputAtStart, aiProvider);
    } catch {
      enterRecoverableError(stateAtStart);
      return true;
    }

    handleResult(result, stateAtStart, token);
    return true;
  }

  function appendPrintable(value) {
    if (destroyed || !isInteractive() || typeof value !== 'string') {
      return false;
    }

    multiTap.commit();
    const before = multiTap.getInputBuffer();
    multiTap.appendLiteral(value);
    syncInput();
    return multiTap.getInputBuffer() !== before;
  }

  function handleBackspace() {
    if (destroyed || !isInteractive()) {
      return false;
    }

    const input = multiTap.getInputBuffer();
    if (input.length === 0) {
      syncInput();
      return true;
    }

    const characters = Array.from(input);
    characters.pop();
    multiTap.replaceBuffer(characters.join(''));
    syncInput();
    return true;
  }

  function handleCharacter(label) {
    if (destroyed || !isInteractive()) {
      return false;
    }

    const before = multiTap.getSnapshot();
    const activatedAt = readNow(clock);
    const sameEligibleCycle = before.multiTap?.digit === label
      && activatedAt - before.multiTap.activatedAt < MULTI_TAP_COMMIT_DELAY;
    multiTap.activate(label, engineState, activatedAt);
    const after = multiTap.getSnapshot();
    syncInput();

    // A same-digit cycle is an accepted action even though it replaces one
    // character in place. A different key at a full buffer can commit an old
    // pending character but still reject its own append, so it must not beep.
    return sameEligibleCycle || after.inputBuffer !== before.inputBuffer;
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    safeAudioCall(audio, 'setMuted', muted);
    renderer.renderMute(muted);
  }

  function dispatch(action) {
    if (destroyed || !action || typeof action.type !== 'string') {
      return false;
    }

    let accepted = false;
    switch (action.type) {
      case 'character':
        accepted = handleCharacter(action.label);
        break;
      case 'clear':
        if (isInteractive()) {
          multiTap.clear();
          syncInput();
          accepted = true;
        }
        break;
      case 'call':
      case 'submit':
        accepted = submit();
        break;
      case 'back':
        accepted = submit('0');
        break;
      case 'home':
        accepted = submit('00');
        break;
      case 'printable':
        accepted = appendPrintable(action.value);
        break;
      case 'backspace':
        accepted = handleBackspace();
        break;
      case 'mute-toggle':
        setMuted(!muted);
        accepted = true;
        break;
      default:
        return false;
    }

    if (accepted && action.type !== 'mute-toggle') {
      safeAudioCall(audio, 'keyBeep');
    }
    return accepted;
  }

  function onControlAction(action) {
    dispatch(action);
  }

  function onKeyDown(event) {
    let accepted = false;
    handleKeyboardEvent(event, {
      isInteractive,
      commitPendingMultiTap: () => {
        multiTap.commit();
        syncInput();
      },
      onPrintable: (value) => {
        accepted = dispatch({ type: 'printable', value });
      },
      submit: () => {
        accepted = dispatch({ type: 'submit' });
      },
      backspace: () => {
        accepted = dispatch({ type: 'backspace' });
      },
    });

    // Keyboard handling owns beep gating here because keyboard.js returns
    // handled for a capacity-rejected printable and for empty Backspace.
    // dispatch() already emits the beep for its action, so this is only a
    // marker for the event boundary and intentionally does not beep again.
    return accepted;
  }

  controls = createPhoneControls({
    document: documentRef,
    onAction: onControlAction,
  });
  root.append(controls.enclosure);

  renderer = createRenderer({
    ...controls,
    lcdOutput: controls.screenOutput,
    inputLine: controls.inputLine,
    callButton: controls.callKey,
    clearButton: controls.clearKey,
    backButton: controls.backKey,
    homeButton: controls.homeKey,
    muteButton: controls.muteKey,
  });

  multiTap = createMultiTapController({
    clock,
    setTimeoutFn,
    clearTimeoutFn,
    maxLength: MAX_INPUT_LENGTH,
  });

  const keyboardTarget = documentRef && typeof documentRef.addEventListener === 'function'
    ? documentRef
    : root;
  keyboardTarget?.addEventListener?.('keydown', onKeyDown);

  render();

  return Object.freeze({
    controls,
    dispatch,
    getSnapshot() {
      return {
        engineState,
        lifecycle,
        inputBuffer: multiTap.getInputBuffer(),
        multiTap: copyPending(multiTap.getPending()),
        screen,
      };
    },
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      transitionToken += 1;
      clearEndTimer();
      if (lifecycle === 'loading') {
        stopConnecting();
      }
      multiTap.destroy();
      keyboardTarget?.removeEventListener?.('keydown', onKeyDown);
      safeAudioCall(audio, 'destroy');
    },
  });
}

export const createPhoneUI = mountPhoneUI;

export default mountPhoneUI;
