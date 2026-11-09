/**
 * Physical-keyboard normalization for the phone UI.
 *
 * This module deliberately knows nothing about the engine or the DOM. The
 * controller supplies the small set of state operations needed to commit
 * multi-tap output, append a character, delete a character, and submit.
 */

export const INPUT_LINE_MAXIMUM = 160;

const MODIFIER_NAMES = Object.freeze(['ctrlKey', 'altKey', 'metaKey']);

/**
 * A KeyboardEvent key is printable when it contains one Unicode scalar and
 * is not in Unicode's Other (C) categories. The C categories cover control,
 * format, surrogate, private-use, and unassigned code points.
 *
 * JavaScript string length is intentionally not used for this classification:
 * a supplementary-plane character is one scalar even though it occupies two
 * UTF-16 code units. The input limit is checked separately with .length.
 */
export function isPrintableKeyboardCharacter(value) {
  if (typeof value !== 'string' || Array.from(value).length !== 1) {
    return false;
  }

  return !/^\p{C}$/u.test(value);
}

// A shorter name is useful to callers that do not need to distinguish the
// browser event from the character it carries.
export const isPrintableCharacter = isPrintableKeyboardCharacter;

export function hasKeyboardModifier(event) {
  return MODIFIER_NAMES.some((name) => event?.[name] === true);
}

/**
 * Normalize only the key identity. Modifier handling is retained in the
 * result so callers can leave modified printable keys entirely untouched.
 *
 * @returns {{ type: 'submit'|'backspace'|'printable'|'modified-printable', value?: string }|null}
 */
export function normalizeKeyboardEvent(event) {
  const key = event?.key;

  if (key === 'Enter') {
    return { type: 'submit' };
  }

  if (key === 'Backspace') {
    return { type: 'backspace' };
  }

  if (!isPrintableKeyboardCharacter(key)) {
    return null;
  }

  return {
    type: hasKeyboardModifier(event) ? 'modified-printable' : 'printable',
    value: key,
  };
}

function readInputBuffer(options) {
  if (typeof options.getInputBuffer === 'function') {
    return options.getInputBuffer();
  }

  return typeof options.inputBuffer === 'string' ? options.inputBuffer : '';
}

function writeInputBuffer(options, value) {
  if (typeof options.setInputBuffer === 'function') {
    options.setInputBuffer(value);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(options, 'inputBuffer')) {
    options.inputBuffer = value;
  }
}

function callAction(options, action) {
  if (typeof options.onAction === 'function') {
    options.onAction(action);
    return true;
  }

  if (typeof options.dispatch === 'function') {
    options.dispatch(action);
    return true;
  }

  return false;
}

function commitPending(options) {
  if (typeof options.commitPendingMultiTap === 'function') {
    options.commitPendingMultiTap();
  }
}

function clearPending(options) {
  if (typeof options.clearPendingMultiTap === 'function') {
    options.clearPendingMultiTap();
  }
}

function appendPrintable(options, value) {
  if (typeof options.appendCharacter === 'function') {
    return options.appendCharacter(value) !== false;
  }

  const current = readInputBuffer(options);
  const next = `${current}${value}`;
  if (next.length > INPUT_LINE_MAXIMUM) {
    return false;
  }

  writeInputBuffer(options, next);
  return true;
}

function removeFinalUnicodeScalar(options) {
  const current = readInputBuffer(options);
  if (current.length === 0) {
    return false;
  }

  const characters = Array.from(current);
  characters.pop();
  writeInputBuffer(options, characters.join(''));
  clearPending(options);
  return true;
}

function preventDefaultOnce(event) {
  if (typeof event?.preventDefault === 'function') {
    event.preventDefault();
  }
}

/**
 * Handle one physical keyboard event.
 *
 * The adapter returns true for an interactive event owned by the phone,
 * including a capacity-rejected printable key or Backspace on an empty
 * buffer. It returns false for disabled-state, modified, and unsupported
 * events. Only the former category cancels browser default behavior.
 *
 * The callback-style API lets phone-ui.js retain ownership of its state. For
 * small unit seams, getInputBuffer/setInputBuffer and the multi-tap callbacks
 * provide a complete default implementation for printable and Backspace
 * handling.
 */
export function handleKeyboardEvent(event, options = {}) {
  const isInteractive = typeof options.isInteractive === 'function'
    ? options.isInteractive()
    : options.interactive !== false;

  if (!isInteractive) {
    return false;
  }

  const action = normalizeKeyboardEvent(event);

  // Modified printable characters are intentionally left to the browser so
  // shortcuts such as Ctrl+C and Alt-based input retain their normal meaning.
  if (!action || action.type === 'modified-printable') {
    return false;
  }

  if (action.type === 'submit') {
    // Submission captures the buffer only after pending multi-tap output is
    // committed. A controller that commits in submit() may safely do so
    // again because commit is an idempotent state operation.
    commitPending(options);

    const submit = options.submit ?? options.onSubmit;
    if (typeof submit === 'function') {
      submit();
    } else if (!callAction(options, { type: 'submit' })) {
      return false;
    }

    preventDefaultOnce(event);
    return true;
  }

  if (action.type === 'backspace') {
    const backspace = options.backspace ?? options.onBackspace;
    if (typeof backspace === 'function') {
      backspace();
    } else if (!callAction(options, { type: 'backspace' })) {
      removeFinalUnicodeScalar(options);
    }

    preventDefaultOnce(event);
    return true;
  }

  // Printable keyboard input commits a pending multi-tap character before
  // trying to append. This also commits pending output when the 160-code-unit
  // limit rejects the new character, as required by the input ordering.
  commitPending(options);
  const printable = options.onPrintable ?? options.onInput;
  if (typeof printable === 'function') {
    printable(action.value);
  } else if (typeof options.onAction === 'function' || typeof options.dispatch === 'function') {
    callAction(options, { type: 'printable', value: action.value });
  } else {
    appendPrintable(options, action.value);
  }

  preventDefaultOnce(event);
  return true;
}

export function createKeyboardHandler(options = {}) {
  return (event) => handleKeyboardEvent(event, options);
}

// Explicit aliases make the event boundary easy to use from different
// controller naming conventions without duplicating behavior.
export const handleKeyDown = handleKeyboardEvent;
export const createKeyboardInputHandler = createKeyboardHandler;

export default createKeyboardHandler;
