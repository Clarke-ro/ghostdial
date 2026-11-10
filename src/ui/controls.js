const CHARACTER_LABELS = Object.freeze([
  '1', '2', '3',
  '4', '5', '6',
  '7', '8', '9',
  '*', '0', '#',
]);

/**
 * Small letters printed next to each number key. They match the multi-tap
 * alphabet in multi-tap.js (0 types a space). CSS shows them with
 * `content: attr(data-letters)`, so the button text stays just the digit.
 */
const KEY_LETTERS = Object.freeze({
  2: 'ABC',
  3: 'DEF',
  4: 'GHI',
  5: 'JKL',
  6: 'MNO',
  7: 'PQRS',
  8: 'TUV',
  9: 'WXYZ',
  0: '␣',
});

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

  // Decorative speaker grille at the top of the phone body.
  const speaker = createElement(documentRef, 'div', 'phone-speaker');
  speaker.setAttribute('aria-hidden', 'true');

  const lcdDisplay = documentRef.createElement('div');
  lcdDisplay.className = 'lcd-display';
  lcdDisplay.setAttribute('aria-label', 'Phone display');

  // Status bar: signal bars, a "No Data" tag, and the session state
  // (IDLE / DIAL / CON / END). The renderer updates the session state text.
  const statusBar = createElement(documentRef, 'div', 'status-bar');
  statusBar.setAttribute('aria-label', 'Status');

  const signalBars = createElement(documentRef, 'span', 'signal-bars');
  signalBars.setAttribute('aria-hidden', 'true');

  const noDataTag = createElement(documentRef, 'span', 'no-data-tag', 'No Data');

  const sessionStateBadge = createElement(documentRef, 'span', 'session-state', 'IDLE');

  const battery = createElement(documentRef, 'span', 'battery');
  battery.setAttribute('aria-hidden', 'true');

  statusBar.append(signalBars, noDataTag, sessionStateBadge, battery);

  // The screen body holds the real screen text plus two decorative layers
  // (idle splash and loading static). CSS shows the right layer for the
  // current lifecycle. The decorative layers are hidden from screen readers
  // because the screen output already announces the same state.
  const lcdBody = createElement(documentRef, 'div', 'lcd-body');

  const idleSplash = createIdleSplash(documentRef);
  const loadingSplash = createLoadingSplash(documentRef);

  const screenOutput = documentRef.createElement('div');
  screenOutput.className = 'screen-output';
  screenOutput.setAttribute('role', 'status');
  screenOutput.setAttribute('aria-live', 'polite');

  const inputLine = documentRef.createElement('div');
  inputLine.className = 'input-line';
  inputLine.setAttribute('aria-label', 'Current input');

  lcdBody.append(idleSplash, loadingSplash, screenOutput, inputLine);

  // Labels on the bottom edge of the LCD for the two small soft keys below.
  const softkeyLabels = createElement(documentRef, 'div', 'softkey-labels');
  softkeyLabels.setAttribute('aria-hidden', 'true');
  softkeyLabels.append(
    createElement(documentRef, 'span', 'softkey-label softkey-label-side', 'Back'),
    createElement(documentRef, 'span', 'softkey-label softkey-label-mid', 'Mute'),
    createElement(documentRef, 'span', 'softkey-label softkey-label-side', 'Home'),
  );

  lcdDisplay.append(statusBar, lcdBody, softkeyLabels);

  const keypad = documentRef.createElement('div');
  keypad.className = 'keypad';
  keypad.setAttribute('role', 'group');
  keypad.setAttribute('aria-label', 'Keypad');

  const characterKeys = CHARACTER_LABELS.map((label) => {
    const button = createButton(documentRef, 'character-key', label);
    button.dataset.label = label;
    if (KEY_LETTERS[label]) {
      button.setAttribute('data-letters', KEY_LETTERS[label]);
    }
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

  // DOM order follows the on-screen layout so Tab moves left to right:
  // soft-key row (Back, Mute, Home), then the green Call and red Clear keys.
  phoneActions.append(backKey, muteKey, homeKey, callKey, clearKey);
  enclosure.append(speaker, lcdDisplay, phoneActions, keypad);

  return {
    enclosure,
    lcdDisplay,
    statusBar,
    sessionStateBadge,
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

/**
 * Create an element with a class name and optional plain text.
 * Text is always set with textContent, never as HTML.
 */
function createElement(documentRef, tagName, className, text) {
  const element = documentRef.createElement(tagName);
  element.className = className;
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

/**
 * Decorative idle screen: pixel ghost, app title, tagline, and dial hint.
 * The title text comes from CSS (`.idle-title::before`) so the phone shell
 * itself carries no printed name. Screen readers hear the screen output
 * ("Dial *266# to begin") instead of this layer.
 */
function createIdleSplash(documentRef) {
  const splash = createElement(documentRef, 'div', 'idle-splash');
  splash.setAttribute('aria-hidden', 'true');

  const dialLine = createElement(documentRef, 'span', 'idle-dial');
  dialLine.append(
    createElement(documentRef, 'span', 'idle-dial-label', 'Dial'),
    createElement(documentRef, 'span', 'idle-code', '*266#'),
  );

  splash.append(
    createElement(documentRef, 'span', 'pixel-ghost'),
    createElement(documentRef, 'span', 'idle-title'),
    createElement(documentRef, 'span', 'idle-tagline', 'AI tutor, no data'),
    dialLine,
  );
  return splash;
}

/**
 * Decorative loading screen shown while the AI answer is on its way.
 */
function createLoadingSplash(documentRef) {
  const splash = createElement(documentRef, 'div', 'loading-splash');
  splash.setAttribute('aria-hidden', 'true');
  splash.append(
    createElement(documentRef, 'span', 'loading-text', 'Calling the spirits...'),
    createElement(documentRef, 'span', 'static-noise'),
    createElement(documentRef, 'span', 'static-caption', '~ ~ ~ kzzt ~ ~ ~'),
  );
  return splash;
}

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
 * @property {HTMLElement} statusBar
 * @property {HTMLElement} sessionStateBadge
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
