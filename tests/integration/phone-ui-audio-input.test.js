import { JSDOM } from 'jsdom';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { mountPhoneUI } from '../../src/ui/phone-ui.js';

const controllers = [];
const browsers = [];

function con(state, text = 'Main menu') {
  return { state, screen: { type: 'CON', text } };
}

function end(state, text = 'The line goes dead... Goodbye.') {
  return { state, screen: { type: 'END', text } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRecordingAudio() {
  let muted = false;

  return {
    keyBeep: vi.fn(),
    startConnecting: vi.fn(),
    stopConnecting: vi.fn(),
    setMuted: vi.fn((value) => {
      muted = Boolean(value);
    }),
    isMuted: vi.fn(() => muted),
    destroy: vi.fn(),
  };
}

function mountController({
  transition = vi.fn(() => con({ view: { kind: 'main' } })),
  aiProvider = vi.fn(),
  audio = createRecordingAudio(),
} = {}) {
  const browser = new JSDOM('<!doctype html><main id="app"></main>', {
    url: 'http://ghostdial.test/',
  });
  const root = browser.window.document.querySelector('#app');
  const controller = mountPhoneUI(root, {
    transition,
    aiProvider,
    audio,
    clock: { now: () => Date.now() },
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });

  browsers.push(browser);
  controllers.push(controller);

  return {
    aiProvider,
    audio,
    browser,
    controller,
    document: browser.window.document,
    transition,
  };
}

function dispatchKey(browser, key, modifiers = {}) {
  const event = new browser.window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: Boolean(modifiers.ctrlKey),
    altKey: Boolean(modifiers.altKey),
    metaKey: Boolean(modifiers.metaKey),
  });
  browser.window.document.dispatchEvent(event);
  return event;
}

function characterKey(document, label) {
  return [...document.querySelectorAll('.character-key')]
    .find((button) => button.textContent === label);
}

function sessionControls(document) {
  return [
    ...document.querySelectorAll('.character-key'),
    document.querySelector('.call-key'),
    document.querySelector('.clear-key'),
    document.querySelector('.back-key'),
    document.querySelector('.home-key'),
  ];
}

async function settlePromise() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  for (const controller of controllers.splice(0)) {
    controller.destroy();
  }
  for (const browser of browsers.splice(0)) {
    browser.window.close();
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('mounted controller audio input integration', () => {
  it('beeps exactly once for each accepted on-screen and physical-keyboard action', () => {
    const activeState = { view: { kind: 'main' } };
    const transition = vi.fn(() => con(activeState));
    const {
      aiProvider,
      audio,
      browser,
      controller,
      document,
    } = mountController({ transition });

    const expectOneBeep = (activate) => {
      audio.keyBeep.mockClear();
      activate();
      expect(audio.keyBeep).toHaveBeenCalledTimes(1);
    };

    expectOneBeep(() => characterKey(document, '1').click());
    expect(controller.getSnapshot().inputBuffer).toBe('1');

    expectOneBeep(() => document.querySelector('.clear-key').click());
    expect(controller.getSnapshot().inputBuffer).toBe('');

    let event;
    expectOneBeep(() => {
      event = dispatchKey(browser, 'x');
    });
    expect(event.defaultPrevented).toBe(true);
    expect(controller.getSnapshot().inputBuffer).toBe('x');

    expectOneBeep(() => {
      event = dispatchKey(browser, 'Backspace');
    });
    expect(event.defaultPrevented).toBe(true);
    expect(controller.getSnapshot().inputBuffer).toBe('');

    expectOneBeep(() => document.querySelector('.call-key').click());
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenLastCalledWith(null, '', aiProvider);

    dispatchKey(browser, 'y');
    expectOneBeep(() => {
      event = dispatchKey(browser, 'Enter');
    });
    expect(event.defaultPrevented).toBe(true);
    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition).toHaveBeenLastCalledWith(activeState, 'y', aiProvider);
  });

  it('does not beep for ignored, modified, unsupported, or capacity-rejected input', () => {
    const {
      audio,
      browser,
      controller,
      document,
      transition,
    } = mountController();

    // Back is disabled in idle because there is no active CON screen.
    document.querySelector('.back-key').click();
    expect(audio.keyBeep).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();

    for (let index = 0; index < 160; index += 1) {
      dispatchKey(browser, 'a');
    }
    expect(controller.getSnapshot().inputBuffer).toBe('a'.repeat(160));
    audio.keyBeep.mockClear();

    characterKey(document, '1').click();
    const rejectedPrintable = dispatchKey(browser, 'b');
    const modified = dispatchKey(browser, 'x', { ctrlKey: true });
    const unsupported = dispatchKey(browser, 'ArrowLeft');

    expect(controller.getSnapshot().inputBuffer).toBe('a'.repeat(160));
    expect(audio.keyBeep).not.toHaveBeenCalled();
    expect(rejectedPrintable.defaultPrevented).toBe(true);
    expect(modified.defaultPrevented).toBe(false);
    expect(unsupported.defaultPrevented).toBe(false);
  });

  it('suppresses beeps and engine calls for disabled input during loading and END pause', async () => {
    const pending = deferred();
    const transition = vi.fn(() => pending.promise);
    const {
      audio,
      browser,
      controller,
      document,
    } = mountController({ transition });

    document.querySelector('.call-key').click();
    expect(controller.getSnapshot().lifecycle).toBe('loading');
    expect(sessionControls(document).every((control) => control.disabled)).toBe(true);

    transition.mockClear();
    audio.keyBeep.mockClear();
    const loadingSnapshot = controller.getSnapshot();

    characterKey(document, '1').click();
    document.querySelector('.clear-key').click();
    document.querySelector('.call-key').click();
    dispatchKey(browser, 'x');
    dispatchKey(browser, 'Enter');
    dispatchKey(browser, 'Backspace');

    expect(controller.getSnapshot()).toEqual(loadingSnapshot);
    expect(transition).not.toHaveBeenCalled();
    expect(audio.keyBeep).not.toHaveBeenCalled();

    pending.resolve(end({ status: 'ended' }, 'Goodbye'));
    await settlePromise();
    expect(controller.getSnapshot().lifecycle).toBe('end-pause');
    expect(sessionControls(document).every((control) => control.disabled)).toBe(true);

    transition.mockClear();
    audio.keyBeep.mockClear();
    const endedSnapshot = controller.getSnapshot();

    characterKey(document, '2').click();
    document.querySelector('.clear-key').click();
    document.querySelector('.call-key').click();
    dispatchKey(browser, 'y');
    dispatchKey(browser, 'Enter');
    dispatchKey(browser, 'Backspace');

    expect(controller.getSnapshot()).toEqual(endedSnapshot);
    expect(transition).not.toHaveBeenCalled();
    expect(audio.keyBeep).not.toHaveBeenCalled();
  });

  it('keeps mute operable inside the enclosure during loading without changing engine behavior', async () => {
    const pending = deferred();
    const returnedState = { view: { kind: 'answer' }, marker: 'fulfilled' };
    const transition = vi.fn(() => pending.promise);
    const aiProvider = vi.fn();
    const {
      audio,
      controller,
      document,
    } = mountController({ transition, aiProvider });

    document.querySelector('.call-key').click();
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(null, '', aiProvider);
    expect(controller.getSnapshot().lifecycle).toBe('loading');

    const enclosure = document.querySelector('.retro-phone');
    const keypad = document.querySelector('.keypad');
    const mute = document.querySelector('.mute-key');
    expect(enclosure.contains(mute)).toBe(true);
    expect(keypad.contains(mute)).toBe(false);
    expect(mute.disabled).toBe(false);

    const beforeMute = controller.getSnapshot();
    const transitionCallsBeforeMute = transition.mock.calls.map((call) => [...call]);
    audio.keyBeep.mockClear();

    mute.click();
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(mute.textContent).toBe('Unmute audio');
    expect(audio.setMuted).toHaveBeenLastCalledWith(true);
    expect(controller.getSnapshot()).toEqual(beforeMute);
    expect(transition.mock.calls).toEqual(transitionCallsBeforeMute);
    expect(audio.keyBeep).not.toHaveBeenCalled();

    mute.click();
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    expect(mute.textContent).toBe('Mute audio');
    expect(audio.setMuted).toHaveBeenLastCalledWith(false);
    expect(controller.getSnapshot()).toEqual(beforeMute);
    expect(transition.mock.calls).toEqual(transitionCallsBeforeMute);
    expect(audio.keyBeep).not.toHaveBeenCalled();

    pending.resolve(con(returnedState, 'Spirit answer'));
    await settlePromise();

    expect(controller.getSnapshot().engineState).toBe(returnedState);
    expect(controller.getSnapshot().lifecycle).toBe('interactive');
    expect(transition).toHaveBeenCalledTimes(1);
  });
});
