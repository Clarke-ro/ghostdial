const CHARACTER_LABELS = Object.freeze([
  '1', '2', '3',
  '4', '5', '6',
  '7', '8', '9',
  '*', '0', '#',
]);

/**
 * The controller-facing action names. Navigation actions intentionally carry
 * no label or input value; the controller supplies the engine's exact `0`
 * and `00` submissions when it handles them.
 */
export const CONTROL_ACTION_TYPES = Object.freeze({
  CHARACTER: 'character',
  CALL: 'call',
  CLEAR: 'clear',
  BACK: 'back',
  HOME: 'home',
  MUTE_TOGGLE: 'mute-toggle',
});

/**
 * @typedef {{ type: 'character', label: string } |
 *   { type: 'call' } |
 *   { type: 'clear' } |
 *   { type: 'back' } |
 *   { type: 'home' } |
 *   { type: 'mute-toggle' }} PhoneControlAction
 */

/**
 * Create the semantic phone shell and wire button activations to an action
 * callback. The controls only report actions; they do not own UI or engine
 * state.
 *
 * @param {object} [options]
 * @param {Document} [options.document] Document used to create the elements.
 * @param {(action: PhoneControlAction, event: Event) => void} [options.onAction]
 * Callback invoked for every button activation.
 * @returns {PhoneControls}
 */
export function createPhoneControls({
  document: documentRef = globalThis.document,
  onAction = () => {},
} = {}) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('createPhoneControls requires a document');
  }

  if (typeof onAction !== 'function') {
    throw new TypeError('createPhoneControls requires an action callback');
  }

  const enclosure = documentRef.createElement('section');
  enclosure.className = 'retro-phone';
  enclosure.setAttribute('aria-label', 'Retro phone');

  const lcdDisplay = documentRef.createElement('div');
  lcdDisplay.className = 'lcd-display';
  lcdDisplay.setAttribute('aria-label', 'Phone display');

  const screenOutput = documentRef.createElement('div');
  screenOutput.className = 'screen-output';
  screenOutput.setAttribute('role', 'status');
  screenOutput.setAttribute('aria-live', 'polite');

  const inputLine = documentRef.createElement('div');
  inputLine.className = 'input-line';
  inputLine.setAttribute('aria-label', 'Current input');

  lcdDisplay.append(screenOutput, inputLine);

  const keypad = documentRef.createElement('div');
  keypad.className = 'keypad';
  keypad.setAttribute('role', 'group');
  keypad.setAttribute('aria-label', 'Keypad');

  const characterKeys = CHARACTER_LABELS.map((label) => {
    const button = createButton(documentRef, 'character-key', label);
    button.dataset.label = label;
    button.setAttribute('aria-label', label === '*' ? 'Star' : label === '#' ? 'Hash' : label);
    bindAction(button, { type: CONTROL_ACTION_TYPES.CHARACTER, label }, onAction);
    keypad.append(button);
    return button;
  });

  const phoneActions = documentRef.createElement('div');
  phoneActions.className = 'phone-actions';
  phoneActions.setAttribute('role', 'group');
  phoneActions.setAttribute('aria-label', 'Phone controls');

  const callKey = createButton(documentRef, 'call-key', 'Call');
  const clearKey = createButton(documentRef, 'clear-key', 'Clear');
  const backKey = createButton(documentRef, 'back-key', 'Back');
  const homeKey = createButton(documentRef, 'home-key', 'Home');
  const muteKey = createButton(documentRef, 'mute-key', 'Mute audio');

  bindAction(callKey, { type: CONTROL_ACTION_TYPES.CALL }, onAction);
  bindAction(clearKey, { type: CONTROL_ACTION_TYPES.CLEAR }, onAction);
  bindAction(backKey, { type: CONTROL_ACTION_TYPES.BACK }, onAction);
  bindAction(homeKey, { type: CONTROL_ACTION_TYPES.HOME }, onAction);
  bindAction(muteKey, { type: CONTROL_ACTION_TYPES.MUTE_TOGGLE }, onAction);

  muteKey.setAttribute('aria-pressed', 'false');

  phoneActions.append(callKey, clearKey, backKey, homeKey, muteKey);
  enclosure.append(lcdDisplay, keypad, phoneActions);

  return {
    enclosure,
    lcdDisplay,
    screenOutput,
    inputLine,
    keypad,
    characterKeys,
    phoneActions,
    callKey,
    clearKey,
    backKey,
    homeKey,
    muteKey,
    setMuteState(muted) {
      const isMuted = Boolean(muted);
      muteKey.setAttribute('aria-pressed', String(isMuted));
      muteKey.textContent = isMuted ? 'Unmute audio' : 'Mute audio';
    },
  };
}

/**
 * Build and append one phone shell beneath a mount point.
 *
 * @param {Element} root
 * @param {object} [options]
 * @returns {PhoneControls}
 */
export function mountPhoneControls(root, options = {}) {
  if (!root || typeof root.append !== 'function') {
    throw new TypeError('mountPhoneControls requires a root element');
  }

  const controls = createPhoneControls(options);
  root.append(controls.enclosure);
  return controls;
}

// Keep the construction name easy to discover for consumers that do not need
// the append helper while retaining one implementation and one DOM contract.
export const createPhoneDOM = createPhoneControls;

function createButton(documentRef, className, text) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  return button;
}

function bindAction(button, action, onAction) {
  button.addEventListener('click', (event) => {
    onAction({ ...action }, event);
  });
}

/**
 * @typedef {object} PhoneControls
 * @property {HTMLElement} enclosure
 * @property {HTMLElement} lcdDisplay
 * @property {HTMLElement} screenOutput
 * @property {HTMLElement} inputLine
 * @property {HTMLElement} keypad
 * @property {HTMLButtonElement[]} characterKeys
 * @property {HTMLElement} phoneActions
 * @property {HTMLButtonElement} callKey
 * @property {HTMLButtonElement} clearKey
 * @property {HTMLButtonElement} backKey
 * @property {HTMLButtonElement} homeKey
 * @property {HTMLButtonElement} muteKey
 * @property {(muted: boolean) => void} setMuteState
 */
