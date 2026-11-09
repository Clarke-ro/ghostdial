/**
 * The fixed phone multi-tap alphabet used while answering a question.
 *
 * The space mapped to 0 is intentional. It is a character in the input
 * buffer, not a navigation command.
 */
export const MULTI_TAP_MAPPING = Object.freeze({
  0: ' ',
  2: 'abc',
  3: 'def',
  4: 'ghi',
  5: 'jkl',
  6: 'mno',
  7: 'pqrs',
  8: 'tuv',
  9: 'wxyz',
});

export const MULTI_TAP_COMMIT_DELAY = 800;
export const INPUT_LINE_MAXIMUM = 160;

const CHARACTER_KEY_PATTERN = /^[0-9*#]$/;

function readClock(clock) {
  if (typeof clock === 'function') {
    return clock();
  }

  if (clock && typeof clock.now === 'function') {
    return clock.now();
  }

  return Date.now();
}

function copyPending(pending) {
  return pending ? { ...pending } : null;
}

function hasMapping(label) {
  return Object.prototype.hasOwnProperty.call(MULTI_TAP_MAPPING, label);
}

function snapshot(inputBuffer, pending) {
  return {
    inputBuffer,
    multiTap: copyPending(pending),
  };
}

/**
 * Create a stateful multi-tap input helper.
 *
 * The helper owns the input string because the pending character must remain
 * in that string while it is eligible for cycling. Every call to `activate`
 * represents one detected key activation, including a browser repeat event.
 * The optional `onChange` callback receives a defensive snapshot after each
 * accepted change and after an automatic pending-character commit.
 *
 * @param {object} [options]
 * @param {object|function} [options.clock=Date] Clock with `now()`, or a
 *   function returning milliseconds.
 * @param {Function} [options.setTimeoutFn=setTimeout] Timer seam.
 * @param {Function} [options.clearTimeoutFn=clearTimeout] Timer seam.
 * @param {number} [options.commitDelay=800] Multi-tap commit delay in ms.
 * @param {number} [options.maxLength=160] Maximum JavaScript string length.
 * @param {Function} [options.onChange] State-change callback.
 * @returns {object} Multi-tap controller.
 */
export function createMultiTapController({
  clock = globalThis,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  commitDelay = MULTI_TAP_COMMIT_DELAY,
  maxLength = INPUT_LINE_MAXIMUM,
  onChange,
} = {}) {
  if (!Number.isFinite(commitDelay) || commitDelay < 0) {
    throw new RangeError('commitDelay must be a non-negative finite number');
  }

  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new RangeError('maxLength must be a non-negative integer');
  }

  if (typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
    throw new TypeError('setTimeoutFn and clearTimeoutFn must be functions');
  }

  if (onChange !== undefined && typeof onChange !== 'function') {
    throw new TypeError('onChange must be a function');
  }

  let inputBuffer = '';
  let multiTap = null;
  let timerId = null;
  let timerToken = 0;

  function emitChange() {
    if (onChange) {
      onChange(getSnapshot());
    }
  }

  function cancelTimer() {
    timerToken += 1;
    if (timerId !== null) {
      clearTimeoutFn(timerId);
      timerId = null;
    }
  }

  function commitPending() {
    if (!multiTap) {
      return false;
    }

    multiTap = null;
    cancelTimer();
    emitChange();
    return true;
  }

  function scheduleCommit() {
    cancelTimer();
    if (!multiTap) {
      return;
    }

    const token = timerToken;
    const pendingAtSchedule = multiTap.activatedAt;
    const delay = commitDelay;

    timerId = setTimeoutFn(() => {
      timerId = null;
      if (token !== timerToken || !multiTap) {
        return;
      }

      const elapsed = readClock(clock) - multiTap.activatedAt;
      if (elapsed >= commitDelay) {
        commitPending();
        return;
      }

      // A timer can run early under a coarse or fake scheduler. Recheck the
      // clock instead of committing early and leave the character eligible.
      if (multiTap.activatedAt === pendingAtSchedule) {
        const remaining = Math.max(0, delay - elapsed);
        timerId = setTimeoutFn(() => {
          timerId = null;
          if (token !== timerToken || !multiTap) {
            return;
          }
          const retryElapsed = readClock(clock) - multiTap.activatedAt;
          if (retryElapsed >= commitDelay) {
            commitPending();
          } else {
            scheduleCommit();
          }
        }, remaining);
      }
    }, delay);
  }

  function expireIfNeeded(activatedAt) {
    if (multiTap && activatedAt - multiTap.activatedAt >= commitDelay) {
      commitPending();
    }
  }

  function appendLiteral(text) {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string');
    }

    commitPending();
    if (inputBuffer.length + text.length > maxLength) {
      return getSnapshot();
    }

    if (text.length > 0) {
      inputBuffer += text;
      emitChange();
    }

    return getSnapshot();
  }

  function activate(label, engineState, activatedAt = readClock(clock)) {
    if (typeof label !== 'string' || !CHARACTER_KEY_PATTERN.test(label)) {
      throw new TypeError('label must be one keypad character');
    }

    if (!Number.isFinite(activatedAt)) {
      throw new TypeError('activatedAt must be a finite number');
    }

    expireIfNeeded(activatedAt);

    const questionState = engineState?.view?.kind === 'question';
    const mapping = questionState && hasMapping(label)
      ? MULTI_TAP_MAPPING[label]
      : null;

    if (!mapping) {
      return appendLiteral(label);
    }

    if (
      multiTap &&
      multiTap.digit === label &&
      activatedAt - multiTap.activatedAt < commitDelay
    ) {
      const nextIndex = (multiTap.index + 1) % mapping.length;
      const position = multiTap.bufferPosition;
      inputBuffer =
        inputBuffer.slice(0, position) +
        mapping[nextIndex] +
        inputBuffer.slice(position + 1);
      multiTap = {
        digit: label,
        index: nextIndex,
        bufferPosition: position,
        activatedAt,
      };
      scheduleCommit();
      emitChange();
      return getSnapshot();
    }

    // A different key, a committed pending character, or a new mapped
    // activation starts a fresh candidate at the end of the buffer.
    commitPending();
    if (inputBuffer.length + 1 > maxLength) {
      return getSnapshot();
    }

    const index = 0;
    inputBuffer += mapping[index];
    multiTap = {
      digit: label,
      index,
      bufferPosition: inputBuffer.length - 1,
      activatedAt,
    };
    scheduleCommit();
    emitChange();
    return getSnapshot();
  }

  function clear() {
    const changed = inputBuffer.length > 0 || multiTap !== null;
    inputBuffer = '';
    multiTap = null;
    cancelTimer();
    if (changed) {
      emitChange();
    }
    return getSnapshot();
  }

  function replaceBuffer(nextBuffer) {
    if (typeof nextBuffer !== 'string') {
      throw new TypeError('nextBuffer must be a string');
    }
    if (nextBuffer.length > maxLength) {
      throw new RangeError(`nextBuffer must not exceed ${maxLength} characters`);
    }

    inputBuffer = nextBuffer;
    multiTap = null;
    cancelTimer();
    emitChange();
    return getSnapshot();
  }

  function getSnapshot() {
    return snapshot(inputBuffer, multiTap);
  }

  function destroy() {
    cancelTimer();
    multiTap = null;
  }

  return Object.freeze({
    activate,
    appendLiteral,
    clear,
    commit: commitPending,
    destroy,
    getInputBuffer: () => inputBuffer,
    getPending: () => copyPending(multiTap),
    getSnapshot,
    replaceBuffer,
  });
}

/**
 * Return whether an engine state selects question-specific multi-tap input.
 * This is deliberately the only engine-state inspection in this module.
 */
export function isQuestionState(engineState) {
  return engineState?.view?.kind === 'question';
}
