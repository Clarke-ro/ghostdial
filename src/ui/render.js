const MAX_INPUT_LENGTH = 160;

export const UI_COPY = Object.freeze({
  idle: 'Dial *266# to begin',
  loading: 'Contacting the spirits...',
  error: 'Request failed. Try again.',
});

export const INPUT_LINE_MAXIMUM = MAX_INPUT_LENGTH;

const DISABLED_LIFECYCLES = new Set(['loading', 'end-pause']);

function asElements(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value[Symbol.iterator] === 'function' && typeof value !== 'string') {
    return [...value].filter(Boolean);
  }

  return [value];
}

function setDisabled(element, disabled) {
  if (!element) {
    return;
  }

  element.disabled = disabled;
  element.setAttribute?.('aria-disabled', String(disabled));
}

function setText(element, text) {
  if (!element) {
    return;
  }

  element.textContent = text;
}

function boundedInputText(inputBuffer) {
  const text = typeof inputBuffer === 'string' ? inputBuffer : '';
  return text.length > MAX_INPUT_LENGTH ? text.slice(0, MAX_INPUT_LENGTH) : text;
}

function lifecycleCopy(lifecycle, screenText) {
  if (lifecycle === 'idle') {
    return UI_COPY.idle;
  }

  if (lifecycle === 'loading') {
    return UI_COPY.loading;
  }

  if (lifecycle === 'error') {
    return UI_COPY.error;
  }

  return typeof screenText === 'string' ? screenText : '';
}

/**
 * Render literal output text into the LCD output region.
 *
 * The source string is assigned unchanged. CSS `white-space: pre-wrap` is
 * responsible for displaying CRLF, LF, and CR sequences as line breaks.
 */
export function renderOutput(outputElement, screenText) {
  setText(outputElement, typeof screenText === 'string' ? screenText : '');
}

/**
 * Mirror the complete, bounded input buffer into the LCD input line.
 */
export function renderInput(inputElement, inputBuffer) {
  setText(inputElement, boundedInputText(inputBuffer));
}

/**
 * Update lifecycle attributes and disable only controls that accept session
 * input. Presentation controls such as mute remain available.
 */
export function renderLifecycle({
  lifecycleTarget,
  enclosure,
  characterKeys,
  callButton,
  clearButton,
  backButton,
  homeButton,
  inputControls,
  lifecycle = 'idle',
  disabled,
} = {}) {
  const isDisabled = disabled ?? DISABLED_LIFECYCLES.has(lifecycle);
  const controls = [
    ...asElements(characterKeys),
    callButton,
    clearButton,
    backButton,
    homeButton,
    ...asElements(inputControls),
  ].filter(Boolean);

  const uniqueControls = [...new Set(controls)];
  for (const control of uniqueControls) {
    setDisabled(control, isDisabled);
  }

  const target = lifecycleTarget ?? enclosure;
  if (target) {
    target.dataset && (target.dataset.lifecycle = lifecycle);
    target.setAttribute?.('data-lifecycle', lifecycle);
    target.setAttribute?.('aria-busy', String(lifecycle === 'loading'));
    target.setAttribute?.('data-input-disabled', String(isDisabled));
  }

  return { lifecycle, disabled: isDisabled };
}

/**
 * Update the mute control without consulting or embedding any screen text.
 */
export function renderMute(muteButton, muted = false) {
  if (!muteButton) {
    return;
  }

  const isMuted = Boolean(muted);
  const label = isMuted ? 'Unmute audio' : 'Mute audio';
  setText(muteButton, label);
  muteButton.setAttribute?.('aria-label', label);
  muteButton.setAttribute?.('aria-pressed', String(isMuted));
  muteButton.dataset && (muteButton.dataset.muted = String(isMuted));
}

function screenTextFrom(state = {}) {
  if (typeof state.screenText === 'string') {
    return state.screenText;
  }

  if (typeof state.screen === 'string') {
    return state.screen;
  }

  return state.screen && typeof state.screen.text === 'string'
    ? state.screen.text
    : '';
}

/**
 * Create targeted DOM presentation updates for the phone controller.
 *
 * The controller owns lifecycle and engine state. This module only projects
 * those values into already-created DOM references.
 */
export function createRenderer(elements = {}) {
  const {
    lcdOutput,
    outputElement,
    inputLine,
    inputElement,
    lifecycleTarget,
    enclosure,
    characterKeys,
    callButton,
    clearButton,
    backButton,
    homeButton,
    inputControls,
    muteButton,
  } = elements;

  const output = lcdOutput ?? outputElement;
  const input = inputLine ?? inputElement;

  function render(state = {}) {
    const lifecycle = state.lifecycle ?? 'idle';
    const screenText = lifecycleCopy(lifecycle, screenTextFrom(state));

    renderOutput(output, screenText);
    renderInput(input, state.inputBuffer ?? '');
    renderLifecycle({
      lifecycleTarget,
      enclosure,
      characterKeys,
      callButton,
      clearButton,
      backButton,
      homeButton,
      inputControls,
      lifecycle,
      disabled: state.disabled,
    });
    renderMute(muteButton, state.muted ?? false);

    return {
      lifecycle,
      screenText,
      inputText: boundedInputText(state.inputBuffer ?? ''),
      disabled: state.disabled ?? DISABLED_LIFECYCLES.has(lifecycle),
      muted: Boolean(state.muted),
    };
  }

  return Object.freeze({
    render,
    renderOutput: (screenText) => renderOutput(output, screenText),
    renderInput: (inputBuffer) => renderInput(input, inputBuffer),
    renderLifecycle: (lifecycle, disabled) => renderLifecycle({
      lifecycleTarget,
      enclosure,
      characterKeys,
      callButton,
      clearButton,
      backButton,
      homeButton,
      inputControls,
      lifecycle,
      disabled,
    }),
    renderMute: (muted) => renderMute(muteButton, muted),
  });
}
