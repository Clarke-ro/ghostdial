import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNoopAudioService } from '../../src/ui/audio.js';
import { mountPhoneUI } from '../../src/ui/phone-ui.js';

class TestElement {
  constructor(documentRef, tagName) {
    this.ownerDocument = documentRef;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.className = '';
    this.disabled = false;
    this.type = '';
    this._textContent = '';
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  click() {
    const event = { type: 'click', target: this, currentTarget: this };
    for (const listener of this.listeners.get('click') ?? []) {
      listener(event);
    }
  }
}

class TestDocument {
  constructor() {
    this.listeners = new Map();
  }

  createElement(tagName) {
    return new TestElement(this, tagName);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatch(type, event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }

  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length;
  }
}

function keyboardEvent(key, modifiers = {}) {
  return {
    key,
    ctrlKey: Boolean(modifiers.ctrlKey),
    altKey: Boolean(modifiers.altKey),
    metaKey: Boolean(modifiers.metaKey),
    preventDefault: vi.fn(),
  };
}

function con(state, text = 'Choose an option') {
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

function createThrowingAudio() {
  const fail = () => {
    throw new Error('audio unavailable');
  };

  return {
    keyBeep: vi.fn(fail),
    startConnecting: vi.fn(fail),
    stopConnecting: vi.fn(fail),
    setMuted: vi.fn(fail),
    isMuted: vi.fn(fail),
    destroy: vi.fn(fail),
  };
}

const mountedControllers = [];

function mount({
  transition = vi.fn(() => con({ view: { kind: 'main' } })),
  aiProvider = vi.fn(),
  audio = createRecordingAudio(),
  endPauseMs = 1500,
} = {}) {
  const documentRef = new TestDocument();
  const root = documentRef.createElement('main');
  const controller = mountPhoneUI(root, {
    transition,
    aiProvider,
    audio,
    clock: { now: () => Date.now() },
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
    endPauseMs,
  });

  mountedControllers.push(controller);
  return { controller, documentRef, root, transition, aiProvider, audio };
}

function startActiveScreen(controller, transition, result) {
  transition.mockReturnValueOnce(result);
  expect(controller.dispatch({ type: 'call' })).toBe(true);
  transition.mockClear();
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
  for (const controller of mountedControllers.splice(0)) {
    controller.destroy();
  }
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('phone controller startup and synchronous submissions', () => {
  it('starts idle with no engine state, no input, and no transition call', () => {
    const { controller, transition } = mount();

    expect(controller.getSnapshot()).toEqual({
      engineState: null,
      lifecycle: 'idle',
      inputBuffer: '',
      multiTap: null,
      screen: null,
    });
    expect(controller.controls.screenOutput.textContent).toBe('Dial *266# to begin');
    expect(controller.controls.inputLine.textContent).toBe('');
    expect(transition).not.toHaveBeenCalled();
  });

  it('submits the exact captured input once with the start state and same provider', () => {
    const activeState = { view: { kind: 'question' }, marker: 'unchanged' };
    const nextState = { view: { kind: 'answer' }, marker: 'returned' };
    const transition = vi.fn();
    const aiProvider = vi.fn();
    const { controller } = mount({ transition, aiProvider });

    startActiveScreen(controller, transition, con(activeState, 'Ask your question'));
    controller.dispatch({ type: 'character', label: '2' });
    controller.dispatch({ type: 'printable', value: ' !' });
    controller.dispatch({ type: 'character', label: '3' });
    transition.mockReturnValueOnce(con(nextState, 'Answer text'));

    expect(controller.dispatch({ type: 'call' })).toBe(true);

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(activeState, 'a !d', aiProvider);
    expect(controller.getSnapshot()).toMatchObject({
      engineState: nextState,
      lifecycle: 'interactive',
      inputBuffer: '',
      multiTap: null,
    });
  });

  it('adopts a synchronous CON state and screen by reference without loading', () => {
    const returnedState = { view: { kind: 'quiz' }, nested: { score: 4 } };
    const returnedScreen = { type: 'CON', text: '1.Next\n0.Back' };
    const transition = vi.fn(() => ({ state: returnedState, screen: returnedScreen }));
    const audio = createRecordingAudio();
    const { controller } = mount({ transition, audio });

    controller.dispatch({ type: 'character', label: '*' });
    controller.dispatch({ type: 'character', label: '2' });
    controller.dispatch({ type: 'character', label: '6' });
    controller.dispatch({ type: 'character', label: '6' });
    controller.dispatch({ type: 'character', label: '#' });
    controller.dispatch({ type: 'call' });

    const snapshot = controller.getSnapshot();
    expect(snapshot.engineState).toBe(returnedState);
    expect(snapshot.screen).toBe(returnedScreen);
    expect(snapshot.lifecycle).toBe('interactive');
    expect(controller.controls.screenOutput.textContent).toBe(returnedScreen.text);
    expect(audio.startConnecting).not.toHaveBeenCalled();
    expect(audio.stopConnecting).not.toHaveBeenCalled();
  });

  it('Clear empties input and pending multi-tap state without invoking the engine', () => {
    const questionState = { view: { kind: 'question' } };
    const transition = vi.fn();
    const audio = createRecordingAudio();
    const { controller } = mount({ transition, audio });
    startActiveScreen(controller, transition, con(questionState, 'Question'));
    audio.keyBeep.mockClear();

    controller.dispatch({ type: 'character', label: '2' });
    expect(controller.getSnapshot().multiTap).not.toBeNull();
    transition.mockClear();
    audio.keyBeep.mockClear();

    expect(controller.dispatch({ type: 'clear' })).toBe(true);

    expect(controller.getSnapshot()).toMatchObject({ inputBuffer: '', multiTap: null });
    expect(controller.controls.inputLine.textContent).toBe('');
    expect(transition).not.toHaveBeenCalled();
    expect(audio.keyBeep).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Back, Home, and question-state keypad zero', () => {
  it.each([
    ['back', '0'],
    ['home', '00'],
  ])('clears stale input before %s submits exact %s with the same provider', (actionType, expectedInput) => {
    const questionState = { view: { kind: 'question' }, id: actionType };
    const returnedState = { view: { kind: 'main' }, from: actionType };
    const transition = vi.fn();
    const aiProvider = vi.fn();
    const audio = createRecordingAudio();
    const { controller } = mount({ transition, aiProvider, audio });
    startActiveScreen(controller, transition, con(questionState, 'Question'));

    controller.dispatch({ type: 'printable', value: 'stale:' });
    controller.dispatch({ type: 'character', label: '2' });
    expect(controller.getSnapshot()).toMatchObject({ inputBuffer: 'stale:a' });
    expect(controller.getSnapshot().multiTap).not.toBeNull();
    audio.keyBeep.mockClear();

    transition.mockImplementationOnce((state, input, provider) => {
      expect(controller.getSnapshot()).toMatchObject({ inputBuffer: '', multiTap: null });
      expect(state).toBe(questionState);
      expect(input).toBe(expectedInput);
      expect(provider).toBe(aiProvider);
      return con(returnedState, 'Main menu');
    });

    expect(controller.dispatch({ type: actionType })).toBe(true);

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(questionState, expectedInput, aiProvider);
    expect(audio.keyBeep).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      engineState: returnedState,
      inputBuffer: '',
      multiTap: null,
    });
  });

  it('keeps keypad 0 as a U+0020 SPACE while Back and Home remain navigation submissions', () => {
    const questionState = { view: { kind: 'question' } };
    const transition = vi.fn();
    const audio = createRecordingAudio();
    const { controller, aiProvider } = mount({ transition, audio });
    startActiveScreen(controller, transition, con(questionState, 'Question'));
    audio.keyBeep.mockClear();

    expect(controller.dispatch({ type: 'character', label: '0' })).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ inputBuffer: ' ' });
    expect(controller.getSnapshot().multiTap).toMatchObject({ digit: '0', index: 0 });
    expect(transition).not.toHaveBeenCalled();

    transition.mockReturnValueOnce(con(questionState, 'Question'));
    controller.dispatch({ type: 'back' });
    expect(transition).toHaveBeenLastCalledWith(questionState, '0', aiProvider);

    controller.dispatch({ type: 'character', label: '0' });
    transition.mockReturnValueOnce(con(questionState, 'Question'));
    controller.dispatch({ type: 'home' });
    expect(transition).toHaveBeenLastCalledWith(questionState, '00', aiProvider);
    expect(transition).toHaveBeenCalledTimes(2);
    expect(audio.keyBeep).toHaveBeenCalledTimes(4);
  });

  it('ignores Back and Home without transitions or beeps in idle, loading, and END pause', () => {
    const idle = mount();
    expect(idle.controller.dispatch({ type: 'back' })).toBe(false);
    expect(idle.controller.dispatch({ type: 'home' })).toBe(false);
    expect(idle.transition).not.toHaveBeenCalled();
    expect(idle.audio.keyBeep).not.toHaveBeenCalled();

    const pending = deferred();
    const loadingTransition = vi.fn(() => pending.promise);
    const loading = mount({ transition: loadingTransition });
    loading.controller.dispatch({ type: 'call' });
    loadingTransition.mockClear();
    loading.audio.keyBeep.mockClear();
    const loadingBefore = loading.controller.getSnapshot();

    expect(loading.controller.dispatch({ type: 'back' })).toBe(false);
    expect(loading.controller.dispatch({ type: 'home' })).toBe(false);
    expect(loading.controller.getSnapshot()).toEqual(loadingBefore);
    expect(loadingTransition).not.toHaveBeenCalled();
    expect(loading.audio.keyBeep).not.toHaveBeenCalled();

    const endTransition = vi.fn(() => end({ status: 'ended' }, 'Goodbye'));
    const ended = mount({ transition: endTransition });
    ended.controller.dispatch({ type: 'call' });
    endTransition.mockClear();
    ended.audio.keyBeep.mockClear();
    const endedBefore = ended.controller.getSnapshot();

    expect(ended.controller.dispatch({ type: 'back' })).toBe(false);
    expect(ended.controller.dispatch({ type: 'home' })).toBe(false);
    expect(ended.controller.getSnapshot()).toEqual(endedBefore);
    expect(endTransition).not.toHaveBeenCalled();
    expect(ended.audio.keyBeep).not.toHaveBeenCalled();
  });
});

describe('keyboard, capacity, and multi-tap controller behavior', () => {
  it('handles printable, Backspace, Enter, modified, and unsupported keyboard events', () => {
    const activeState = { view: { kind: 'main' } };
    const transition = vi.fn(() => con(activeState, 'Menu'));
    const audio = createRecordingAudio();
    const { controller, documentRef, aiProvider } = mount({ transition, audio });
    startActiveScreen(controller, transition, con(activeState, 'Menu'));
    audio.keyBeep.mockClear();

    const printable = keyboardEvent('!');
    documentRef.dispatch('keydown', printable);
    expect(controller.getSnapshot().inputBuffer).toBe('!');
    expect(printable.preventDefault).toHaveBeenCalledTimes(1);

    const backspace = keyboardEvent('Backspace');
    documentRef.dispatch('keydown', backspace);
    expect(controller.getSnapshot().inputBuffer).toBe('');
    expect(backspace.preventDefault).toHaveBeenCalledTimes(1);

    const emptyBackspace = keyboardEvent('Backspace');
    documentRef.dispatch('keydown', emptyBackspace);
    expect(controller.getSnapshot().inputBuffer).toBe('');
    expect(emptyBackspace.preventDefault).toHaveBeenCalledTimes(1);

    const modified = keyboardEvent('x', { ctrlKey: true });
    const unsupported = keyboardEvent('ArrowLeft');
    documentRef.dispatch('keydown', modified);
    documentRef.dispatch('keydown', unsupported);
    expect(controller.getSnapshot().inputBuffer).toBe('');
    expect(modified.preventDefault).not.toHaveBeenCalled();
    expect(unsupported.preventDefault).not.toHaveBeenCalled();

    const enteredText = keyboardEvent('z');
    const enter = keyboardEvent('Enter');
    documentRef.dispatch('keydown', enteredText);
    documentRef.dispatch('keydown', enter);

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(activeState, 'z', aiProvider);
    expect(enter.preventDefault).toHaveBeenCalledTimes(1);
    expect(audio.keyBeep).toHaveBeenCalledTimes(5);
  });

  it('enforces the 160-code-unit capacity for keypad and keyboard input', () => {
    const audio = createRecordingAudio();
    const { controller, documentRef } = mount({ audio });

    for (let index = 0; index < 160; index += 1) {
      expect(controller.dispatch({ type: 'printable', value: 'a' })).toBe(true);
    }
    expect(controller.getSnapshot().inputBuffer).toBe('a'.repeat(160));
    audio.keyBeep.mockClear();

    expect(controller.dispatch({ type: 'character', label: '1' })).toBe(false);
    expect(controller.dispatch({ type: 'printable', value: 'b' })).toBe(false);
    const event = keyboardEvent('😀');
    documentRef.dispatch('keydown', event);

    expect(controller.getSnapshot().inputBuffer).toBe('a'.repeat(160));
    expect(controller.controls.inputLine.textContent).toBe('a'.repeat(160));
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(audio.keyBeep).not.toHaveBeenCalled();
  });

  it('cycles before 800 ms and commits at the 800 ms boundary', () => {
    const questionState = { view: { kind: 'question' } };
    const transition = vi.fn();
    const { controller } = mount({ transition });
    startActiveScreen(controller, transition, con(questionState, 'Question'));

    controller.dispatch({ type: 'character', label: '2' });
    vi.advanceTimersByTime(799);
    controller.dispatch({ type: 'character', label: '2' });

    expect(controller.getSnapshot()).toMatchObject({
      inputBuffer: 'b',
      multiTap: { digit: '2', index: 1, activatedAt: 799 },
    });

    vi.advanceTimersByTime(800);
    expect(controller.getSnapshot()).toMatchObject({ inputBuffer: 'b', multiTap: null });

    controller.dispatch({ type: 'character', label: '2' });
    expect(controller.getSnapshot()).toMatchObject({
      inputBuffer: 'ba',
      multiTap: { digit: '2', index: 0, activatedAt: 1599 },
    });
  });
});

describe('Promise lifecycle, END pause, and cleanup', () => {
  it('enters loading before Promise fulfillment and adopts the fulfilled CON result', async () => {
    const pending = deferred();
    const returnedState = { view: { kind: 'answer' } };
    const returnedScreen = { type: 'CON', text: 'Spirit answer' };
    const transition = vi.fn(() => pending.promise);
    const audio = createRecordingAudio();
    const { controller } = mount({ transition, audio });

    controller.dispatch({ type: 'call' });

    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: 'loading',
      engineState: null,
      inputBuffer: '',
    });
    expect(controller.controls.screenOutput.textContent).toBe('Contacting the spirits...');
    expect(controller.controls.callKey.disabled).toBe(true);
    expect(audio.startConnecting).toHaveBeenCalledTimes(1);
    expect(audio.stopConnecting).not.toHaveBeenCalled();

    pending.resolve({ state: returnedState, screen: returnedScreen });
    await settlePromise();

    expect(controller.getSnapshot()).toMatchObject({ lifecycle: 'interactive' });
    expect(controller.getSnapshot().engineState).toBe(returnedState);
    expect(controller.getSnapshot().screen).toBe(returnedScreen);
    expect(controller.controls.screenOutput.textContent).toBe('Spirit answer');
    expect(controller.controls.callKey.disabled).toBe(false);
    expect(audio.stopConnecting).toHaveBeenCalledTimes(1);
  });

  it('preserves the pre-transition state and becomes interactive after Promise rejection', async () => {
    const activeState = { view: { kind: 'question' }, retained: true };
    const pending = deferred();
    const transition = vi.fn();
    const audio = createRecordingAudio();
    const { controller } = mount({ transition, audio });
    startActiveScreen(controller, transition, con(activeState, 'Question'));
    transition.mockReturnValueOnce(pending.promise);

    controller.dispatch({ type: 'printable', value: 'exact question' });
    controller.dispatch({ type: 'call' });
    expect(controller.getSnapshot().lifecycle).toBe('loading');

    pending.reject(new Error('private provider detail'));
    await settlePromise();

    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: 'error',
      inputBuffer: '',
      multiTap: null,
      screen: null,
    });
    expect(controller.getSnapshot().engineState).toBe(activeState);
    expect(controller.controls.screenOutput.textContent).toBe('Request failed. Try again.');
    expect(controller.controls.screenOutput.textContent).not.toContain('private provider detail');
    expect(controller.controls.callKey.disabled).toBe(false);
    expect(controller.dispatch({ type: 'printable', value: 'r' })).toBe(true);
    expect(controller.getSnapshot().inputBuffer).toBe('r');
    expect(audio.startConnecting).toHaveBeenCalledTimes(1);
    expect(audio.stopConnecting).toHaveBeenCalledTimes(1);
  });

  it('keeps an END screen blocked through 1,499 ms and resets to idle at 1,500 ms', () => {
    const endedState = { status: 'ended', score: 5 };
    const transition = vi.fn(() => end(endedState, 'Final score: 5'));
    const audio = createRecordingAudio();
    const { controller, documentRef } = mount({ transition, audio });

    controller.dispatch({ type: 'call' });
    expect(controller.getSnapshot()).toMatchObject({
      engineState: endedState,
      lifecycle: 'end-pause',
      inputBuffer: '',
      multiTap: null,
    });
    expect(controller.controls.screenOutput.textContent).toBe('Final score: 5');

    transition.mockClear();
    audio.keyBeep.mockClear();
    const before = controller.getSnapshot();
    expect(controller.dispatch({ type: 'character', label: '1' })).toBe(false);
    expect(controller.dispatch({ type: 'clear' })).toBe(false);
    expect(controller.dispatch({ type: 'call' })).toBe(false);
    const key = keyboardEvent('x');
    documentRef.dispatch('keydown', key);
    expect(key.preventDefault).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual(before);
    expect(transition).not.toHaveBeenCalled();
    expect(audio.keyBeep).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1499);
    expect(controller.getSnapshot().lifecycle).toBe('end-pause');
    expect(controller.controls.screenOutput.textContent).toBe('Final score: 5');

    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot()).toEqual({
      engineState: null,
      lifecycle: 'idle',
      inputBuffer: '',
      multiTap: null,
      screen: null,
    });
    expect(controller.controls.screenOutput.textContent).toBe('Dial *266# to begin');
  });

  it('destroy removes keyboard handling, clears pending timers, blocks actions, and destroys audio once', () => {
    const questionState = { view: { kind: 'question' } };
    const transition = vi.fn();
    const audio = createRecordingAudio();
    const { controller, documentRef } = mount({ transition, audio });
    startActiveScreen(controller, transition, con(questionState, 'Question'));
    controller.dispatch({ type: 'character', label: '2' });
    expect(documentRef.listenerCount('keydown')).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    transition.mockClear();
    audio.keyBeep.mockClear();

    controller.destroy();
    controller.destroy();

    expect(documentRef.listenerCount('keydown')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(controller.dispatch({ type: 'character', label: '1' })).toBe(false);
    const key = keyboardEvent('x');
    documentRef.dispatch('keydown', key);
    expect(controller.getSnapshot().inputBuffer).toBe('a');
    expect(transition).not.toHaveBeenCalled();
    expect(audio.keyBeep).not.toHaveBeenCalled();
    expect(audio.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('audio event gating and isolation', () => {
  it('beeps once for each accepted on-screen and keyboard action', () => {
    const state = { view: { kind: 'main' } };
    const transition = vi.fn(() => con(state, 'Menu'));
    const audio = createRecordingAudio();
    const { controller, documentRef } = mount({ transition, audio });
    startActiveScreen(controller, transition, con(state, 'Menu'));
    audio.keyBeep.mockClear();

    expect(controller.dispatch({ type: 'character', label: '1' })).toBe(true);
    expect(controller.dispatch({ type: 'clear' })).toBe(true);
    documentRef.dispatch('keydown', keyboardEvent('x'));
    documentRef.dispatch('keydown', keyboardEvent('Backspace'));
    documentRef.dispatch('keydown', keyboardEvent('Backspace'));
    controller.dispatch({ type: 'character', label: '2' });
    expect(controller.dispatch({ type: 'call' })).toBe(true);
    documentRef.dispatch('keydown', keyboardEvent('y'));
    documentRef.dispatch('keydown', keyboardEvent('Enter'));

    expect(audio.keyBeep).toHaveBeenCalledTimes(9);
    expect(transition).toHaveBeenCalledTimes(2);
  });

  it('does not beep for ignored, disabled, modified, unsupported, or capacity-rejected actions', () => {
    const audio = createRecordingAudio();
    const { controller, documentRef } = mount({ audio });

    for (let index = 0; index < 160; index += 1) {
      controller.dispatch({ type: 'printable', value: 'a' });
    }
    audio.keyBeep.mockClear();

    expect(controller.dispatch({ type: 'character', label: '1' })).toBe(false);
    expect(controller.dispatch({ type: 'printable', value: 'b' })).toBe(false);
    expect(controller.dispatch({ type: 'unknown' })).toBe(false);
    documentRef.dispatch('keydown', keyboardEvent('x', { altKey: true }));
    documentRef.dispatch('keydown', keyboardEvent('Escape'));
    expect(audio.keyBeep).not.toHaveBeenCalled();

    const pending = deferred();
    const transition = vi.fn(() => pending.promise);
    const loadingAudio = createRecordingAudio();
    const loading = mount({ transition, audio: loadingAudio });
    loading.controller.dispatch({ type: 'call' });
    loadingAudio.keyBeep.mockClear();

    expect(loading.controller.dispatch({ type: 'character', label: '1' })).toBe(false);
    expect(loading.controller.dispatch({ type: 'clear' })).toBe(false);
    expect(loading.controller.dispatch({ type: 'call' })).toBe(false);
    loading.documentRef.dispatch('keydown', keyboardEvent('x'));
    loading.documentRef.dispatch('keydown', keyboardEvent('Enter'));
    loading.documentRef.dispatch('keydown', keyboardEvent('Backspace'));
    expect(loadingAudio.keyBeep).not.toHaveBeenCalled();
  });

  it('works with the complete no-op audio service', () => {
    const state = { view: { kind: 'main' } };
    const transition = vi.fn(() => con(state, 'Menu'));
    const { controller } = mount({
      transition,
      audio: createNoopAudioService(),
    });

    expect(controller.dispatch({ type: 'character', label: '1' })).toBe(true);
    expect(controller.dispatch({ type: 'call' })).toBe(true);
    expect(controller.dispatch({ type: 'mute-toggle' })).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      engineState: state,
      lifecycle: 'interactive',
      inputBuffer: '',
    });
  });

  it('swallows throwing audio methods without changing input or Promise lifecycle behavior', async () => {
    const pending = deferred();
    const state = { view: { kind: 'answer' } };
    const transition = vi.fn(() => pending.promise);
    const audio = createThrowingAudio();
    const { controller, aiProvider } = mount({ transition, audio });

    expect(() => controller.dispatch({ type: 'character', label: '1' })).not.toThrow();
    expect(() => controller.dispatch({ type: 'call' })).not.toThrow();
    expect(transition).toHaveBeenCalledWith(null, '1', aiProvider);
    expect(controller.getSnapshot().lifecycle).toBe('loading');
    expect(audio.keyBeep).toHaveBeenCalledTimes(2);
    expect(audio.startConnecting).toHaveBeenCalledTimes(1);

    expect(() => controller.dispatch({ type: 'mute-toggle' })).not.toThrow();
    expect(controller.getSnapshot().lifecycle).toBe('loading');

    pending.resolve(con(state, 'Answer'));
    await settlePromise();
    expect(controller.getSnapshot()).toMatchObject({
      engineState: state,
      lifecycle: 'interactive',
      inputBuffer: '',
    });
    expect(audio.stopConnecting).toHaveBeenCalledTimes(1);
    expect(() => controller.destroy()).not.toThrow();
    expect(audio.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['CON fulfillment', 'fulfill-con'],
    ['END fulfillment', 'fulfill-end'],
    ['rejection', 'reject'],
    ['destroy', 'destroy'],
  ])('starts once on Promise entry and stops once on %s', async (_label, outcome) => {
    const pending = deferred();
    const audio = createRecordingAudio();
    const transition = vi.fn(() => pending.promise);
    const { controller } = mount({ transition, audio });

    controller.dispatch({ type: 'call' });
    expect(audio.startConnecting).toHaveBeenCalledTimes(1);
    expect(audio.stopConnecting).not.toHaveBeenCalled();

    if (outcome === 'fulfill-con') {
      pending.resolve(con({ view: { kind: 'main' } }, 'Menu'));
      await settlePromise();
      expect(controller.getSnapshot().lifecycle).toBe('interactive');
    } else if (outcome === 'fulfill-end') {
      pending.resolve(end({ status: 'ended' }, 'Goodbye'));
      await settlePromise();
      expect(controller.getSnapshot().lifecycle).toBe('end-pause');
    } else if (outcome === 'reject') {
      pending.reject(new Error('failed'));
      await settlePromise();
      expect(controller.getSnapshot().lifecycle).toBe('error');
    } else {
      controller.destroy();
      pending.resolve(con({ view: { kind: 'main' } }, 'Ignored'));
      await settlePromise();
      expect(controller.getSnapshot().lifecycle).toBe('loading');
    }

    expect(audio.startConnecting).toHaveBeenCalledTimes(1);
    expect(audio.stopConnecting).toHaveBeenCalledTimes(1);
  });
});

describe('mute isolation', () => {
  it('does not alter engine state, input, pending multi-tap, lifecycle, arguments, or timers', () => {
    const questionState = { view: { kind: 'question' }, stable: true };
    const nextState = { view: { kind: 'answer' } };
    const transition = vi.fn();
    const aiProvider = vi.fn();
    const audio = createRecordingAudio();
    const { controller } = mount({ transition, aiProvider, audio });
    startActiveScreen(controller, transition, con(questionState, 'Question'));

    controller.dispatch({ type: 'printable', value: 'x' });
    controller.dispatch({ type: 'character', label: '2' });
    const before = controller.getSnapshot();
    const timerCount = vi.getTimerCount();
    audio.keyBeep.mockClear();

    expect(controller.dispatch({ type: 'mute-toggle' })).toBe(true);
    expect(controller.dispatch({ type: 'mute-toggle' })).toBe(true);

    const after = controller.getSnapshot();
    expect(after).toEqual(before);
    expect(after.engineState).toBe(questionState);
    expect(transition).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(timerCount);
    expect(audio.setMuted.mock.calls).toEqual([[true], [false]]);
    expect(audio.keyBeep).not.toHaveBeenCalled();

    transition.mockReturnValueOnce(con(nextState, 'Answer'));
    controller.dispatch({ type: 'call' });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(questionState, 'xa', aiProvider);
  });

  it('keeps loading and END reset timers unchanged when mute toggles', async () => {
    const pending = deferred();
    const loadingAudio = createRecordingAudio();
    const loading = mount({
      transition: vi.fn(() => pending.promise),
      audio: loadingAudio,
    });
    loading.controller.dispatch({ type: 'call' });
    const loadingSnapshot = loading.controller.getSnapshot();
    const loadingTimers = vi.getTimerCount();

    loading.controller.dispatch({ type: 'mute-toggle' });
    loading.controller.dispatch({ type: 'mute-toggle' });
    expect(loading.controller.getSnapshot()).toEqual(loadingSnapshot);
    expect(vi.getTimerCount()).toBe(loadingTimers);
    expect(loadingAudio.startConnecting).toHaveBeenCalledTimes(1);
    expect(loadingAudio.stopConnecting).not.toHaveBeenCalled();

    pending.resolve(con({ view: { kind: 'main' } }, 'Menu'));
    await settlePromise();

    const ended = mount({
      transition: vi.fn(() => end({ status: 'ended' }, 'Goodbye')),
      audio: createRecordingAudio(),
    });
    ended.controller.dispatch({ type: 'call' });
    const endSnapshot = ended.controller.getSnapshot();
    const endTimers = vi.getTimerCount();

    ended.controller.dispatch({ type: 'mute-toggle' });
    expect(ended.controller.getSnapshot()).toEqual(endSnapshot);
    expect(vi.getTimerCount()).toBe(endTimers);

    vi.advanceTimersByTime(1500);
    expect(ended.controller.getSnapshot().lifecycle).toBe('idle');
  });
});
